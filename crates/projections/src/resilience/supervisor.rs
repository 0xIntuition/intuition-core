//! Supervisor: infinite-restart wrapper for projection workers.
//!
//! The [`Supervisor`] manages a single worker and restarts it automatically
//! after any transient failure using exponential backoff with jitter.  Only
//! fatal errors (e.g. configuration problems) stop the restart loop.
//!
//! ## Design
//!
//! Workers are created by a *factory closure* on every restart.  The factory
//! is required because every worker type (`Worker`, `PgWorker`, `BatchWorker`)
//! *consumes* itself on `.run()`, so a fresh instance must be constructed for
//! each attempt.
//!
//! The supervisor exits only when the global [`CancellationToken`] is
//! cancelled, which is the standard orderly-shutdown signal used throughout
//! this service.
//!
//! ## Backoff sequence
//!
//! Delays double from [`MIN_BACKOFF`] up to [`MAX_BACKOFF`], with ±50% jitter
//! applied to each value to spread thundering-herd restarts:
//!
//! ```text
//! attempt:  1      2      3      4       5       6+
//! base:     1 s    2 s    4 s    8 s    16 s    30 s  (capped)
//! range:   0.5-1.5  1-3  2-6   4-12   8-24   15-45
//! ```
//!
//! After a worker runs for [`HEALTHY_RESET_AFTER`] without returning an error,
//! the backoff state resets to minimum so that the next failure starts the
//! sequence from the beginning again.

use std::future::Future;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;
use tracing::{error, info, warn};

use crate::util::rand_u64;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Initial (minimum) restart backoff delay.
const MIN_BACKOFF: Duration = Duration::from_secs(1);

/// Maximum restart backoff delay.
const MAX_BACKOFF: Duration = Duration::from_secs(30);

/// If a worker runs continuously for this long without error, its backoff
/// state is reset to [`MIN_BACKOFF`] so the next failure starts fresh.
const HEALTHY_RESET_AFTER: Duration = Duration::from_secs(300); // 5 minutes

// ---------------------------------------------------------------------------
// WorkerError
// ---------------------------------------------------------------------------

/// Error returned by a supervised worker to control restart behaviour.
///
/// The supervisor inspects this type after each `run()` exit to decide
/// whether to restart the worker or stop permanently.
#[derive(Debug)]
pub enum WorkerError {
    /// Transient failure — the supervisor will restart the worker with backoff.
    ///
    /// Use this for database connectivity issues, network timeouts, or any
    /// condition that is expected to resolve on its own.
    Transient(String),

    /// Fatal failure — the supervisor will **not** restart the worker.
    ///
    /// Use this for configuration errors, incompatible schema versions, or
    /// any condition where retrying would be pointless.
    Fatal(String),
}

impl std::fmt::Display for WorkerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WorkerError::Transient(msg) => write!(f, "transient: {msg}"),
            WorkerError::Fatal(msg) => write!(f, "fatal: {msg}"),
        }
    }
}

// ---------------------------------------------------------------------------
// SupervisedWorker trait
// ---------------------------------------------------------------------------

/// Abstraction over different concrete worker types that the [`Supervisor`]
/// can manage.
///
/// Implementors receive a per-run child [`CancellationToken`] so the supervisor
/// can force-stop a stalled worker independently of the global shutdown token.
///
/// Native async fn in trait (Rust 1.75+) is used here; no `async_trait` macro
/// is required.  The returned future is implicitly `Send` because `W: Send`.
pub trait SupervisedWorker: Send + 'static {
    /// Human-readable identifier used in log messages and metrics labels.
    ///
    /// Should follow the convention used elsewhere in this service:
    /// `"<projection>:<sink>:<optional-shard>"` — e.g. `"vault_state:pg:s0"`.
    fn name(&self) -> &str;

    /// Run the worker until it completes, errors, or the token is cancelled.
    ///
    /// # Arguments
    ///
    /// * `token` — A *child* of the global shutdown token created by the
    ///   supervisor.  The supervisor can cancel this child token to abort a
    ///   stalled worker without triggering the global shutdown.
    ///
    /// # Returns
    ///
    /// * `Ok(())` — Clean exit (token was cancelled or no more work).
    /// * `Err(WorkerError::Transient(_))` — Failure that warrants a restart.
    /// * `Err(WorkerError::Fatal(_))` — Permanent failure; do not restart.
    fn run(
        &mut self,
        token: CancellationToken,
    ) -> impl Future<Output = Result<(), WorkerError>> + Send;
}

// ---------------------------------------------------------------------------
// Supervisor
// ---------------------------------------------------------------------------

/// Manages one worker with automatic restart and exponential backoff.
///
/// Construct with [`Supervisor::new`] and drive with [`Supervisor::run`].
/// The supervisor exits cleanly when the provided [`CancellationToken`] fires.
pub struct Supervisor {
    /// Human-readable identifier (mirrors the worker's name).
    name: String,

    // --- Backoff state ---
    /// Total number of times the worker has been (re)started.
    restart_count: u32,
    /// Number of consecutive failures since the last healthy reset.
    consecutive_failures: u32,
    /// Backoff delay that will be applied before the *next* restart.
    current_backoff: Duration,
    /// Instant at which the most recent healthy run began, if any.
    last_healthy_at: Option<Instant>,

    // --- Backoff configuration ---
    min_backoff: Duration,
    max_backoff: Duration,
    /// A run must stay up this long without error to be considered healthy and
    /// to trigger a backoff reset.
    healthy_reset_after: Duration,

    // --- Shutdown ---
    /// Global cancellation token.  The supervisor exits when this is cancelled.
    global_token: CancellationToken,
}

impl Supervisor {
    /// Create a new supervisor with default backoff parameters.
    ///
    /// # Arguments
    ///
    /// * `name` — Human-readable name for the supervised worker (used in logs
    ///   and metrics); should match `SupervisedWorker::name()`.
    /// * `global_token` — The process-wide cancellation token.  The supervisor
    ///   exits when this is cancelled.
    pub fn new(name: impl Into<String>, global_token: CancellationToken) -> Self {
        Self {
            name: name.into(),
            restart_count: 0,
            consecutive_failures: 0,
            current_backoff: MIN_BACKOFF,
            last_healthy_at: None,
            min_backoff: MIN_BACKOFF,
            max_backoff: MAX_BACKOFF,
            healthy_reset_after: HEALTHY_RESET_AFTER,
            global_token,
        }
    }

    /// Run the worker produced by `factory` indefinitely, restarting on failure.
    ///
    /// The factory closure is called once per (re)start to produce a fresh
    /// worker instance.  This is necessary because worker `run()` methods
    /// consume `self`.
    ///
    /// The method returns only when `global_token` is cancelled.
    ///
    /// # Arguments
    ///
    /// * `factory` — Closure that constructs a fresh `W` on each call.
    ///
    /// # Type Parameters
    ///
    /// * `F` — Factory type; `FnMut() -> W`.
    /// * `W` — Concrete worker type implementing [`SupervisedWorker`].
    pub async fn run<F, W>(mut self, mut factory: F)
    where
        F: FnMut() -> W,
        W: SupervisedWorker,
    {
        loop {
            // Exit immediately if the global shutdown has already been requested.
            // This is a fast path that avoids constructing a new worker instance
            // just to cancel it immediately.
            if self.global_token.is_cancelled() {
                info!(worker = %self.name, "Global shutdown active; supervisor exiting");
                return;
            }

            // --- Maybe reset backoff after a sustained healthy period ----------
            // Check before constructing the worker so we start each run with the
            // correct delay already computed.
            self.maybe_reset_backoff();

            // --- Build a fresh worker instance --------------------------------
            // Each restart needs a brand-new instance because `.run()` consumes
            // the worker (moves it into the spawned task).
            let mut worker = factory();
            self.restart_count += 1;

            info!(
                worker = %worker.name(),
                attempt = self.restart_count,
                "Supervisor starting worker"
            );

            // --- Create a per-run child token ---------------------------------
            // This lets the supervisor (or a future watchdog) cancel just this
            // worker run without triggering the global shutdown.
            let run_token = self.global_token.child_token();

            // Record the wall time at which this run began so we can evaluate
            // the healthy-reset condition after it exits.
            let run_started_at = Instant::now();

            // --- Spawn and await the worker -----------------------------------
            // Running inside `tokio::spawn` lets us catch panics via `JoinError`.
            // Without `spawn`, a worker panic would propagate and kill the
            // supervisor task too.
            let handle = tokio::spawn(async move { worker.run(run_token).await });

            let outcome = handle.await;

            // --- Handle global shutdown ---------------------------------------
            // Always check for cancellation before deciding whether to restart,
            // so a clean shutdown is never delayed by restart logic.
            if self.global_token.is_cancelled() {
                info!(worker = %self.name, "Global shutdown; supervisor exiting after worker stop");
                return;
            }

            // --- Interpret the join result ------------------------------------
            match outcome {
                // Task completed cleanly — not a failure.
                Ok(Ok(())) => {
                    // A clean Ok(()) means the worker exited due to cancellation
                    // or an orderly "no more work" condition.  Do NOT increment
                    // consecutive_failures; doing so would escalate backoff on
                    // orderly shutdowns and clean no-op exits.
                    if run_started_at.elapsed() >= self.healthy_reset_after {
                        self.last_healthy_at = Some(run_started_at);
                    }
                    if self.global_token.is_cancelled() {
                        info!(
                            worker = %self.name,
                            "Global shutdown; supervisor exiting after clean worker exit"
                        );
                        return;
                    }
                    info!(worker = %self.name, "Worker exited cleanly; will restart after brief delay");
                    // Use minimum backoff for clean exits — do not escalate.
                    tokio::select! {
                        biased;
                        _ = self.global_token.cancelled() => { return; }
                        _ = tokio::time::sleep(self.min_backoff) => {}
                    }
                    continue; // Skip the escalating backoff section below.
                }
                Ok(Err(WorkerError::Transient(ref msg))) => {
                    warn!(
                        worker = %self.name,
                        error = %msg,
                        attempt = self.restart_count,
                        consecutive_failures = self.consecutive_failures + 1,
                        "Worker failed with transient error; will restart"
                    );
                    self.record_transient_failure(run_started_at);
                }
                Ok(Err(WorkerError::Fatal(ref msg))) => {
                    error!(
                        worker = %self.name,
                        error = %msg,
                        "Worker failed with fatal error; supervisor stopping permanently"
                    );
                    // Fatal errors are not restartable.  The global token is
                    // intentionally NOT cancelled here — other workers continue.
                    return;
                }
                // `JoinError::try_into_panic` consumes the error by value, so
                // we cannot use a `ref` pattern here.  Instead we match by value
                // and handle panic vs. abort as two branches of the same arm.
                Err(join_err) => {
                    if join_err.is_panic() {
                        // Attempt to extract a human-readable message from the panic
                        // payload.  Common payloads are `&str` or `String`; anything
                        // else falls back to a generic message.
                        let panic_msg = join_err
                            .try_into_panic()
                            .ok()
                            .and_then(|p| {
                                p.downcast_ref::<&str>()
                                    .map(|s| (*s).to_owned())
                                    .or_else(|| p.downcast_ref::<String>().cloned())
                            })
                            .unwrap_or_else(|| "unknown panic payload".to_owned());

                        error!(
                            worker = %self.name,
                            panic = %panic_msg,
                            attempt = self.restart_count,
                            "Worker panicked; treating as transient and restarting"
                        );
                    } else {
                        // Non-panic join error: task was aborted by the runtime.
                        warn!(
                            worker = %self.name,
                            "Worker task aborted by runtime; treating as transient"
                        );
                    }
                    self.record_transient_failure(run_started_at);
                }
            }

            // --- Apply restart metrics ----------------------------------------
            // Publish both the total restart count and the pending backoff
            // delay so operators can observe escalating restart storms.
            // Only reached for transient/panic exits; clean Ok(()) takes the
            // `continue` path above.
            record_restart(&self.name, self.current_backoff);

            // --- Wait before restarting ---------------------------------------
            let backoff = self.current_backoff;
            let jittered = apply_jitter(backoff);

            info!(
                worker = %self.name,
                attempt = self.restart_count,
                backoff_ms = jittered.as_millis(),
                "Supervisor waiting before restart"
            );

            // Honour the global shutdown token during the backoff sleep so
            // that Ctrl-C / SIGTERM is always responsive.
            tokio::select! {
                biased;
                _ = self.global_token.cancelled() => {
                    info!(worker = %self.name, "Shutdown during backoff; supervisor exiting");
                    return;
                }
                _ = tokio::time::sleep(jittered) => {}
            }

            // Advance backoff for the *next* failure (doubles up to max_backoff).
            self.current_backoff = (self.current_backoff * 2).min(self.max_backoff);
        }
    }

    // -------------------------------------------------------------------------
    // Private helpers
    // -------------------------------------------------------------------------

    /// Update failure counters after a transient failure.
    ///
    /// Records when healthy behaviour was last observed so that
    /// [`Self::maybe_reset_backoff`] can evaluate the 5-minute healthy window.
    fn record_transient_failure(&mut self, run_started_at: Instant) {
        self.consecutive_failures += 1;

        // If the run survived longer than the healthy threshold, note that it
        // was healthy at the start of that run.  The next call to
        // `maybe_reset_backoff` will then reset the backoff sequence.
        if run_started_at.elapsed() >= self.healthy_reset_after {
            self.last_healthy_at = Some(run_started_at);
        }
    }

    /// Reset backoff to minimum if the last run was healthy for long enough.
    ///
    /// "Healthy" means the run lasted at least [`HEALTHY_RESET_AFTER`] without
    /// returning an error.  After a reset, `consecutive_failures` is also
    /// cleared so fresh failures start the doubling sequence from the bottom.
    fn maybe_reset_backoff(&mut self) {
        // The window is 2x healthy_reset_after to allow for the time between
        // the run ending and the next restart.  Without the multiplier, a run
        // that lasted exactly healthy_reset_after would have its last_healthy_at
        // immediately stale by the time maybe_reset_backoff is evaluated.
        let should_reset = self
            .last_healthy_at
            .map(|t| t.elapsed() < self.healthy_reset_after * 2)
            .unwrap_or(false);

        if should_reset {
            info!(
                worker = %self.name,
                "Worker was healthy; resetting backoff to minimum"
            );
            self.current_backoff = self.min_backoff;
            self.consecutive_failures = 0;
            self.last_healthy_at = None;
        }
    }
}

// ---------------------------------------------------------------------------
// Backoff jitter
// ---------------------------------------------------------------------------

/// Apply ±50% uniform jitter to `base`.
///
/// The returned duration falls in the range `[0.5 * base, 1.5 * base]`.
/// Using `rand_u64()` from this crate avoids any external crate dependency.
///
/// # Arguments
///
/// * `base` — The base backoff duration before jitter is applied.
fn apply_jitter(base: Duration) -> Duration {
    // Work in milliseconds to keep the arithmetic integer-only.
    let base_ms = base.as_millis() as u64;
    if base_ms == 0 {
        return base;
    }
    // half_ms is the half-width of the jitter window (±50% of base).
    let half_ms = base_ms / 2;
    // rand_u64() % (base_ms + 1) gives a uniform value in [0, base_ms].
    // Adding (base_ms / 2) then shifts the range to [0.5*base, 1.5*base].
    let jitter_ms = half_ms + (rand_u64() % (base_ms + 1));
    Duration::from_millis(jitter_ms)
}

// ---------------------------------------------------------------------------
// Metrics helpers
// ---------------------------------------------------------------------------

/// Increment the supervisor restart counter and set the backoff gauge for the
/// given worker.
///
/// Label format mirrors the rest of the service: the full worker name (which
/// already embeds projection + sink) is used as the `projection` label, and
/// a constant `"supervisor"` string is used as the `sink` label so the series
/// are easy to filter in Prometheus.
///
/// # Arguments
///
/// * `name` — Full worker name (e.g. `"vault_state:pg:s0"`).
/// * `next_backoff` — The backoff delay that will be applied before the next
///   restart attempt.
fn record_restart(name: &str, next_backoff: Duration) {
    crate::metrics::record_restart(name, "supervisor");
    crate::metrics::set_restart_backoff(name, "supervisor", next_backoff.as_secs_f64());
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ---- apply_jitter -------------------------------------------------------

    /// The jittered duration must always fall within [0.5 * base, 1.5 * base].
    #[test]
    fn jitter_stays_within_bounds() {
        let base = Duration::from_secs(4);
        let lo = Duration::from_millis(2000);
        let hi = Duration::from_millis(6000);

        for _ in 0..200 {
            let jittered = apply_jitter(base);
            assert!(
                jittered >= lo && jittered <= hi,
                "jittered {jittered:?} out of [{lo:?}, {hi:?}]"
            );
        }
    }

    /// Zero-duration base must not panic and must return zero.
    #[test]
    fn jitter_zero_base_is_zero() {
        assert_eq!(apply_jitter(Duration::ZERO), Duration::ZERO);
    }

    // ---- backoff doubling sequence ------------------------------------------

    /// Verify the doubling sequence caps at MAX_BACKOFF (30 s).
    #[test]
    fn backoff_doubles_and_caps() {
        let mut delay = MIN_BACKOFF;
        let mut sequence = vec![delay];
        // Simulate 8 consecutive failures — the same count used in Worker.
        for _ in 1..8 {
            delay = (delay * 2).min(MAX_BACKOFF);
            sequence.push(delay);
        }

        let expected_secs: Vec<u64> = sequence.iter().map(|d| d.as_secs()).collect();
        assert_eq!(expected_secs, vec![1, 2, 4, 8, 16, 30, 30, 30]);
    }

    // ---- maybe_reset_backoff ------------------------------------------------

    /// A supervisor whose last healthy run was recent should reset its backoff.
    #[test]
    fn reset_after_healthy_run() {
        let token = CancellationToken::new();
        let mut sup = Supervisor::new("test:pg:s0", token);

        // Simulate an escalated backoff.
        sup.current_backoff = Duration::from_secs(16);
        sup.consecutive_failures = 4;

        // Simulate a healthy run that ended 1 second ago (well within the
        // 5-minute healthy window).  We set last_healthy_at to an instant in
        // the past that satisfies `elapsed() < healthy_reset_after * 2`.
        sup.last_healthy_at = Some(Instant::now() - Duration::from_secs(1));

        sup.maybe_reset_backoff();

        assert_eq!(
            sup.current_backoff, MIN_BACKOFF,
            "backoff should have been reset to minimum"
        );
        assert_eq!(
            sup.consecutive_failures, 0,
            "consecutive_failures should be cleared"
        );
        assert!(
            sup.last_healthy_at.is_none(),
            "last_healthy_at should be cleared after reset"
        );
    }

    /// A supervisor whose last healthy run is too old should NOT reset.
    #[test]
    fn no_reset_when_healthy_run_is_stale() {
        let token = CancellationToken::new();
        let mut sup = Supervisor::new("test:pg:s0", token);

        sup.current_backoff = Duration::from_secs(16);
        sup.consecutive_failures = 4;

        // Healthy run was a long time ago — outside the reset window.
        // We set `last_healthy_at` to an instant older than `healthy_reset_after * 2`
        // so that `elapsed() >= healthy_reset_after * 2`.
        sup.last_healthy_at = Some(Instant::now() - sup.healthy_reset_after * 3);

        sup.maybe_reset_backoff();

        assert_eq!(
            sup.current_backoff,
            Duration::from_secs(16),
            "backoff should NOT have been reset"
        );
        assert_eq!(
            sup.consecutive_failures, 4,
            "failure count should be unchanged"
        );
    }

    /// With no prior healthy run recorded, `maybe_reset_backoff` is a no-op.
    #[test]
    fn no_reset_without_prior_healthy_run() {
        let token = CancellationToken::new();
        let mut sup = Supervisor::new("test:pg:s0", token);

        sup.current_backoff = Duration::from_secs(8);
        sup.consecutive_failures = 3;
        // last_healthy_at is None (default).

        sup.maybe_reset_backoff();

        assert_eq!(sup.current_backoff, Duration::from_secs(8));
        assert_eq!(sup.consecutive_failures, 3);
    }

    // ---- record_transient_failure -------------------------------------------

    /// A run that lasted longer than healthy_reset_after populates last_healthy_at.
    #[test]
    fn long_run_marks_as_healthy() {
        let token = CancellationToken::new();
        let mut sup = Supervisor::new("test:pg:s0", token);

        // Fake a start time that is healthy_reset_after + 1s in the past.
        let fake_start = Instant::now() - sup.healthy_reset_after - Duration::from_secs(1);

        sup.record_transient_failure(fake_start);

        assert!(
            sup.last_healthy_at.is_some(),
            "last_healthy_at should be set after a long run"
        );
        assert_eq!(sup.consecutive_failures, 1);
    }

    /// A run that was shorter than healthy_reset_after does NOT set last_healthy_at.
    #[test]
    fn short_run_does_not_mark_as_healthy() {
        let token = CancellationToken::new();
        let mut sup = Supervisor::new("test:pg:s0", token);

        // Fake a very recent start time (50ms ago — well under 5 minutes).
        let fake_start = Instant::now() - Duration::from_millis(50);

        sup.record_transient_failure(fake_start);

        assert!(
            sup.last_healthy_at.is_none(),
            "last_healthy_at should remain None for a short run"
        );
    }
}
