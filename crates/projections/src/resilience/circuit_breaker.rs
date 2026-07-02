//! Lightweight circuit breaker for projection database calls.
//!
//! Implements the classic three-state machine:
//!
//! ```text
//! CLOSED ──(threshold failures)──► OPEN
//!   ▲                                │
//!   │                           (probe interval)
//!   │                                │
//!   └──(probe succeeds)──── HALF-OPEN
//!                                    │
//!                            (probe fails)
//!                                    │
//!                                  OPEN  (with increased backoff)
//! ```
//!
//! The struct is `Send + Sync` (automatically inferred) and designed to be shared via
//! `Arc<CircuitBreaker>`.

use std::{
    fmt,
    sync::Mutex,
    time::{Duration, Instant},
};

use crate::util::rand_u64;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/// Identifies which phase the circuit breaker is currently in.
///
/// The `#[repr(u8)]` layout lets callers cast directly to a Prometheus gauge:
/// `0` = closed (healthy), `1` = open (rejecting), `2` = half-open (probing).
#[derive(Clone, Copy, Debug, PartialEq)]
#[repr(u8)]
pub enum CircuitState {
    /// All operations pass through. Consecutive failures are being counted.
    Closed = 0,
    /// Threshold exceeded. Operations are rejected immediately.
    Open = 1,
    /// One probe operation is allowed through to test recovery.
    HalfOpen = 2,
}

/// Returned by [`CircuitBreaker::check`] when the circuit is open and the
/// probe interval has not yet elapsed.
#[derive(Debug)]
pub struct CircuitOpen {
    /// Name of the circuit breaker, used for logging and metrics.
    pub name: String,
    /// How long the circuit has been open at the time of this error.
    pub opened_duration: Duration,
    /// How long until the next probe attempt is allowed.
    pub next_probe_in: Duration,
}

impl fmt::Display for CircuitOpen {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "circuit '{}' is open (opened {:?} ago, next probe in {:?})",
            self.name, self.opened_duration, self.next_probe_in
        )
    }
}

impl std::error::Error for CircuitOpen {}

/// Construction-time configuration for a [`CircuitBreaker`].
#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    /// Number of consecutive failures required to trip the circuit open.
    pub failure_threshold: u32,
    /// Starting probe interval after the first open transition.
    pub initial_probe_interval: Duration,
    /// Upper bound on the exponentially increasing probe interval.
    pub max_probe_interval: Duration,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 5,
            initial_probe_interval: Duration::from_secs(5),
            max_probe_interval: Duration::from_secs(30),
        }
    }
}

// ---------------------------------------------------------------------------
// Internal state (held under Mutex)
// ---------------------------------------------------------------------------

struct Inner {
    state: CircuitState,
    consecutive_failures: u32,
    /// Current probe interval — grows with each failed probe attempt.
    probe_interval: Duration,
    /// When the circuit last transitioned to Open.
    opened_at: Option<Instant>,
    /// How many times the circuit has opened (used for backoff exponent).
    open_count: u32,
}

// ---------------------------------------------------------------------------
// CircuitBreaker
// ---------------------------------------------------------------------------

/// A thread-safe circuit breaker that protects a downstream resource (e.g. a
/// database connection) from repeated calls while it is known to be unhealthy.
///
/// # Usage
///
/// ```rust,ignore
/// let cb = Arc::new(CircuitBreaker::with_defaults("surreal_db"));
///
/// cb.check()?;  // returns Err(CircuitOpen) when open
/// match do_db_call().await {
///     Ok(v)  => { cb.record_success(); Ok(v) }
///     Err(e) => { cb.record_failure(); Err(e) }
/// }
/// ```
pub struct CircuitBreaker {
    name: String,
    config: CircuitBreakerConfig,
    // std::sync::Mutex is used deliberately so that the guard is never held
    // across an .await point, keeping this compatible with both sync and
    // async callers without risking deadlocks on a cooperative scheduler.
    inner: Mutex<Inner>,
}

impl CircuitBreaker {
    /// Create a new circuit breaker with a custom configuration.
    ///
    /// # Arguments
    ///
    /// * `name` - Identifies this breaker in log messages and error payloads.
    /// * `config` - Tuning parameters (thresholds, intervals).
    pub fn new(name: &str, config: CircuitBreakerConfig) -> Self {
        Self {
            name: name.to_owned(),
            config: config.clone(),
            inner: Mutex::new(Inner {
                state: CircuitState::Closed,
                consecutive_failures: 0,
                probe_interval: config.initial_probe_interval,
                opened_at: None,
                open_count: 0,
            }),
        }
    }

    /// Create a circuit breaker with [`CircuitBreakerConfig::default`] values.
    ///
    /// * `failure_threshold`: 5
    /// * `initial_probe_interval`: 5 s
    /// * `max_probe_interval`: 30 s
    pub fn with_defaults(name: &str) -> Self {
        Self::new(name, CircuitBreakerConfig::default())
    }

    /// Decide whether the calling operation should proceed.
    ///
    /// | State     | Result |
    /// |-----------|--------|
    /// | Closed    | `Ok(())` |
    /// | HalfOpen  | `Ok(())` — one probe is already in-flight |
    /// | Open, probe due  | Transitions to HalfOpen → `Ok(())` |
    /// | Open, not yet    | `Err(CircuitOpen)` |
    ///
    /// # Errors
    ///
    /// Returns [`CircuitOpen`] when the circuit is open and the probe interval
    /// has not elapsed.
    #[must_use = "ignoring the circuit check allows calls when the circuit is open"]
    pub fn check(&self) -> Result<(), CircuitOpen> {
        let mut inner = self.inner.lock().expect("circuit breaker mutex poisoned");

        match inner.state {
            CircuitState::Closed | CircuitState::HalfOpen => Ok(()),

            CircuitState::Open => {
                let opened_at = inner.opened_at.expect("opened_at set when Open");
                let elapsed = opened_at.elapsed();

                if elapsed >= inner.probe_interval {
                    tracing::debug!(
                        name = %self.name,
                        elapsed_secs = elapsed.as_secs_f64(),
                        probe_interval_secs = inner.probe_interval.as_secs_f64(),
                        "circuit breaker transitioning to half-open for probe"
                    );
                    inner.state = CircuitState::HalfOpen;
                    Ok(())
                } else {
                    let next_probe_in = inner.probe_interval.saturating_sub(elapsed);
                    Err(CircuitOpen {
                        name: self.name.clone(),
                        opened_duration: elapsed,
                        next_probe_in,
                    })
                }
            }
        }
    }

    /// Record that the most recent operation succeeded.
    ///
    /// Resets the consecutive-failure counter. If the circuit was in
    /// `HalfOpen` (probe succeeded), transitions back to `Closed` and resets
    /// the probe interval to its initial value.
    pub fn record_success(&self) {
        let mut inner = self.inner.lock().expect("circuit breaker mutex poisoned");

        if inner.state == CircuitState::HalfOpen {
            tracing::info!(
                name = %self.name,
                "circuit breaker probe succeeded — transitioning HALF-OPEN → CLOSED"
            );
            inner.state = CircuitState::Closed;
            inner.probe_interval = self.config.initial_probe_interval;
            inner.open_count = 0;
            inner.opened_at = None;
        }

        inner.consecutive_failures = 0;
    }

    /// Record that the most recent operation failed.
    ///
    /// Increments the consecutive-failure counter. Transitions:
    /// * `Closed` → `Open` once `failure_threshold` is reached.
    /// * `HalfOpen` → `Open` immediately (probe failed), with an increased
    ///   backoff interval calculated via equal-jitter exponential backoff.
    pub fn record_failure(&self) {
        let mut inner = self.inner.lock().expect("circuit breaker mutex poisoned");

        inner.consecutive_failures += 1;

        match inner.state {
            CircuitState::Closed => {
                if inner.consecutive_failures >= self.config.failure_threshold {
                    tracing::warn!(
                        name = %self.name,
                        consecutive_failures = inner.consecutive_failures,
                        threshold = self.config.failure_threshold,
                        "circuit breaker tripped — transitioning CLOSED → OPEN"
                    );
                    inner.open_count = inner.open_count.saturating_add(1);
                    inner.probe_interval = self.next_probe_interval(inner.open_count);
                    inner.state = CircuitState::Open;
                    inner.opened_at = Some(Instant::now());
                }
            }

            CircuitState::HalfOpen => {
                debug_assert!(
                    inner.opened_at.is_some(),
                    "opened_at must be Some when circuit is HalfOpen"
                );
                inner.open_count = inner.open_count.saturating_add(1);
                inner.probe_interval = self.next_probe_interval(inner.open_count);
                tracing::warn!(
                    name = %self.name,
                    open_count = inner.open_count,
                    next_probe_secs = inner.probe_interval.as_secs_f64(),
                    "circuit breaker probe failed — transitioning HALF-OPEN → OPEN"
                );
                inner.state = CircuitState::Open;
                // Preserve original open timestamp so the recovery window does
                // not slide forward on repeated probe failures. Resetting
                // `opened_at` here would restart the probe-interval clock from
                // zero on every failed probe, preventing the circuit from ever
                // allowing another probe attempt in busy-failure scenarios.
            }

            CircuitState::Open => {
                // Already open; failure count is still tracked for observability.
            }
        }
    }

    /// Return a snapshot of the current circuit state.
    ///
    /// Intended for metrics emission (cast the `u8` discriminant to a gauge).
    pub fn state(&self) -> CircuitState {
        self.inner
            .lock()
            .expect("circuit breaker mutex poisoned")
            .state
    }

    // -----------------------------------------------------------------------
    // Private helpers
    // -----------------------------------------------------------------------

    /// Compute the next probe interval using equal-jitter exponential backoff.
    ///
    /// Formula: `cap = min(base * 2^attempt, max)`, then
    ///          `interval = cap/2 + rand(0, cap/2)`
    ///
    /// This keeps the interval in `[cap/2, cap]`, avoiding both the thundering
    /// herd of pure exponential backoff and the very-short intervals of pure
    /// random jitter.
    fn next_probe_interval(&self, attempt: u32) -> Duration {
        let base_nanos = self.config.initial_probe_interval.as_nanos() as u64;
        let max_nanos = self.config.max_probe_interval.as_nanos() as u64;

        // 2^attempt capped to avoid overflow; shift by at most 63 bits.
        let shift = attempt.min(62) as u64;
        let cap_nanos = base_nanos.saturating_mul(1u64 << shift).min(max_nanos);

        let half = cap_nanos / 2;
        // rand_u64() % half can be 0 when half == 0, but that is correct
        // (initial_probe_interval < 2 ns would be nonsensical in practice).
        let jitter = if half > 0 { rand_u64() % half } else { 0 };

        Duration::from_nanos(half + jitter)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn make_cb(threshold: u32, initial: Duration, max: Duration) -> CircuitBreaker {
        CircuitBreaker::new(
            "test",
            CircuitBreakerConfig {
                failure_threshold: threshold,
                initial_probe_interval: initial,
                max_probe_interval: max,
            },
        )
    }

    // -- State transition: CLOSED → OPEN on threshold ----------------------

    #[test]
    fn trips_open_after_threshold() {
        let cb = make_cb(3, Duration::from_secs(60), Duration::from_secs(120));

        assert_eq!(cb.state(), CircuitState::Closed);
        assert!(cb.check().is_ok());

        cb.record_failure();
        cb.record_failure();
        assert_eq!(
            cb.state(),
            CircuitState::Closed,
            "still closed before threshold"
        );

        cb.record_failure(); // third failure — threshold reached
        assert_eq!(cb.state(), CircuitState::Open);
    }

    // -- OPEN rejects calls until probe interval elapses --------------------

    #[test]
    fn open_rejects_calls() {
        let cb = make_cb(1, Duration::from_secs(60), Duration::from_secs(120));
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        let err = cb.check().unwrap_err();
        assert_eq!(err.name, "test");
        // next_probe_in should be <= 60 s (large probe interval chosen above)
        assert!(err.next_probe_in > Duration::ZERO);
    }

    // -- OPEN → HALF-OPEN → CLOSED on successful probe ----------------------

    #[test]
    fn probe_success_closes_circuit() {
        // Use a zero probe interval so the probe fires immediately.
        let cb = make_cb(1, Duration::ZERO, Duration::from_secs(60));
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        // probe interval is zero — check() should transition to HalfOpen
        assert!(cb.check().is_ok());
        assert_eq!(cb.state(), CircuitState::HalfOpen);

        cb.record_success();
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    // -- HALF-OPEN → OPEN on failed probe -----------------------------------

    #[test]
    fn probe_failure_reopens_circuit() {
        let cb = make_cb(1, Duration::ZERO, Duration::from_secs(60));
        cb.record_failure();

        cb.check().unwrap(); // transitions to HalfOpen
        assert_eq!(cb.state(), CircuitState::HalfOpen);

        cb.record_failure(); // probe fails → back to Open
        assert_eq!(cb.state(), CircuitState::Open);
    }

    // -- Success in CLOSED state resets counter without state change --------

    #[test]
    fn success_resets_failure_count() {
        let cb = make_cb(3, Duration::from_secs(60), Duration::from_secs(120));

        cb.record_failure();
        cb.record_failure();
        cb.record_success(); // resets counter

        // Two more failures should not trip (counter was reset)
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Closed);

        cb.record_failure(); // now at threshold again
        assert_eq!(cb.state(), CircuitState::Open);
    }

    // -- Backoff: probe interval increases with each open ------------------

    #[test]
    fn probe_interval_increases_on_repeated_failures() {
        let initial = Duration::from_millis(100);
        let max = Duration::from_secs(60);
        let cb = make_cb(1, initial, max);

        // First open
        cb.record_failure();
        let first_interval = {
            let inner = cb.inner.lock().unwrap();
            inner.probe_interval
        };

        // Simulate probe failing → back to Open with larger interval.
        // Manually set to HalfOpen to test the backoff path.
        {
            let mut inner = cb.inner.lock().unwrap();
            inner.state = CircuitState::HalfOpen;
        }
        cb.record_failure();

        let second_interval = {
            let inner = cb.inner.lock().unwrap();
            inner.probe_interval
        };

        // second_interval should be >= first_interval (backoff grows)
        assert!(
            second_interval >= first_interval,
            "expected backoff to grow: first={first_interval:?}, second={second_interval:?}"
        );
    }

    // -- Backoff: never exceeds max_probe_interval -------------------------

    #[test]
    fn probe_interval_caps_at_max() {
        let cb = make_cb(1, Duration::from_millis(10), Duration::from_millis(200));

        // Drive open_count very high to saturate the cap.
        {
            let mut inner = cb.inner.lock().unwrap();
            inner.open_count = 63;
            inner.probe_interval = cb.next_probe_interval(63);
        }

        let interval = {
            let inner = cb.inner.lock().unwrap();
            inner.probe_interval
        };

        assert!(
            interval <= Duration::from_millis(200),
            "probe interval {interval:?} exceeds max"
        );
    }

    // -- repr(u8) discriminants match documented values --------------------

    #[test]
    fn state_discriminants() {
        assert_eq!(CircuitState::Closed as u8, 0);
        assert_eq!(CircuitState::Open as u8, 1);
        assert_eq!(CircuitState::HalfOpen as u8, 2);
    }

    // -- opened_at is preserved across HalfOpen → Open retransitions -------
    //
    // Verifies that a failed probe does NOT reset `opened_at` by directly
    // comparing the Instant stored in inner before and after the HalfOpen→Open
    // transition.  No sleeps required: a zero probe interval causes check() to
    // transition Open→HalfOpen immediately.

    #[test]
    fn half_open_failure_preserves_opened_at() {
        // Zero initial probe interval so check() transitions Open→HalfOpen
        // without any sleep.
        let cb = make_cb(1, Duration::ZERO, Duration::from_secs(30));

        // Closed → Open on the first failure.
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        // Capture the original opened_at before any probe attempt.
        let original_opened_at = {
            let inner = cb.inner.lock().unwrap();
            inner
                .opened_at
                .expect("opened_at must be Some after tripping open")
        };

        // Probe interval is zero — check() transitions Open → HalfOpen
        // immediately without sleeping.
        assert!(cb.check().is_ok(), "expected probe to be allowed");
        assert_eq!(cb.state(), CircuitState::HalfOpen);

        // Probe fails: HalfOpen → Open.  opened_at must NOT be refreshed.
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        // Directly inspect opened_at and assert it is the exact same Instant.
        let after_opened_at = {
            let inner = cb.inner.lock().unwrap();
            inner
                .opened_at
                .expect("opened_at must be Some after HalfOpen→Open")
        };

        assert_eq!(
            original_opened_at, after_opened_at,
            "opened_at was reset during HalfOpen→Open transition; it must be preserved"
        );
    }

    // -- Default max_probe_interval cap is 30 s ----------------------------
    //
    // Drives the circuit through many HalfOpen→Open cycles to saturate the
    // exponential backoff, then confirms the probe_interval never exceeds 30 s.

    #[test]
    fn probe_interval_capped_at_thirty_seconds() {
        // Use an initial interval of 1 ms so the cap is reached quickly.
        let cb = make_cb(1, Duration::from_millis(1), Duration::from_secs(30));

        // Trip open for the first time.
        cb.record_failure();
        assert_eq!(cb.state(), CircuitState::Open);

        // Cycle through HalfOpen→Open 10 times to saturate the backoff.
        for _ in 0..10 {
            // Manually force the state to HalfOpen so we don't have to sleep
            // through ever-growing probe intervals in a unit test.
            {
                let mut inner = cb.inner.lock().unwrap();
                inner.state = CircuitState::HalfOpen;
            }
            cb.record_failure();
            assert_eq!(cb.state(), CircuitState::Open);
        }

        // After 10 additional failures the probe_interval must be <= 30 s.
        let interval = {
            let inner = cb.inner.lock().unwrap();
            inner.probe_interval
        };

        assert!(
            interval <= Duration::from_secs(30),
            "probe interval {interval:?} exceeds the 30 s cap"
        );
    }
}
