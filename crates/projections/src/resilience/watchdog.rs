//! Heartbeat-based watchdog for detecting and cancelling stalled projection workers.
//!
//! Workers can hang indefinitely on database queries with no error and no timeout.
//! This module provides:
//!
//! - [`Heartbeat`] — a shared handle that workers update after every successful batch.
//! - [`WatchedWorker`] — a registration entry pairing a heartbeat with a cancellation token.
//! - [`Watchdog`] — a background task that polls heartbeats and cancels stalled workers.
//!
//! # Example
//!
//! ```rust,no_run
//! use std::time::Duration;
//! use tokio_util::sync::CancellationToken;
//! use projections::resilience::watchdog::{Heartbeat, WatchedWorker, Watchdog};
//!
//! let heartbeat = Heartbeat::new();
//! let worker_token = CancellationToken::new();
//!
//! let mut watchdog = Watchdog::with_defaults();
//! watchdog.register(WatchedWorker {
//!     name: "atom_worker".to_string(),
//!     heartbeat: heartbeat.clone(),
//!     cancel_token: worker_token.clone(),
//! });
//!
//! // In the worker loop, call after each successful batch:
//! heartbeat.beat();
//! ```

use std::sync::atomic::{AtomicI64, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use tokio_util::sync::CancellationToken;

/// Sentinel value stored in [`Heartbeat::last_beat_ms`] before any beat has been recorded.
const NEVER_BEATEN: i64 = -1;

// ---------------------------------------------------------------------------
// Heartbeat
// ---------------------------------------------------------------------------

/// A handle that workers use to report liveness.
///
/// The timestamp is stored as milliseconds elapsed since a fixed reference
/// [`Instant`] captured at construction time. Using [`Instant`] (monotonic clock)
/// instead of [`std::time::SystemTime`] avoids false stall detection from NTP
/// corrections or clock skew.
///
/// [`Heartbeat`] is [`Clone`] and `Send + Sync`, so both the worker and the
/// watchdog (or a health endpoint) can hold independent copies that all observe
/// the same underlying atomic.
#[derive(Clone)]
pub struct Heartbeat {
    /// Elapsed milliseconds since `reference` when the last heartbeat was recorded.
    /// Holds [`NEVER_BEATEN`] (-1) until the first call to [`beat`](Self::beat).
    last_beat_ms: Arc<AtomicI64>,
    /// Fixed reference instant captured at creation time. All elapsed durations
    /// are computed relative to this instant so overflow takes ~292 million years.
    ///
    /// `Instant` is `Copy`, so all clones of this `Heartbeat` share the same
    /// epoch value — they all measure elapsed time from the same starting point.
    reference: Instant,
}

impl Heartbeat {
    /// Create a new heartbeat handle. The initial state is "never beaten".
    pub fn new() -> Self {
        Self {
            last_beat_ms: Arc::new(AtomicI64::new(NEVER_BEATEN)),
            // Capture the reference instant once; all future measurements are
            // relative to this point, giving us a monotonically increasing i64.
            reference: Instant::now(),
        }
    }

    /// Record a heartbeat. Call this after every successful batch in the worker loop.
    ///
    /// Uses [`Ordering::Relaxed`] because there is no happens-before relationship
    /// required — the watchdog only needs to observe "is this value recent enough?",
    /// not synchronise access to any other memory.
    pub fn beat(&self) {
        let elapsed_ms = self.reference.elapsed().as_millis() as i64;
        self.last_beat_ms.store(elapsed_ms, Ordering::Relaxed);
    }

    /// Return how long has elapsed since the last heartbeat, or [`None`] if the
    /// worker has never beaten (i.e., has not yet processed a single batch).
    ///
    /// Uses [`Ordering::Relaxed`] for the same reason as [`beat`](Self::beat).
    pub fn elapsed_since_last_beat(&self) -> Option<Duration> {
        let last_ms = self.last_beat_ms.load(Ordering::Relaxed);
        if last_ms == NEVER_BEATEN {
            return None;
        }
        // `self.reference.elapsed()` is the number of milliseconds since reference.
        // `last_ms` is the snapshot taken at the last beat. The difference is how
        // long ago the beat happened.
        let now_ms = self.reference.elapsed().as_millis() as i64;
        let elapsed_ms = (now_ms - last_ms).max(0) as u64;
        Some(Duration::from_millis(elapsed_ms))
    }

    /// Return the underlying [`Arc<AtomicI64>`] for external reads, e.g. a health
    /// endpoint that wants to expose the raw timestamp without importing this type.
    ///
    /// Only compiled in test builds — this method is not used in production code paths.
    #[cfg(test)]
    pub fn raw(&self) -> &Arc<AtomicI64> {
        &self.last_beat_ms
    }
}

impl Default for Heartbeat {
    fn default() -> Self {
        Self::new()
    }
}

// ---------------------------------------------------------------------------
// WatchedWorker
// ---------------------------------------------------------------------------

/// A worker registration entry for the watchdog.
///
/// Pair a [`Heartbeat`] (updated by the worker) with a [`CancellationToken`]
/// (cancelled by the watchdog when a stall is detected).
pub struct WatchedWorker {
    /// Human-readable name used in log messages and metrics labels.
    pub name: String,
    /// Liveness signal updated by the worker after every successful batch.
    pub heartbeat: Heartbeat,
    /// Per-worker cancellation token. The watchdog calls `.cancel()` on this
    /// when the worker exceeds `stall_threshold` without a heartbeat.
    pub cancel_token: CancellationToken,
}

// ---------------------------------------------------------------------------
// Watchdog
// ---------------------------------------------------------------------------

/// Background task that polls registered workers and cancels any that appear stalled.
///
/// A worker is considered stalled when [`Heartbeat::elapsed_since_last_beat`] returns
/// a duration exceeding `stall_threshold`. The watchdog cancels the worker's
/// [`CancellationToken`] exactly once per stall event and resets the stall state
/// when the worker recovers (e.g., after supervisor restart with a fresh heartbeat).
pub struct Watchdog {
    workers: Vec<WatchedWorker>,
    /// How often the watchdog wakes to inspect all worker heartbeats. Default: 10 s.
    check_interval: Duration,
    /// How long without a heartbeat before a worker is declared stalled. Default: 120 s.
    stall_threshold: Duration,
}

impl Watchdog {
    /// Create a watchdog with explicit `check_interval` and `stall_threshold`.
    pub fn new(check_interval: Duration, stall_threshold: Duration) -> Self {
        Self {
            workers: Vec::new(),
            check_interval,
            stall_threshold,
        }
    }

    /// Create a watchdog with sensible defaults: 10 s check interval, 120 s stall threshold.
    pub fn with_defaults() -> Self {
        Self::new(Duration::from_secs(10), Duration::from_secs(120))
    }

    /// Register a worker to be watched. Must be called before [`run`](Self::run).
    pub fn register(&mut self, worker: WatchedWorker) {
        self.workers.push(worker);
    }

    /// Run the watchdog loop until `shutdown_token` is cancelled.
    ///
    /// Every `check_interval`, each registered worker's heartbeat is inspected.
    /// A worker that has not beaten within `stall_threshold` has its cancellation
    /// token cancelled and a stall counter incremented in Prometheus. Stall state
    /// is tracked per-worker so the cancel fires exactly once; if a worker recovers
    /// (supervisor restarted it with a fresh [`Heartbeat`]), the stall flag resets.
    ///
    /// # Arguments
    ///
    /// * `shutdown_token` — global shutdown signal; cancelling this exits the loop cleanly.
    pub async fn run(self, shutdown_token: CancellationToken) {
        let Self {
            workers,
            check_interval,
            stall_threshold,
        } = self;

        // Per-worker boolean: true while the worker is currently considered stalled
        // and its token has already been cancelled. Resets to false once the worker
        // starts beating again (supervisor restarted it).
        let mut stalled: Vec<bool> = vec![false; workers.len()];

        let mut interval = tokio::time::interval(check_interval);
        // Skip ticks that were missed while the check itself was running, to
        // avoid a burst of back-to-back checks after a slow iteration.
        interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);

        loop {
            tokio::select! {
                _ = interval.tick() => {}
                _ = shutdown_token.cancelled() => {
                    tracing::info!("Watchdog shutting down");
                    return;
                }
            }

            for (i, worker) in workers.iter().enumerate() {
                match worker.heartbeat.elapsed_since_last_beat() {
                    None => {
                        // Worker has never beaten yet — give it time to start up.
                        // Do not count this as a stall; the startup window is not
                        // bounded by stall_threshold.
                    }
                    Some(elapsed) if elapsed > stall_threshold && !stalled[i] => {
                        // First detection of this stall — log, record metric, cancel.
                        tracing::warn!(
                            worker = %worker.name,
                            elapsed_secs = elapsed.as_secs(),
                            threshold_secs = stall_threshold.as_secs(),
                            "Worker stall detected — cancelling worker"
                        );
                        crate::metrics::record_stall_detected(&worker.name);
                        worker.cancel_token.cancel();
                        stalled[i] = true;
                        // Subsequent ticks while still stalled: silently skip to avoid
                        // log spam. The supervisor is responsible for restarting.
                    }
                    Some(elapsed) if elapsed > stall_threshold => {
                        // Already stalled — silently skip to avoid log spam.
                        let _ = elapsed;
                    }
                    Some(_) if stalled[i] => {
                        // Worker is beating normally and was previously stalled —
                        // supervisor must have restarted it.
                        tracing::info!(
                            worker = %worker.name,
                            "Worker recovered — stall state reset"
                        );
                        stalled[i] = false;
                    }
                    Some(_) => {
                        // Worker is beating normally and was not stalled.
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    /// Freshly constructed heartbeat returns None (sentinel state).
    #[test]
    fn heartbeat_never_beaten_returns_none() {
        let hb = Heartbeat::new();
        assert!(
            hb.elapsed_since_last_beat().is_none(),
            "expected None before first beat"
        );
    }

    /// After a beat, elapsed_since_last_beat returns Some with a non-negative duration.
    #[test]
    fn heartbeat_after_beat_returns_some() {
        let hb = Heartbeat::new();
        hb.beat();
        let elapsed = hb.elapsed_since_last_beat();
        assert!(elapsed.is_some(), "expected Some after first beat");
        // The elapsed time since we just beat should be tiny (< 1 s in any sane environment).
        assert!(
            elapsed.unwrap() < Duration::from_secs(1),
            "elapsed should be near-zero immediately after beat"
        );
    }

    /// Clones share the same underlying atomic, so a beat on one clone is visible
    /// through the other.
    #[test]
    fn heartbeat_clone_shares_state() {
        let hb1 = Heartbeat::new();
        let hb2 = hb1.clone();

        // Neither has beaten yet.
        assert!(hb1.elapsed_since_last_beat().is_none());
        assert!(hb2.elapsed_since_last_beat().is_none());

        // Beat on hb1; hb2 should also see it.
        hb1.beat();
        assert!(hb2.elapsed_since_last_beat().is_some());
    }

    /// Stall threshold check: elapsed > threshold triggers stall logic.
    ///
    /// This test synthesises a heartbeat with a reference in the past so that
    /// elapsed_since_last_beat() immediately exceeds the threshold without needing
    /// to actually sleep.
    #[test]
    fn stall_threshold_exceeded_when_beat_is_old() {
        let hb = Heartbeat::new();
        // Simulate an old beat by storing a very small ms value (i.e., the beat
        // occurred 0 ms after reference, so now the elapsed is reference.elapsed()).
        hb.last_beat_ms.store(0, Ordering::Relaxed);

        // The reference was captured "just now", so elapsed since beat ≈ elapsed
        // since reference ≈ 0 for a freshly constructed Heartbeat. We need the
        // reference to be old.  Instead, verify the math directly: manually
        // place the last_beat at 0 ms and check that elapsed is at least the
        // time since the reference was created (which is >= 0).
        let elapsed = hb
            .elapsed_since_last_beat()
            .expect("should be Some after manual store");
        // elapsed should be >= 0 and < 1 second (test runs fast).
        assert!(elapsed < Duration::from_secs(1));

        // Now simulate a "long-ago" beat by storing a negative-offset value.
        // We store `current_ms - 200_000` (i.e., 200 seconds ago).
        let now_ms = hb.reference.elapsed().as_millis() as i64;
        hb.last_beat_ms.store(now_ms - 200_000, Ordering::Relaxed);

        let elapsed = hb
            .elapsed_since_last_beat()
            .expect("should be Some after manual store");
        assert!(
            elapsed >= Duration::from_secs(200),
            "expected >= 200s elapsed, got {:?}",
            elapsed
        );

        // Confirm this exceeds a 120 s stall threshold.
        assert!(elapsed > Duration::from_secs(120));
    }

    /// Sentinel value is preserved across a clone.
    #[test]
    fn sentinel_visible_through_raw() {
        let hb = Heartbeat::new();
        let raw = hb.raw().load(Ordering::Relaxed);
        assert_eq!(
            raw, NEVER_BEATEN,
            "raw should expose the sentinel before first beat"
        );

        hb.beat();
        let raw_after = hb.raw().load(Ordering::Relaxed);
        assert!(raw_after >= 0, "after beat, raw value should be >= 0");
    }
}
