//! Timer-driven batch worker for `BatchProjection`.
//!
//! Unlike event-driven workers, the `BatchWorker` wakes on a fixed interval
//! and calls `BatchProjection::run_cycle()`. Used for aggregate computations
//! like leaderboard refresh that operate on dirty sets rather than event streams.

use std::sync::Arc;

use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use tracing::{info, warn};

use crate::error::ProjectionError;
use crate::projection::pg::BatchProjection;
use crate::resilience::circuit_breaker::CircuitBreaker;
use crate::resilience::connection_manager::PoolPartitioner;
use crate::resilience::retry::{retry_with_backoff, RetryContext, RetryPolicy};
use crate::resilience::watchdog::Heartbeat;

// ---------------------------------------------------------------------------
// BatchWorker
// ---------------------------------------------------------------------------

/// Drives a `BatchProjection` on a fixed timer interval.
pub struct BatchWorker {
    projection: Box<dyn BatchProjection>,
    pool: PgPool,
    /// Interval between cycles in seconds.
    interval_secs: u64,

    /// Optional liveness signal updated after every successful cycle.
    heartbeat: Option<Heartbeat>,

    /// Shared circuit breaker protecting PostgreSQL from calls during outages.
    /// Shared with PgWorkers so the same circuit covers all PG writers.
    circuit_breaker: Arc<CircuitBreaker>,

    /// Per-projection connection semaphore. Workers must hold a permit for the
    /// entire duration of each database operation.
    partitioner: Arc<PoolPartitioner>,

    /// Retry policy — uses the batch variant (fewer attempts, longer base delay).
    retry_policy: RetryPolicy,
}

impl BatchWorker {
    /// Create a new `BatchWorker`.
    ///
    /// # Arguments
    ///
    /// * `projection` - Boxed batch projection implementing `run_cycle`
    /// * `pool` - Shared PostgreSQL connection pool
    /// * `interval_secs` - Seconds between cycle invocations
    /// * `circuit_breaker` - Shared circuit breaker protecting PostgreSQL
    /// * `partitioner` - Per-projection semaphore manager
    pub fn new(
        projection: Box<dyn BatchProjection>,
        pool: PgPool,
        interval_secs: u64,
        circuit_breaker: Arc<CircuitBreaker>,
        partitioner: Arc<PoolPartitioner>,
    ) -> Self {
        Self {
            projection,
            pool,
            interval_secs,
            heartbeat: None,
            circuit_breaker,
            partitioner,
            retry_policy: RetryPolicy::batch(),
        }
    }

    /// Attach a [`Heartbeat`] to this worker.
    ///
    /// The worker will call [`Heartbeat::beat`] after every successfully
    /// completed cycle.  Must be called before [`run`](Self::run).
    pub fn with_heartbeat(mut self, heartbeat: Heartbeat) -> Self {
        self.heartbeat = Some(heartbeat);
        self
    }

    #[inline]
    fn label(&self) -> String {
        format!("{}:batch", self.projection.name())
    }

    /// Run the timer loop until the `token` is cancelled.
    pub async fn run(self, token: CancellationToken) -> Result<(), ProjectionError> {
        let label = self.label();
        let interval = tokio::time::Duration::from_secs(self.interval_secs);

        info!(worker = %label, interval_secs = self.interval_secs, "BatchWorker starting");
        if self.heartbeat.is_none() {
            warn!(worker = %label, "No heartbeat configured — watchdog stall detection disabled for this worker");
        }
        // Signal that the worker is initialising before the first cycle fires.
        crate::metrics::record_status(self.projection.name(), "batch", 0.0);

        loop {
            // Sleep first, then run cycle (gives event-driven projections
            // time to populate dirty sets on startup).
            tokio::select! {
                biased;
                _ = token.cancelled() => {
                    info!(worker = %label, "Cancellation requested, exiting cleanly");
                    break;
                }
                _ = tokio::time::sleep(interval) => {}
            }

            if token.is_cancelled() {
                break;
            }

            // Beat after waking from the inter-cycle sleep so the watchdog does not
            // mistake a quiescent batch worker (long interval, no active events) for
            // a stalled one.  The worker is alive; it just hasn't started a cycle yet.
            if let Some(ref hb) = self.heartbeat {
                hb.beat();
            }

            // Signal that a batch cycle is actively running.
            crate::metrics::record_status(self.projection.name(), "batch", 1.0);

            let cycle_start = std::time::Instant::now();

            // Run cycle with retry. The semaphore permit is acquired INSIDE the
            // closure so it is held only for the duration of `run_cycle` and
            // released automatically when the closure returns.
            let ctx = RetryContext {
                circuit_breaker: Arc::clone(&self.circuit_breaker),
                projection_name: self.projection.name().to_string(),
                target: "pg".to_string(),
                heartbeat: self.heartbeat.clone(),
            };
            let proj_name = self.projection.name();
            let pool = &self.pool;
            let projection = &self.projection;
            let partitioner = &self.partitioner;

            let cycle_result = retry_with_backoff(&self.retry_policy, &ctx, &label, || async {
                let _permit = partitioner
                    .acquire(proj_name)
                    .await
                    .map_err(|e| ProjectionError::Sink(e.to_string()))?;

                projection.run_cycle(pool).await
            })
            .await;

            match cycle_result {
                Ok(()) => {
                    let duration_ms = cycle_start.elapsed().as_millis();
                    // Cycle finished successfully — report live/idle until next wake.
                    crate::metrics::record_status(self.projection.name(), "batch", 2.0);

                    // Emit available permits so the Prometheus gauge stays current.
                    if let Some(available) = self.partitioner.available_permits(proj_name) {
                        crate::metrics::set_semaphore_available(proj_name, available);
                    }

                    // Heartbeat — signal liveness to the watchdog.
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }

                    info!(worker = %label, duration_ms, "Batch cycle completed");
                }
                Err(e) => {
                    // Batch cycle exhausted per-cycle retries but this is not
                    // fatal for the worker process — back off and let the timer
                    // fire again so transient DB issues self-heal.
                    crate::metrics::record_status(self.projection.name(), "batch", 3.0);
                    warn!(
                        worker = %label,
                        error = %e,
                        "Batch cycle failed after retries; backing off before next cycle"
                    );
                    // Beat before the 30s cooldown so the watchdog does not fire
                    // while the worker is actively waiting to recover.
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }
                    // 30-second cooldown before the next cycle attempt.
                    tokio::select! {
                        biased;
                        _ = token.cancelled() => {
                            info!(worker = %label, "Cancellation during error backoff, exiting");
                            break;
                        }
                        _ = tokio::time::sleep(tokio::time::Duration::from_secs(30)) => {}
                    }
                }
            }
        }

        info!(worker = %label, "BatchWorker stopped");
        Ok(())
    }
}
