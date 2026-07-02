//! Per-(projection, sink) poll worker.
//!
//! Each `Worker` instance owns one `Projection` and one `ProjectionSink`.  It
//! reads events from the `EventReader` in batches, transforms them through the
//! projection, and writes the resulting operations to the sink.  Progress is
//! persisted in the `CheckpointStore` after every successful batch so the
//! worker can resume from the right position after a restart.

use std::sync::Arc;

use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use shared::parsed_event::ParsedEvent;

use crate::error::{ErrorClass, ProjectionError};
use crate::event::source::EventSource;
use crate::projection::Projection;
use crate::repo::dead_letter_repo;
use crate::resilience::checkpoint::CheckpointStore;
use crate::resilience::circuit_breaker::{CircuitBreaker, CircuitState};
use crate::resilience::retry::{
    retry_with_backoff, sleep_or_cancel, RetryContext, RetryPolicy, WorkerConfig,
};
use crate::resilience::watchdog::Heartbeat;
use crate::sink::ProjectionSink;

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

/// Drives a single (projection, sink) pair through the event log.
///
/// Construct via [`Worker::new`] and run via [`Worker::run`].
pub struct Worker {
    /// The projection used to transform raw events into sink operations.
    projection: Box<dyn Projection>,

    /// The sink that persists the derived state.
    sink: Arc<dyn ProjectionSink>,

    /// Persistent checkpoint store shared across all workers.
    checkpoint_store: Arc<CheckpointStore>,

    /// Source of raw blockchain events — either the monolithic event_store or
    /// per-type typed tables, selected at startup via the USE_TYPED_READER env var.
    event_reader: Arc<dyn EventSource>,

    /// Polling and batching configuration.
    config: WorkerConfig,

    /// Optional liveness signal updated after every successful batch.
    ///
    /// When `Some`, the worker calls [`Heartbeat::beat`] after each batch so
    /// the [`crate::watchdog::Watchdog`] can detect stalls.  `None` disables
    /// heartbeat reporting for backward compatibility with tests.
    heartbeat: Option<Heartbeat>,

    /// Shared circuit breaker protecting the SurrealDB sink from calls during
    /// outages.  Shared across all Workers targeting the same sink database so
    /// a single tripped circuit stops all SurrealDB writers simultaneously.
    circuit_breaker: Arc<CircuitBreaker>,

    /// Retry policy — shared constant for all event-driven workers.
    retry_policy: RetryPolicy,

    /// Optional PostgreSQL pool used to write rows to `projection_dead_letter`
    /// when a fatal projection error occurs on a single event.
    ///
    /// When `None` the worker logs the fatal error and skips the event as
    /// before — this preserves test harnesses that construct a `Worker`
    /// without a PostgreSQL connection.  Production wiring in `coordinator.rs`
    /// always populates this field so operators have a dead-letter row to
    /// inspect for every poison pill observed by a Surreal projection.
    dead_letter_pool: Option<PgPool>,
}

impl Worker {
    /// Create a new worker.
    ///
    /// # Arguments
    ///
    /// * `projection` - Boxed projection that transforms events
    /// * `sink` - Shared sink that receives the derived operations
    /// * `checkpoint_store` - Shared store for reading and writing checkpoints
    /// * `event_reader` - Shared reader implementing `EventSource` (either
    ///   `EventReader` or `TypedEventReader`, chosen at startup)
    /// * `circuit_breaker` - Shared circuit breaker protecting the SurrealDB sink
    /// * `config` - Batching and polling tunable parameters
    pub fn new(
        projection: Box<dyn Projection>,
        sink: Arc<dyn ProjectionSink>,
        checkpoint_store: Arc<CheckpointStore>,
        event_reader: Arc<dyn EventSource>,
        circuit_breaker: Arc<CircuitBreaker>,
        config: WorkerConfig,
    ) -> Self {
        Self {
            projection,
            sink,
            checkpoint_store,
            event_reader,
            config,
            heartbeat: None,
            circuit_breaker,
            retry_policy: RetryPolicy::event_driven(),
            dead_letter_pool: None,
        }
    }

    /// Attach a [`Heartbeat`] to this worker.
    ///
    /// The worker will call [`Heartbeat::beat`] after every successfully
    /// processed batch.  Must be called before [`run`](Self::run).
    pub fn with_heartbeat(mut self, heartbeat: Heartbeat) -> Self {
        self.heartbeat = Some(heartbeat);
        self
    }

    /// Attach a PostgreSQL pool used to write `projection_dead_letter` rows
    /// when a fatal projection error skips an event.
    ///
    /// Production wiring in `coordinator.rs` always calls this before
    /// running the worker so every Surreal-backed projection can surface
    /// poison pills to operators.
    pub fn with_dead_letter_pool(mut self, pool: PgPool) -> Self {
        self.dead_letter_pool = Some(pool);
        self
    }

    /// Return a human-readable identifier for log messages.
    #[inline]
    fn label(&self) -> String {
        format!("{}:{}", self.projection.name(), self.sink.name())
    }

    /// Run the poll loop until the `token` is cancelled.
    ///
    /// The loop:
    /// 1. Reads the current checkpoint from the store.
    /// 2. Polls the event reader for the next batch.
    /// 3. If the batch is empty, sleeps for `poll_interval_ms` then retries.
    /// 4. Projects every event into `SinkOperation`s.
    /// 5. Applies the operations to the sink with up to `MAX_RETRIES` retries
    ///    using exponential back-off on transient errors.
    /// 6. Saves the new checkpoint (max sequence number from the batch).
    /// 7. Records Prometheus metrics.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::WorkerStopped` when the loop exits due to a
    /// non-transient error.  Cancellation via the token is a clean exit and
    /// returns `Ok(())`.
    pub async fn run(self, token: CancellationToken) -> Result<(), ProjectionError> {
        let label = self.label();
        let event_type_strs: Vec<&str> = self
            .projection
            .event_types()
            .iter()
            .map(|et| et.as_str())
            .collect();

        info!(worker = %label, "Worker starting");
        if self.heartbeat.is_none() {
            warn!(worker = %label, "No heartbeat configured — watchdog stall detection disabled for this worker");
        }
        // Signal that the worker is initialising before entering the poll loop.
        crate::metrics::record_status(self.projection.name(), self.sink.name(), 0.0);

        loop {
            // --- Check cancellation before every cycle so we never start work
            //     that we will abandon mid-batch.
            if token.is_cancelled() {
                info!(worker = %label, "Cancellation requested, exiting cleanly");
                break;
            }

            // 1. Read checkpoint -----------------------------------------------
            let checkpoint = match self
                .checkpoint_store
                .get_checkpoint(self.projection.name(), self.sink.name())
                .await
            {
                Ok(seq) => seq,
                Err(e) => {
                    error!(worker = %label, error = %e, "Failed to read checkpoint; retrying after poll interval");
                    crate::metrics::record_error(self.projection.name(), self.sink.name());
                    crate::metrics::record_status(self.projection.name(), self.sink.name(), 3.0);
                    // Beat before sleeping: the worker is alive and chose to retry,
                    // so the watchdog must not treat consecutive DB errors as a stall.
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }
                    sleep_or_cancel(self.config.poll_interval_ms, &token).await;
                    continue;
                }
            };

            debug!(worker = %label, checkpoint, "Read checkpoint");

            // 2. Poll for events -----------------------------------------------
            let batch = match self
                .event_reader
                .read_batch_multi(&event_type_strs, checkpoint, self.config.batch_size as i64)
                .await
            {
                Ok(events) => events,
                Err(e) => {
                    error!(worker = %label, error = %e, "Failed to read event batch; retrying after poll interval");
                    crate::metrics::record_error(self.projection.name(), self.sink.name());
                    crate::metrics::record_status(self.projection.name(), self.sink.name(), 3.0);
                    // Beat before sleeping: same reasoning as the checkpoint error path above.
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }
                    sleep_or_cancel(self.config.poll_interval_ms, &token).await;
                    continue;
                }
            };

            // 3. Empty batch → live (caught up to head), wait and retry -------
            if batch.is_empty() {
                debug!(worker = %label, "No new events, sleeping for {}ms", self.config.poll_interval_ms);
                crate::metrics::record_status(self.projection.name(), self.sink.name(), 2.0);
                // Beat the heartbeat while idle so the watchdog doesn't
                // mistake a caught-up worker for a stalled one.
                if let Some(ref hb) = self.heartbeat {
                    hb.beat();
                }
                sleep_or_cancel(self.config.poll_interval_ms, &token).await;
                continue;
            }

            let batch_len = batch.len();
            debug!(worker = %label, count = batch_len, first_seq = batch[0].sequence_number, "Fetched batch");

            // Signal that we are actively processing events (behind head).
            crate::metrics::record_status(self.projection.name(), self.sink.name(), 1.0);

            let batch_start = std::time::Instant::now();

            // 4. Project all events into sink operations -----------------------
            let (all_ops, had_projection_error) = self.project_batch(&batch, &label).await;

            if all_ops.is_empty() && had_projection_error {
                // Every event in the batch failed projection.  Advance the
                // checkpoint past this batch so we do not spin on bad data.
                warn!(
                    worker = %label,
                    "All events in batch failed projection; advancing checkpoint to avoid spin"
                );
            }

            // 5. Apply batch to sink with exponential back-off retry ----------
            let apply_result = if all_ops.is_empty() {
                // Nothing to write — skip the sink round-trip entirely.
                Ok(())
            } else {
                let ctx = RetryContext {
                    circuit_breaker: Arc::clone(&self.circuit_breaker),
                    projection_name: self.projection.name().to_string(),
                    target: self.sink.name().to_string(),
                    heartbeat: self.heartbeat.clone(),
                };
                let sink = &self.sink;
                let ops = &all_ops;
                retry_with_backoff(&self.retry_policy, &ctx, &label, || async {
                    sink.apply_batch(ops).await
                })
                .await
            };

            if let Err(e) = apply_result {
                // After max retries the per-batch retry budget is exhausted, but
                // we deliberately do NOT stop the worker.  Instead we back off
                // and re-enter the poll loop from the same checkpoint so that
                // transient database outages are self-healing without operator
                // intervention.
                crate::metrics::record_status(self.projection.name(), self.sink.name(), 3.0);
                warn!(
                    worker = %label,
                    error = %e,
                    "Sink apply failed after retries; backing off before retry"
                );
                // Only beat if the circuit is healthy — when the circuit is open
                // and retries are exhausted, let the watchdog detect the stall
                // and trigger a supervisor restart.
                if self.circuit_breaker.state() != CircuitState::Open {
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }
                }
                // 30-second cooldown gives downstream services time to recover.
                sleep_or_cancel(30_000, &token).await;
                continue;
            }

            // 6 + 7. Save checkpoint and record metrics -----------------------
            let new_sequence = self
                .save_checkpoint_and_record_metrics(&batch, &label, batch_len, batch_start)
                .await;

            // 8. Heartbeat — signal liveness to the watchdog so it does not
            //    cancel this worker while we are making forward progress.
            if let Some(ref hb) = self.heartbeat {
                hb.beat();
            }

            let duration_secs = batch_start.elapsed().as_secs_f64();
            info!(
                worker = %label,
                count = batch_len,
                new_sequence,
                duration_ms = (duration_secs * 1000.0) as u64,
                "Batch processed"
            );

            // Only sleep when the batch was partial (fewer events than the batch
            // size cap), which signals we have caught up to the chain head.
            // A full batch means more events are likely waiting; skip the sleep
            // and re-enter the loop immediately to maximise backfill throughput.
            if batch_len < self.config.batch_size {
                sleep_or_cancel(self.config.poll_interval_ms, &token).await;
            } else {
                debug!(
                    worker = %label,
                    batch_len,
                    batch_size = self.config.batch_size,
                    "Full batch — skipping poll sleep for immediate re-fetch"
                );
            }
        }

        info!(worker = %label, "Worker stopped");
        Ok(())
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    /// Project all events in `batch` into sink operations.
    ///
    /// Parse-once semantics: the entire batch is converted from raw
    /// `StoredEvent` values into typed `ParsedEvent` values in a single pass
    /// before any projection logic runs.  This mirrors the pattern used by
    /// `PgWorker::apply_with_retry` and eliminates per-projection JSON
    /// re-parsing for projections that have been migrated to `project_parsed`.
    ///
    /// Returns `(ops, had_error)` where `had_error` is `true` when at least one
    /// event failed projection and was skipped.  Parse failures fall back to
    /// `ParsedEvent::Unknown` (never dropped) so unmigrated projections remain
    /// unaffected — they receive the original raw event via the trait default.
    async fn project_batch(
        &self,
        batch: &[shared::models::StoredEvent],
        label: &str,
    ) -> (Vec<crate::sink::SinkOperation>, bool) {
        // Phase 1 — parse once.  `parse_or_unknown` never drops an event:
        // on schema-mismatch it wraps the original `StoredEvent` in
        // `ParsedEvent::Unknown` and returns the error separately for logging.
        let mut parsed: Vec<ParsedEvent> = Vec::with_capacity(batch.len());
        for event in batch {
            let (p, maybe_err) = ParsedEvent::parse_or_unknown(event.clone());
            if let Some(err) = maybe_err {
                warn!(
                    worker = %label,
                    event_type = %event.event_type,
                    sequence   = event.sequence_number,
                    error      = %err,
                    "Failed to parse StoredEvent into typed variant; falling back to Unknown"
                );
                crate::metrics::record_parse_error(self.projection.name(), &event.event_type);
            }
            parsed.push(p);
        }
        // Invariant: every raw event maps to exactly one ParsedEvent.
        debug_assert_eq!(parsed.len(), batch.len());

        // Phase 2 — project each typed event.
        // Pre-size for 3 ops per event as a rough heuristic.
        let mut all_ops = Vec::with_capacity(batch.len() * 3);
        let mut had_error = false;

        for event in &parsed {
            match self.projection.project_parsed(event) {
                Ok(ops) => all_ops.extend(ops),
                Err(e) => {
                    warn!(
                        worker = %label,
                        sequence_number = event.sequence_number(),
                        error = %e,
                        "Projection error on event; skipping"
                    );
                    crate::metrics::record_error(self.projection.name(), self.sink.name());
                    // Worker-level dead-lettering: surface fatal projection
                    // errors to operators via `projection_dead_letter` so the
                    // Surreal worker benefits from the same poison-pill
                    // visibility as the PG / dual workers.  Transient errors
                    // are never dead-lettered — they are expected to self-heal
                    // on the next retry.
                    if let ErrorClass::Fatal = e.classify() {
                        if let Some(ref pool) = self.dead_letter_pool {
                            dead_letter_repo::record_fatal_event(
                                pool,
                                self.projection.name(),
                                event,
                                &e,
                            )
                            .await;
                        }
                    }
                    had_error = true;
                }
            }
        }

        (all_ops, had_error)
    }

    /// Persist the batch checkpoint and emit Prometheus metrics.
    ///
    /// Checkpoint save failures are non-fatal (idempotent sink ops make
    /// re-processing safe on restart), but are logged as warnings.
    /// Returns the new sequence number for use in the caller's log line,
    /// or `-1` if the invariant "batch is non-empty" was violated (should
    /// never happen under correct caller behaviour — the caller already
    /// filters empty batches — but we prefer a sentinel over a panic).
    async fn save_checkpoint_and_record_metrics(
        &self,
        batch: &[shared::models::StoredEvent],
        label: &str,
        batch_len: usize,
        batch_start: std::time::Instant,
    ) -> i64 {
        // `batch` is ordered ASC by sequence_number so the last element
        // is always the maximum.  The caller already verified that
        // `batch` is non-empty, but we avoid `.expect()` in the worker
        // hot path so a future refactor cannot cause a panic here.
        let Some(last) = batch.last() else {
            warn!(
                worker = %label,
                "invariant violated: empty batch reached checkpoint write; skipping batch"
            );
            return -1;
        };
        let new_sequence = last.sequence_number;
        let new_block = last.block_number;

        if let Err(e) = self
            .checkpoint_store
            .save_checkpoint(
                self.projection.name(),
                self.sink.name(),
                new_sequence,
                new_block,
            )
            .await
        {
            // Checkpoint failure is not fatal — at worst we re-process
            // this batch after a restart (idempotent sink operations make
            // this safe), but we log a warning so operators are alerted.
            warn!(worker = %label, error = %e, "Failed to save checkpoint; may re-process batch on restart");
        }

        let duration_secs = batch_start.elapsed().as_secs_f64();
        crate::metrics::record_batch_processed(
            self.projection.name(),
            self.sink.name(),
            batch_len as u64,
            duration_secs,
            new_sequence,
        );

        new_sequence
    }
}
