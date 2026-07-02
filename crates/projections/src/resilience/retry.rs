//! Shared retry infrastructure for all projection worker types.
//!
//! All four worker types (`Worker`, `PgWorker`, `BatchWorker`,
//! `CoreEntitiesWorker`) implement the same retry loop:
//!
//! 1. Check the circuit breaker before every attempt.
//! 2. Call the operation.
//! 3. On transient error: record failure, apply exponential back-off with
//!    50–100 % jitter, then retry up to `max_retries` times.
//! 4. On non-transient error: return immediately.
//! 5. On success: record success and return.
//!
//! This module factors out the common skeleton so each worker only needs to
//! supply its operation closure and context.

use std::sync::Arc;

use tokio_util::sync::CancellationToken;
use tracing::{error, warn};

use super::circuit_breaker::{CircuitBreaker, CircuitState};
use super::watchdog::Heartbeat;
use crate::error::{ErrorClass, ProjectionError};
use crate::util::rand_u64;

// ---------------------------------------------------------------------------
// WorkerConfig
// ---------------------------------------------------------------------------

/// Tunable parameters for event-driven workers.
///
/// Consolidates the two scalar "config" parameters that were previously
/// positional arguments in every `Worker::new` / `PgWorker::new` signature.
/// Inject a `WorkerConfig` instead of separate `batch_size` and
/// `poll_interval_ms` arguments to keep constructors under the 5-parameter
/// limit.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkerConfig {
    /// Maximum number of events fetched per poll cycle.
    pub batch_size: usize,
    /// Milliseconds to wait when the event log has no new events.
    pub poll_interval_ms: u64,
}

impl WorkerConfig {
    /// Create a `WorkerConfig` from explicit values.
    pub fn new(batch_size: usize, poll_interval_ms: u64) -> Self {
        Self {
            batch_size,
            poll_interval_ms,
        }
    }
}

// ---------------------------------------------------------------------------
// RetryPolicy
// ---------------------------------------------------------------------------

/// Configuration for the retry loop, shared across all worker types.
///
/// The loop doubles `base_backoff_secs` after each failed attempt until
/// `max_backoff_secs` is reached, then holds at that ceiling. 50–100 %
/// random jitter is added on top to spread out thundering-herd retries.
#[derive(Debug, Clone, Copy)]
pub struct RetryPolicy {
    /// Maximum number of attempts (including the first) before giving up.
    pub max_retries: u32,
    /// Starting back-off delay in seconds.
    pub base_backoff_secs: u64,
    /// Upper bound on the back-off delay in seconds.
    pub max_backoff_secs: u64,
}

impl RetryPolicy {
    /// Standard policy for event-driven workers (`Worker`, `PgWorker`,
    /// `CoreEntitiesWorker`): 8 attempts, 1–30 s back-off.
    ///
    /// Set high enough to ride out transaction-conflict storms during bulk
    /// reprocessing when all workers contend on overlapping rows.
    pub const fn event_driven() -> Self {
        Self {
            max_retries: 8,
            base_backoff_secs: 1,
            max_backoff_secs: 30,
        }
    }

    /// Policy for timer-driven batch workers (`BatchWorker`): fewer attempts,
    /// slightly longer base delay because cycles are minutes apart.
    pub const fn batch() -> Self {
        Self {
            max_retries: 5,
            base_backoff_secs: 2,
            max_backoff_secs: 30,
        }
    }
}

// ---------------------------------------------------------------------------
// RetryContext
// ---------------------------------------------------------------------------

/// Per-call context threaded into [`retry_with_backoff`] for circuit-breaker
/// integration and Prometheus label emission.
pub struct RetryContext {
    /// Circuit breaker to check before and update after every attempt.
    pub circuit_breaker: Arc<CircuitBreaker>,
    /// Projection name used as a Prometheus label (e.g. `"vault_state"`).
    pub projection_name: String,
    /// Target database used as a Prometheus label (e.g. `"pg"`, `"surrealdb"`).
    pub target: String,
    /// Optional heartbeat to beat after each backoff sleep so the watchdog
    /// does not mistake a worker that is actively retrying for a stalled one.
    ///
    /// When `None`, heartbeat reporting is disabled (e.g. in tests).
    pub heartbeat: Option<Heartbeat>,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Sleep for `duration_ms` milliseconds, waking early if `token` is cancelled.
///
/// The cancellation branch is preferred (`biased`) so that shutdown signals
/// are always handled promptly, even when the sleep duration has already
/// elapsed.
///
/// # Arguments
///
/// * `duration_ms` — sleep duration in milliseconds.
/// * `token` — cancellation token; when cancelled the function returns immediately.
pub async fn sleep_or_cancel(duration_ms: u64, token: &CancellationToken) {
    tokio::select! {
        biased;
        _ = token.cancelled() => {}
        _ = tokio::time::sleep(tokio::time::Duration::from_millis(duration_ms)) => {}
    }
}

/// Compute a jitter-augmented sleep duration in milliseconds.
///
/// The returned value is in the range `[delay_secs * 1000, delay_secs * 1500)`,
/// i.e. 50–100 % of the nominal delay, which prevents thundering-herd retries
/// when multiple workers encounter the same transient failure simultaneously.
///
/// # Arguments
///
/// * `delay_secs` – nominal back-off period in seconds.
#[inline]
pub fn compute_jitter_ms(delay_secs: u64) -> u64 {
    let jitter = delay_secs * 500 + (rand_u64() % (delay_secs * 500 + 1));
    delay_secs * 1000 + jitter
}

// ---------------------------------------------------------------------------
// retry_with_backoff
// ---------------------------------------------------------------------------

/// Execute `operation` with retry, circuit-breaker protection, and
/// exponential back-off.
///
/// # Behaviour
///
/// For each attempt (up to `policy.max_retries`):
///
/// 1. **Circuit-breaker check** — if the breaker is open, wait for the probe
///    interval then continue to the next attempt (or return
///    [`ProjectionError::CircuitOpen`] on the final attempt).
/// 2. **Call `operation()`** — the closure performs the actual database work.
/// 3. **Success path** — calls `ctx.circuit_breaker.record_success()`, updates
///    circuit-state metrics, and returns `Ok(())`.
/// 4. **Transient error path** — calls `ctx.circuit_breaker.record_failure()`,
///    emits circuit-state and circuit-open-count metrics, logs a warning, and
///    sleeps for the jittered back-off before the next attempt.  On the final
///    attempt the original error is returned.
/// 5. **Non-transient error path** — returned immediately without retry.
///
/// # Metrics
///
/// The function emits circuit-state and (on Closed → Open transitions)
/// circuit-open-count metrics via [`crate::metrics`].  Per-operation error
/// counters (`record_error`) are intentionally **not** emitted here; call
/// sites are responsible for recording those in their own error paths so the
/// label dimensions remain correct.
///
/// # Arguments
///
/// * `policy` – retry-loop configuration (attempt count, back-off bounds).
/// * `ctx` – circuit-breaker handle and label strings for metrics.
/// * `label` – human-readable worker identifier for log messages.
/// * `operation` – async closure returning `Result<(), ProjectionError>`.
///   Semaphore permit acquisition (for PG workers) must happen **inside** this
///   closure so that different workers can choose whether to use one.
///
/// # Errors
///
/// Returns the last error after all retries are exhausted, or the first
/// non-transient error encountered.
pub async fn retry_with_backoff<F, Fut>(
    policy: &RetryPolicy,
    ctx: &RetryContext,
    label: &str,
    mut operation: F,
) -> Result<(), ProjectionError>
where
    F: FnMut() -> Fut,
    Fut: std::future::Future<Output = Result<(), ProjectionError>>,
{
    let mut delay_secs = policy.base_backoff_secs;

    for attempt in 1..=policy.max_retries {
        // ---- Circuit-breaker pre-check -----------------------------------
        if let Err(open) = ctx.circuit_breaker.check() {
            crate::metrics::set_circuit_state(
                &ctx.projection_name,
                &ctx.target,
                ctx.circuit_breaker.state() as u8,
            );
            if attempt < policy.max_retries {
                warn!(
                    worker = %label,
                    attempt,
                    circuit = %open,
                    "Circuit breaker open; waiting for probe interval"
                );
                tokio::time::sleep(open.next_probe_in).await;
                // Beat after sleeping so the watchdog sees that the worker is
                // alive and actively waiting for the circuit to close, rather
                // than mistaking the long sleep for a stall.
                if let Some(ref hb) = ctx.heartbeat {
                    hb.beat();
                }
                delay_secs = (delay_secs * 2).min(policy.max_backoff_secs);
                continue;
            } else {
                return Err(ProjectionError::CircuitOpen(open.to_string()));
            }
        }

        // ---- Execute operation -------------------------------------------
        // Take ownership of the error value so we can return it without
        // lifetime issues (sqlx::Error is not Clone so we cannot store a
        // reference across an await point).
        let result = operation().await;

        match result {
            Ok(()) => {
                ctx.circuit_breaker.record_success();
                crate::metrics::set_circuit_state(
                    &ctx.projection_name,
                    &ctx.target,
                    ctx.circuit_breaker.state() as u8,
                );
                return Ok(());
            }

            Err(e)
                if matches!(
                    e.classify(),
                    ErrorClass::Transient | ErrorClass::CircuitProtected
                ) =>
            {
                ctx.circuit_breaker.record_failure();
                // Emit the circuit-open counter exactly once on each
                // Closed → Open transition.
                if ctx.circuit_breaker.state() == CircuitState::Open {
                    crate::metrics::record_circuit_open(&ctx.projection_name, &ctx.target);
                }
                crate::metrics::set_circuit_state(
                    &ctx.projection_name,
                    &ctx.target,
                    ctx.circuit_breaker.state() as u8,
                );

                if attempt < policy.max_retries {
                    warn!(
                        worker = %label,
                        attempt,
                        retry_in_secs = delay_secs,
                        error = %e,
                        "Transient error; will retry"
                    );
                    let sleep_ms = compute_jitter_ms(delay_secs);
                    tokio::time::sleep(tokio::time::Duration::from_millis(sleep_ms)).await;
                    // Beat after each backoff sleep: the worst-case event-driven
                    // sequence sums to ~121 s (1+2+4+8+16+30+30+30), which exceeds
                    // the 120 s watchdog threshold if we never beat during retries.
                    if let Some(ref hb) = ctx.heartbeat {
                        hb.beat();
                    }
                    delay_secs = (delay_secs * 2).min(policy.max_backoff_secs);
                } else {
                    // Final attempt exhausted — return the original error
                    // rather than wrapping it in a string so callers can still
                    // inspect the variant.
                    error!(
                        worker = %label,
                        attempt,
                        error = %e,
                        "Transient error on final attempt; giving up"
                    );
                    return Err(e);
                }
            }

            Err(e) => {
                // Non-transient (e.g. serialisation failure, bad data): do
                // not retry; it will not succeed on subsequent attempts.
                error!(worker = %label, error = %e, "Non-transient error; not retrying");
                return Err(e);
            }
        }
    }

    unreachable!("retry_with_backoff: loop must have returned")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify the exponential back-off sequence doubles and caps correctly for
    /// the event-driven policy.
    #[test]
    fn event_driven_backoff_sequence() {
        let policy = RetryPolicy::event_driven();
        let mut delay = policy.base_backoff_secs;
        let mut seq = vec![delay];
        for _ in 1..policy.max_retries {
            delay = (delay * 2).min(policy.max_backoff_secs);
            seq.push(delay);
        }
        assert_eq!(seq, vec![1, 2, 4, 8, 16, 30, 30, 30]);
    }

    /// Verify the back-off sequence for the batch policy.
    #[test]
    fn batch_backoff_sequence() {
        let policy = RetryPolicy::batch();
        let mut delay = policy.base_backoff_secs;
        let mut seq = vec![delay];
        for _ in 1..policy.max_retries {
            delay = (delay * 2).min(policy.max_backoff_secs);
            seq.push(delay);
        }
        assert_eq!(seq, vec![2, 4, 8, 16, 30]);
    }

    /// `compute_jitter_ms` must always return at least `delay_secs * 1000`.
    #[test]
    fn jitter_lower_bound() {
        for delay in 1u64..=30 {
            let ms = compute_jitter_ms(delay);
            assert!(
                ms >= delay * 1000,
                "jitter below lower bound: delay={delay}, ms={ms}"
            );
        }
    }

    /// `compute_jitter_ms` must not exceed `delay_secs * 2000`.
    #[test]
    fn jitter_upper_bound() {
        for delay in 1u64..=30 {
            let ms = compute_jitter_ms(delay);
            assert!(
                ms < delay * 2000 + 1,
                "jitter above upper bound: delay={delay}, ms={ms}"
            );
        }
    }

    /// Smoke-test `WorkerConfig` construction.
    #[test]
    fn worker_config_roundtrip() {
        let cfg = WorkerConfig::new(500, 250);
        assert_eq!(cfg.batch_size, 500);
        assert_eq!(cfg.poll_interval_ms, 250);
    }
}
