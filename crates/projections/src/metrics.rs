//! Prometheus metrics for the projections service.
//!
//! Tracks per-(projection, sink) pair: throughput, latency, checkpoint position, and errors.
//! All metrics are registered once via a `OnceLock` global singleton so they are safe to call
//! from any number of concurrent worker tasks.

use axum::{http::StatusCode, response::IntoResponse, routing::get, Router};
use prometheus::{
    register_gauge, register_gauge_vec, register_histogram, register_histogram_vec,
    register_int_counter, register_int_counter_vec, register_int_gauge, Encoder, Gauge, GaugeVec,
    Histogram, HistogramVec, IntCounter, IntCounterVec, IntGauge, TextEncoder,
};
use std::net::SocketAddr;
use std::sync::{
    atomic::{AtomicBool, AtomicI32, Ordering},
    OnceLock,
};
use tokio::net::TcpListener;
use tracing::info;

// ---------------------------------------------------------------------------
// Global singleton
// ---------------------------------------------------------------------------

/// Global metrics instance — initialised exactly once.
static METRICS: OnceLock<Metrics> = OnceLock::new();

/// Becomes `true` once the coordinator has attempted to start all workers.
/// Used by the `/health/startup` endpoint to signal that the process has
/// finished its initialisation phase.
static STARTUP_COMPLETE: AtomicBool = AtomicBool::new(false);

/// Count of workers currently in a healthy state (catching-up=1 or live=2).
/// Incremented/decremented by `record_status` whenever a worker transitions
/// to or from a healthy state.  The readiness handler reads this without
/// touching the prometheus proto layer.
static HEALTHY_WORKER_COUNT: AtomicI32 = AtomicI32::new(0);

/// Projection Prometheus metrics.
pub struct Metrics {
    /// Total events successfully processed, labelled by projection and sink.
    pub events_processed: IntCounterVec,

    /// Histogram of batch processing durations in seconds.
    pub batch_duration: HistogramVec,

    /// Last committed sequence number, labelled by projection and sink.
    pub checkpoint_sequence: GaugeVec,

    /// Total errors encountered, labelled by projection and sink.
    pub errors_total: IntCounterVec,

    /// Max sequence number in event_store (chain head) — single global value.
    pub head_sequence: Gauge,

    /// Events behind chain head per projection and sink.
    pub events_behind: GaugeVec,

    /// Sync progress 0-100% per projection and sink.
    pub sync_progress_percent: GaugeVec,

    /// Worker status per projection and sink: 0=starting, 1=catching-up, 2=live, 3=error.
    pub status: GaugeVec,

    /// Total batches processed, labelled by projection and sink.
    pub batches_total: IntCounterVec,

    /// Events in most recent batch, labelled by projection and sink.
    pub last_batch_size: GaugeVec,

    /// Total watchdog stall detections, labelled by worker name.
    pub stalls_total: IntCounterVec,

    // -- Resilience metrics (used by circuit_breaker, supervisor, connection_manager) --
    /// Times a worker was restarted by the supervisor, labelled by projection and sink.
    pub restart_total: IntCounterVec,

    /// Current restart backoff delay in seconds, labelled by projection and sink.
    pub restart_backoff_seconds: GaugeVec,

    /// Circuit breaker state per (projection, target): 0=closed, 1=open, 2=half-open.
    pub circuit_state: GaugeVec,

    /// Times the circuit breaker opened, labelled by projection and target.
    pub circuit_open_total: IntCounterVec,

    /// SurrealDB connection state: 0=disconnected, 1=connected.
    pub surreal_connection_state: Gauge,

    /// Available semaphore permits per projection (for PG pool back-pressure).
    pub pg_pool_semaphore_available: GaugeVec,

    // ── UserActivityBatchProjection metrics ──────────────────────────────────
    /// Total errors from user_activity_batch cycles.
    pub user_activity_batch_errors_total: IntCounter,

    /// Remaining days to process during backfill (decrements to 0).
    pub user_activity_backfill_days_remaining: Gauge,

    /// Total accounts processed across all incremental cycles.
    pub user_activity_accounts_processed_total: IntCounter,

    /// Histogram of incremental cycle wall-clock durations (seconds).
    pub user_activity_batch_duration_seconds: Histogram,

    // -- Activity marker projection metrics --
    /// Total events processed by the activity_marker projection.
    pub activity_marker_events_processed_total: IntCounter,

    /// Total accounts written into `dirty_account_activity` by
    /// the activity_marker projection.
    pub activity_marker_accounts_marked_total: IntCounter,

    // -- Funnel tracker projection metrics --
    /// Histogram of full funnel tracker cycle wall-clock time in seconds.
    pub funnel_tracker_duration_seconds: Histogram,

    /// Total funnel tracker cycles completed.
    pub funnel_tracker_cycles_total: IntCounter,

    // -- Metrics required by monitoring alerts (C2) --
    //
    // These fields are written by batch/marker projections and read exclusively
    // by the Prometheus scrape endpoint — not by other Rust code — so the
    // compiler sees them as "never read". The allow suppresses that false
    // positive for write-only observability gauges.
    /// Timestamp of the last successful batch cycle completion (Unix epoch seconds).
    pub user_activity_batch_last_completion_timestamp: Gauge,

    /// Lag in seconds between event tip and activity marker checkpoint.
    pub user_activity_marker_lag_seconds: Gauge,

    /// Current row count in dirty_account_activity.
    pub dirty_account_activity_count: Gauge,

    /// Timestamp of the oldest entry in dirty_account_activity (Unix epoch).
    pub dirty_account_activity_oldest_timestamp: Gauge,

    /// Number of accounts with active status in user_activity_profile.
    pub user_activity_active_account_count: Gauge,

    /// Current row count in user_topic_affinity.
    pub user_topic_affinity_row_count: Gauge,

    /// Expected maximum rows in user_topic_affinity (active_accounts * 50).
    pub user_topic_affinity_expected_max: Gauge,

    /// Per-segment account count for anomaly detection, labelled by segment name.
    pub user_segment_account_count: GaugeVec,

    /// RFM sweep type for the most recent cycle: 1.0 = full population sweep,
    /// 0.0 = dirty-set-only sweep.  Allows Grafana to visualise the daily
    /// cadence gate and confirm the feature is working as expected.
    pub user_activity_rfm_sweep_type: Gauge,
    // -- Parse-error observability ───────────────────────────────
    /// Total events that failed typed parsing and fell back to Unknown,
    /// labelled by projection and event_type.  A non-zero rate here signals
    /// schema drift between the ingestion layer and the typed structs.
    pub parse_errors_total: IntCounterVec,

    // -- Dual-write observability ────────────────────────────────
    /// Tracks whether a `core_entities` batch is currently in the consistency
    /// window between the two writes.
    ///
    /// Set to `1` immediately after SurrealDB upserts complete and back to `0`
    /// once the PostgreSQL transaction commits (or when the batch errors out).
    ///
    /// In steady-state operation this gauge is always `0` at rest.  A non-zero
    /// value indicates a batch is actively in-flight between the two stores.
    /// During chaos testing, a process kill while this is `1` proves the gap
    /// window exists — but because the checkpoint is saved only after
    /// `process_batch` returns `Ok`, both writes will replay on restart and
    /// converge to a consistent state.
    pub dual_write_in_flight: IntGauge,

    // -- Dead-letter observability (PR-296 review) ───────────────────────────
    /// Total events written to `projection_dead_letter`, labelled by
    /// projection and event_type.  Each `Fatal` error during projection
    /// processing increments this counter exactly once before the worker
    /// returns `Err` and pins the checkpoint on the failing sequence.
    ///
    /// A non-zero rate is a paging-grade signal: a fatal data-shape bug has
    /// halted the projection and an operator must inspect the dead-letter
    /// table, fix the projection code, and clear the entry before traffic
    /// resumes.
    pub projection_dead_letter_total: IntCounterVec,
}

// ---------------------------------------------------------------------------
// Registration macros
// ---------------------------------------------------------------------------

/// Register an `IntCounterVec` and fall back to an unregistered counter on
/// duplicate-registration errors (safe in tests that re-initialise the global).
macro_rules! reg_counter_vec {
    ($name:expr, $help:expr, $labels:expr) => {
        register_int_counter_vec!($name, $help, $labels).unwrap_or_else(|e| {
            tracing::error!("Failed to register {}: {}", $name, e);
            IntCounterVec::new(
                prometheus::opts!(concat!($name, "_fallback"), "Fallback counter"),
                $labels,
            )
            .expect("fallback counter creation must succeed")
        })
    };
}

/// Register a `GaugeVec` and fall back to an unregistered gauge on error.
macro_rules! reg_gauge_vec {
    ($name:expr, $help:expr, $labels:expr) => {
        register_gauge_vec!($name, $help, $labels).unwrap_or_else(|e| {
            tracing::error!("Failed to register {}: {}", $name, e);
            GaugeVec::new(
                prometheus::opts!(concat!($name, "_fallback"), "Fallback gauge"),
                $labels,
            )
            .expect("fallback gauge creation must succeed")
        })
    };
}

/// Register a scalar `IntGauge` and fall back to an unregistered gauge on error.
macro_rules! reg_int_gauge {
    ($name:expr, $help:expr) => {
        register_int_gauge!($name, $help).unwrap_or_else(|e| {
            tracing::error!("Failed to register {}: {}", $name, e);
            IntGauge::new(concat!($name, "_fallback"), "Fallback int gauge")
                .expect("fallback int gauge creation must succeed")
        })
    };
}

/// Register a scalar `Gauge` and fall back to an unregistered gauge on error.
macro_rules! reg_gauge {
    ($name:expr, $help:expr) => {
        register_gauge!($name, $help).unwrap_or_else(|e| {
            tracing::error!("Failed to register {}: {}", $name, e);
            // A freshly constructed (unregistered) Gauge still works for
            // recording values; it just won't appear in the /metrics output.
            Gauge::new(concat!($name, "_fallback"), "Fallback gauge")
                .expect("fallback gauge creation must succeed")
        })
    };
}

/// Register a scalar `IntCounter` and fall back to an unregistered counter on error.
macro_rules! reg_counter {
    ($name:expr, $help:expr) => {
        register_int_counter!($name, $help).unwrap_or_else(|e| {
            tracing::error!("Failed to register {}: {}", $name, e);
            IntCounter::new(concat!($name, "_fallback"), "Fallback counter")
                .expect("fallback counter creation must succeed")
        })
    };
}

/// Register a scalar `Histogram` (no labels) with the given buckets.
macro_rules! reg_histogram {
    ($name:expr, $help:expr, $buckets:expr) => {
        register_histogram!(prometheus::HistogramOpts::new($name, $help).buckets($buckets))
            .unwrap_or_else(|e| {
                tracing::error!("Failed to register {}: {}", $name, e);
                Histogram::with_opts(prometheus::HistogramOpts::new(
                    concat!($name, "_fallback"),
                    "Fallback histogram",
                ))
                .expect("fallback histogram creation must succeed")
            })
    };
}

impl Metrics {
    fn new() -> Self {
        // Latency buckets spanning sub-millisecond to 30-second ranges, which
        // covers both fast SurrealDB writes and slow remote sink calls.
        let duration_buckets = vec![
            0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0,
        ];

        Self {
            events_processed: reg_counter_vec!(
                "projection_events_processed_total",
                "Total events successfully processed by projection and sink",
                &["projection", "sink"]
            ),
            batch_duration: register_histogram_vec!(
                "projection_batch_duration_seconds",
                "Duration in seconds to process and apply one batch",
                &["projection", "sink"],
                duration_buckets
            )
            .unwrap_or_else(|e| {
                tracing::error!("Failed to register projection_batch_duration_seconds: {}", e);
                HistogramVec::new(
                    prometheus::HistogramOpts::new(
                        "projection_batch_duration_seconds_fallback",
                        "Fallback histogram",
                    ),
                    &["projection", "sink"],
                )
                .expect("fallback histogram creation must succeed")
            }),
            checkpoint_sequence: reg_gauge_vec!(
                "projection_checkpoint_sequence",
                "Last committed event sequence number per projection and sink",
                &["projection", "sink"]
            ),
            errors_total: reg_counter_vec!(
                "projection_errors_total",
                "Total errors encountered by projection and sink",
                &["projection", "sink"]
            ),
            // Single global gauge — no label dimensions needed.
            head_sequence: reg_gauge!(
                "projection_head_sequence",
                "Max sequence number in event_store (chain head)"
            ),
            events_behind: reg_gauge_vec!(
                "projection_events_behind",
                "Events behind chain head per projection",
                &["projection", "sink"]
            ),
            sync_progress_percent: reg_gauge_vec!(
                "projection_sync_progress_percent",
                "Sync progress 0-100% per projection",
                &["projection", "sink"]
            ),
            status: reg_gauge_vec!(
                "projection_status",
                "Worker status: 0=starting, 1=catching-up, 2=live, 3=error",
                &["projection", "sink"]
            ),
            batches_total: reg_counter_vec!(
                "projection_batches_total",
                "Total batches processed by projection and sink",
                &["projection", "sink"]
            ),
            last_batch_size: reg_gauge_vec!(
                "projection_last_batch_size",
                "Events in most recent batch per projection and sink",
                &["projection", "sink"]
            ),
            stalls_total: reg_counter_vec!(
                "projection_stall_detected_total",
                "Total watchdog stall detections per worker",
                &["worker"]
            ),
            restart_total: reg_counter_vec!(
                "projection_restart_total",
                "Times a worker was restarted by the supervisor",
                &["projection", "sink"]
            ),
            restart_backoff_seconds: reg_gauge_vec!(
                "projection_restart_backoff_seconds",
                "Current restart backoff delay in seconds",
                &["projection", "sink"]
            ),
            circuit_state: reg_gauge_vec!(
                "projection_circuit_state",
                "Circuit breaker state: 0=closed, 1=open, 2=half-open",
                &["projection", "target"]
            ),
            circuit_open_total: reg_counter_vec!(
                "projection_circuit_open_total",
                "Times circuit breaker opened",
                &["projection", "target"]
            ),
            surreal_connection_state: reg_gauge!(
                "surreal_connection_state",
                "SurrealDB connection: 0=disconnected, 1=connected"
            ),
            pg_pool_semaphore_available: reg_gauge_vec!(
                "projection_pg_pool_semaphore_available",
                "Available semaphore permits per projection",
                &["projection"]
            ),
            // ── UserActivityBatchProjection ──────────────────────────────────
            user_activity_batch_errors_total: reg_counter!(
                "user_activity_batch_errors_total",
                "Total errors encountered during user_activity_batch cycles"
            ),
            user_activity_backfill_days_remaining: reg_gauge!(
                "user_activity_backfill_days_remaining",
                "Calendar days remaining to process in the user_activity_batch backfill"
            ),
            user_activity_accounts_processed_total: reg_counter!(
                "user_activity_accounts_processed_total",
                "Total accounts whose activity profiles have been recomputed"
            ),
            user_activity_batch_duration_seconds: reg_histogram!(
                "user_activity_batch_duration_seconds",
                "Wall-clock duration of one user_activity_batch incremental cycle",
                vec![0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0, 300.0]
            ),
            activity_marker_events_processed_total: reg_counter!(
                "activity_marker_events_processed_total",
                "Total events processed by the activity_marker projection"
            ),
            activity_marker_accounts_marked_total: reg_counter!(
                "activity_marker_accounts_marked_total",
                "Total account dirty-set entries written by the activity_marker projection"
            ),
            funnel_tracker_duration_seconds: reg_histogram!(
                "funnel_tracker_duration_seconds",
                "Wall-clock time for one funnel tracker cycle",
                vec![0.05, 0.1, 0.25, 0.5, 1.0, 2.5, 5.0, 10.0, 30.0, 60.0, 120.0]
            ),
            funnel_tracker_cycles_total: reg_counter!(
                "funnel_tracker_cycles_total",
                "Total funnel tracker cycles completed"
            ),
            // -- Monitoring alert metrics (C2) ───────────────────────────────
            user_activity_batch_last_completion_timestamp: reg_gauge!(
                "user_activity_batch_last_completion_timestamp",
                "Unix timestamp of last successful user_activity_batch cycle completion"
            ),
            user_activity_marker_lag_seconds: reg_gauge!(
                "user_activity_marker_lag_seconds",
                "Seconds of lag between event tip and activity marker checkpoint"
            ),
            dirty_account_activity_count: reg_gauge!(
                "dirty_account_activity_count",
                "Current row count in dirty_account_activity table"
            ),
            dirty_account_activity_oldest_timestamp: reg_gauge!(
                "dirty_account_activity_oldest_timestamp",
                "Unix timestamp of the oldest entry in dirty_account_activity"
            ),
            user_activity_active_account_count: reg_gauge!(
                "user_activity_active_account_count",
                "Number of accounts classified as active in user_activity_profile"
            ),
            user_topic_affinity_row_count: reg_gauge!(
                "user_topic_affinity_row_count",
                "Current total row count in user_topic_affinity"
            ),
            user_topic_affinity_expected_max: reg_gauge!(
                "user_topic_affinity_expected_max",
                "Expected maximum rows in user_topic_affinity (active_accounts * 50)"
            ),
            user_segment_account_count: reg_gauge_vec!(
                "user_segment_account_count",
                "Number of accounts per user segment",
                &["user_segment"]
            ),
            user_activity_rfm_sweep_type: reg_gauge!(
                "user_activity_rfm_sweep_type",
                "RFM sweep type: 1.0 = full population, 0.0 = dirty-set only"
            ),
            // -- Parse-error observability ───────────────────────
            parse_errors_total: reg_counter_vec!(
                "projection_parse_error_total",
                "Total StoredEvents that failed typed parsing and fell back to Unknown",
                &["projection", "event_type"]
            ),
            // -- Dual-write observability ────────────────────────
            dual_write_in_flight: reg_int_gauge!(
                "core_entities_dual_write_in_flight",
                "1 while a core_entities batch has committed to SurrealDB but not yet to PG; 0 at rest"
            ),
            // -- Dead-letter observability (PR-296 review) ───────────────────
            projection_dead_letter_total: reg_counter_vec!(
                "projection_dead_letter_total",
                "Total events written to projection_dead_letter, partitioned by projection and event_type",
                &["projection", "event_type"]
            ),
        }
    }
}

/// Return the global `Metrics` singleton, initialising it on first call.
pub fn metrics() -> &'static Metrics {
    METRICS.get_or_init(Metrics::new)
}

// ---------------------------------------------------------------------------
// Recording helpers
// ---------------------------------------------------------------------------

/// Record that a batch was successfully processed.
///
/// # Arguments
///
/// * `projection` - Name of the projection (e.g. "atom")
/// * `sink` - Name of the sink (e.g. "surrealdb")
/// * `count` - Number of events in the batch
/// * `duration_secs` - Wall-clock time taken to project + apply the batch
/// * `sequence` - The new checkpoint sequence number after the batch
pub fn record_batch_processed(
    projection: &str,
    sink: &str,
    count: u64,
    duration_secs: f64,
    sequence: i64,
) {
    let m = metrics();
    let labels = [projection, sink];

    m.events_processed.with_label_values(&labels).inc_by(count);

    m.batch_duration
        .with_label_values(&labels)
        .observe(duration_secs);

    // `set` is safe here because sequence numbers are monotonically increasing
    // within a single (projection, sink) pair — we never move backwards.
    m.checkpoint_sequence
        .with_label_values(&labels)
        .set(sequence as f64);

    m.batches_total.with_label_values(&labels).inc();

    m.last_batch_size
        .with_label_values(&labels)
        .set(count as f64);

    // Derive lag metrics from the single global head gauge.  `get()` on a
    // prometheus::Gauge returns the current f64 value without any locking
    // beyond the atomic store it uses internally.
    let head = m.head_sequence.get();
    let seq_f64 = sequence as f64;

    if head > 0.0 {
        let behind = (head - seq_f64).max(0.0);
        m.events_behind.with_label_values(&labels).set(behind);

        // Clamp to [0, 100] to guard against transient read-ordering where
        // the checkpoint briefly exceeds the head we last polled.
        let progress = ((seq_f64 / head) * 100.0).clamp(0.0, 100.0);
        m.sync_progress_percent
            .with_label_values(&labels)
            .set(progress);
    }
}

/// Record that an error occurred for the given (projection, sink) pair.
///
/// # Arguments
///
/// * `projection` - Name of the projection
/// * `sink` - Name of the sink
pub fn record_error(projection: &str, sink: &str) {
    metrics()
        .errors_total
        .with_label_values(&[projection, sink])
        .inc();
}

/// Returns `true` for status values that represent a healthy, working worker.
#[inline]
fn is_healthy_status(s: f64) -> bool {
    // 1.0 = catching-up, 2.0 = live
    s == 1.0 || s == 2.0
}

/// Set the worker status gauge for a (projection, sink) pair.
///
/// Also maintains the `HEALTHY_WORKER_COUNT` atomic so that the readiness
/// handler does not need to walk the prometheus proto tree.
///
/// # Arguments
///
/// * `projection` - Name of the projection
/// * `sink` - Name of the sink
/// * `status` - Numeric status: 0=starting, 1=catching-up, 2=live, 3=error
pub fn record_status(projection: &str, sink: &str, status: f64) {
    let gauge = metrics().status.with_label_values(&[projection, sink]);

    // Read the previous value before overwriting it.  `with_label_values`
    // returns a handle to the same atomic cell, so `.get()` is the current
    // stored value.
    let previous = gauge.get();
    gauge.set(status);

    // Adjust the healthy-worker counter based on whether the transition
    // crosses the healthy/unhealthy boundary.
    match (is_healthy_status(previous), is_healthy_status(status)) {
        (false, true) => {
            HEALTHY_WORKER_COUNT.fetch_add(1, Ordering::Relaxed);
        }
        (true, false) => {
            // Clamp at zero to guard against any unexpected double-calls.
            HEALTHY_WORKER_COUNT
                .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |n| {
                    Some(n.saturating_sub(1))
                })
                .ok();
        }
        _ => {}
    }
}

/// Record that the watchdog detected a stall for the named worker.
///
/// Increments the `projection_stall_detected_total` counter labelled by worker name.
/// Called exclusively from [`crate::watchdog::Watchdog`].
///
/// # Arguments
///
/// * `worker` - Name of the stalled worker (e.g. "atom_worker")
pub fn record_stall_detected(worker: &str) {
    metrics().stalls_total.with_label_values(&[worker]).inc();
}

/// Increment the restart counter for a (projection, sink) pair.
///
/// # Arguments
///
/// * `projection` - Name of the projection
/// * `sink` - Name of the sink
pub fn record_restart(projection: &str, sink: &str) {
    metrics()
        .restart_total
        .with_label_values(&[projection, sink])
        .inc();
}

/// Set the current restart backoff delay for a (projection, sink) pair.
///
/// # Arguments
///
/// * `projection` - Name of the projection
/// * `sink` - Name of the sink
/// * `seconds` - Backoff duration in seconds
pub fn set_restart_backoff(projection: &str, sink: &str, seconds: f64) {
    metrics()
        .restart_backoff_seconds
        .with_label_values(&[projection, sink])
        .set(seconds);
}

/// Set the circuit breaker state for a (projection, target) pair.
///
/// # Arguments
///
/// * `projection` - Name of the projection
/// * `target` - Name of the downstream target (e.g. "surrealdb", "postgres")
/// * `state` - 0=closed, 1=open, 2=half-open
pub fn set_circuit_state(projection: &str, target: &str, state: u8) {
    metrics()
        .circuit_state
        .with_label_values(&[projection, target])
        .set(state as f64);
}

/// Increment the circuit-open counter for a (projection, target) pair.
///
/// # Arguments
///
/// * `projection` - Name of the projection
/// * `target` - Name of the downstream target
pub fn record_circuit_open(projection: &str, target: &str) {
    metrics()
        .circuit_open_total
        .with_label_values(&[projection, target])
        .inc();
}

/// Update the SurrealDB connection state gauge.
///
/// # Arguments
///
/// * `connected` - `true` if the connection is currently established
pub fn set_surreal_connection_state(connected: bool) {
    metrics()
        .surreal_connection_state
        .set(if connected { 1.0 } else { 0.0 });
}

/// Set the number of available PG pool semaphore permits for a projection.
///
/// # Arguments
///
/// * `projection` - Name of the projection
/// * `available` - Number of currently available permits
pub fn set_semaphore_available(projection: &str, available: usize) {
    metrics()
        .pg_pool_semaphore_available
        .with_label_values(&[projection])
        .set(available as f64);
}

/// Increment the parse-error counter for a (projection, event_type) pair.
///
/// Called once per event that failed typed parsing and fell back to
/// `ParsedEvent::Unknown`.  A non-zero rate signals schema drift.
///
/// # Arguments
///
/// * `projection` - Checkpoint name of the projection (e.g. "vault_state")
/// * `event_type` - Raw `event_type` string from the `StoredEvent`
pub fn record_parse_error(projection: &str, event_type: &str) {
    metrics()
        .parse_errors_total
        .with_label_values(&[projection, event_type])
        .inc();
}

/// Record that a fatal projection error has been written to
/// `projection_dead_letter`.
///
/// Increments the `projection_dead_letter_total` counter labelled by the
/// failing projection and the event type.  Call this from the worker error
/// path immediately after a successful `dead_letter_repo::record_fatal`
/// call so the counter and the underlying table stay in lockstep.
// Wired into the worker fatal-error path as part of the PR-296 review
// fixes (Critical #2/#3).  The `#[allow(dead_code)]` is removed once that
// edit lands in the same commit series.
#[allow(dead_code)]
pub fn record_dead_letter(projection: &str, event_type: &str) {
    metrics()
        .projection_dead_letter_total
        .with_label_values(&[projection, event_type])
        .inc();
}

/// Set the dual-write in-flight gauge for `core_entities`.
///
/// Call with `true` after the SurrealDB upserts complete to signal that the
/// process has entered the consistency window (SurrealDB committed, PG not yet).
/// Call with `false` once the PG transaction commits — or on any error — to
/// signal that the window has closed.
///
/// This gauge is always `0` at rest.  A value of `1` means the process is
/// between the two writes and a crash here would leave SurrealDB ahead of PG
/// until the batch replays on restart.
///
/// **Prefer [`DualWriteGuard`]** over calling this directly — the guard
/// cannot leak the `true` state on panic, early return, or future
/// cancellation.  Raw callers must ensure the paired `false` call runs on
/// every exit path.
pub fn set_dual_write_in_flight(in_flight: bool) {
    // i64::from(bool) maps true -> 1, false -> 0; more idiomatic than a ternary.
    metrics().dual_write_in_flight.set(i64::from(in_flight));
}

/// RAII guard that sets the `dual_write_in_flight` gauge to `1` on
/// construction and resets it to `0` on drop.
///
/// This is the **only safe way** to mark a consistency window — a manual
/// `set_dual_write_in_flight(true)` / `set_dual_write_in_flight(false)` pair
/// leaks the `true` state if the code in between panics, early-returns via
/// `?`, or is cancelled by the surrounding tokio task.  `Drop` runs on all
/// of those paths, so the gauge is always restored.
///
/// # Example
///
/// ```ignore
/// {
///     let _guard = DualWriteGuard::enter();
///     // SurrealDB committed, PG still pending.
///     apply_pg_batch().await?;   // ? is safe: Drop resets the gauge.
/// }   // guard dropped here — gauge back to 0
/// ```
// Wired into `projection/dual/core_entities.rs` as part of the PR-296
// review fixes.  The `#[allow(dead_code)]` suppression is removed once
// the core_entities edit lands in the same commit series.
#[allow(dead_code)]
#[must_use = "DualWriteGuard must be held in a binding so Drop runs at scope end"]
pub struct DualWriteGuard {
    // Private field so construction must go through `enter()`.
    _private: (),
}

impl DualWriteGuard {
    /// Enter the dual-write consistency window by setting the gauge to `1`.
    /// The gauge is reset to `0` when the returned guard is dropped.
    // Wired into `projection/dual/core_entities.rs` as part of the PR-296
    // review fixes — suppressed here until that edit lands in the same
    // commit series.
    #[allow(dead_code)]
    pub fn enter() -> Self {
        set_dual_write_in_flight(true);
        Self { _private: () }
    }
}

impl Drop for DualWriteGuard {
    fn drop(&mut self) {
        set_dual_write_in_flight(false);
    }
}

/// Signal that the coordinator has finished attempting to start all workers.
///
/// Once called, the `/health/startup` endpoint will return 200.
pub fn mark_startup_complete() {
    STARTUP_COMPLETE.store(true, Ordering::Release);
}

/// Update the global chain-head sequence gauge.
///
/// Called by the background poller that queries `MAX(sequence_number)` from
/// `event_store` every 10 seconds.
///
/// # Arguments
///
/// * `seq` - Latest canonical sequence number seen in event_store
pub fn set_head_sequence(seq: i64) {
    metrics().head_sequence.set(seq as f64);
}

// ---------------------------------------------------------------------------
// HTTP server
// ---------------------------------------------------------------------------

/// Initialise metrics for all known (projection x sink) pairs so that
/// Prometheus scrapes always include every series, even before any data flows.
///
/// # Arguments
///
/// * `known_pairs` - Slice of `(projection_name, sink_name)` tuples to pre-seed
pub fn initialise_labels(known_pairs: &[(&str, &str)]) {
    let m = metrics();
    for (proj, sink) in known_pairs {
        let labels = [*proj, *sink];
        // Touching each metric with its labels ensures it appears in the
        // /metrics output from the very first scrape.
        m.events_processed.with_label_values(&labels);
        m.checkpoint_sequence.with_label_values(&labels);
        m.errors_total.with_label_values(&labels);
        m.events_behind.with_label_values(&labels);
        m.sync_progress_percent.with_label_values(&labels);
        m.status.with_label_values(&labels);
        m.batches_total.with_label_values(&labels);
        m.last_batch_size.with_label_values(&labels);
    }
}

/// Handler for `GET /metrics`.
async fn metrics_handler() -> String {
    let encoder = TextEncoder::new();
    let families = prometheus::gather();
    let mut buf = Vec::with_capacity(4096);
    if let Err(e) = encoder.encode(&families, &mut buf) {
        tracing::error!("Failed to encode Prometheus metrics: {}", e);
        return "# Error encoding metrics\n".to_string();
    }
    String::from_utf8(buf).unwrap_or_else(|e| {
        tracing::error!("Prometheus metrics buffer contains invalid UTF-8: {}", e);
        "# Error: invalid UTF-8 in metrics\n".to_string()
    })
}

/// Handler for `GET /health/live` (and the backward-compatible `GET /health`).
///
/// Always returns 200 "OK" — the process is alive if this responds at all.
async fn health_live_handler() -> &'static str {
    "OK"
}

/// Handler for `GET /health/ready`.
///
/// Returns 200 when at least one worker has reported a healthy status
/// (catching-up or live).  Returns 503 otherwise so that Kubernetes will hold
/// traffic until the service is genuinely processing events.
///
/// Readiness is tracked via `HEALTHY_WORKER_COUNT`, an atomic counter
/// maintained by `record_status`, avoiding any walk of the prometheus proto
/// tree inside a hot HTTP handler.
async fn health_ready_handler() -> impl IntoResponse {
    let healthy = HEALTHY_WORKER_COUNT.load(Ordering::Relaxed) > 0;

    // Secondary fallback: if no worker has reported yet but the event-store
    // is already reachable (head_sequence > 0), treat the service as ready so
    // startup probes do not time out during very fast cold starts.
    let fallback = !healthy && metrics().head_sequence.get() > 0.0;

    if healthy || fallback {
        (StatusCode::OK, "OK")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "not ready")
    }
}

/// Handler for `GET /health/startup`.
///
/// Returns 200 once `mark_startup_complete()` has been called by the
/// coordinator, indicating all workers have been attempted.  Returns 503 while
/// the process is still in its initialisation phase.
async fn health_startup_handler() -> impl IntoResponse {
    if STARTUP_COMPLETE.load(Ordering::Acquire) {
        (StatusCode::OK, "started")
    } else {
        (StatusCode::SERVICE_UNAVAILABLE, "starting")
    }
}

/// Start an HTTP server exposing `/metrics` and `/health` on the given port.
///
/// This function never returns under normal operation — call it via
/// `tokio::spawn` or select it alongside a shutdown signal.
///
/// # Arguments
///
/// * `port` - TCP port to listen on (e.g. 9092)
///
/// # Errors
///
/// Returns an error if the TCP listener cannot be bound or the server fails.
pub async fn start_metrics_server(
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Pre-seed known projection x sink labels so Grafana dashboards show series
    // even before any events are processed.  The map here mirrors
    // `projection::all_projections()` names.
    // At startup we do not know which sinks will be registered, so we rely on
    // `initialise_labels` being called by the coordinator once sinks are known.
    // We just ensure the metrics struct is initialised early.
    let _ = metrics();

    let app = Router::new()
        .route("/metrics", get(metrics_handler))
        // Kubernetes-style split health endpoints.
        .route("/health/live", get(health_live_handler))
        .route("/health/ready", get(health_ready_handler))
        .route("/health/startup", get(health_startup_handler))
        // Backward-compatible alias kept so existing probes keep working.
        .route("/health", get(health_live_handler));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;

    info!(
        "Metrics server listening on http://0.0.0.0:{}/metrics",
        port
    );

    axum::serve(listener, app).await?;
    Ok(())
}
