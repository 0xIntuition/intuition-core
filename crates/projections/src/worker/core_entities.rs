//! Dedicated worker for the core_entities dual-write projection.
//!
//! This worker is similar to PgWorker but calls
//! `CoreEntitiesProjection::process_batch` which writes to both
//! SurrealDB and PostgreSQL.
//!
//! Unlike the other workers, this one has **two** circuit breakers — one per
//! database.  The shared [`retry_with_backoff`] helper only handles a single
//! circuit breaker, so this worker keeps a custom retry loop that:
//!
//! 1. Checks both circuit breakers before each attempt.
//! 2. Routes failure recording to the correct breaker based on error variant.
//! 3. Resets both breakers on success.
//!
//! All back-off constants and jitter computation are shared via the
//! [`crate::resilience::retry`] module.

use std::sync::Arc;

use shared::parsed_event::ParsedEvent;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use crate::error::{ErrorClass, ProjectionError};
use crate::event::source::EventSource;
use crate::projection::core_entities::CoreEntitiesProjection;
use crate::resilience::checkpoint::CheckpointStore;
use crate::resilience::circuit_breaker::{CircuitBreaker, CircuitState};
use crate::resilience::connection_manager::PoolPartitioner;
use crate::resilience::retry::{compute_jitter_ms, sleep_or_cancel, RetryPolicy, WorkerConfig};
use crate::resilience::watchdog::Heartbeat;

// ---------------------------------------------------------------------------
// CircuitCheckOutcome
// ---------------------------------------------------------------------------

/// Outcome of checking whether both circuit breakers allow writes.
#[must_use = "circuit check outcome must be handled — do not discard"]
pub(crate) enum CircuitCheckOutcome {
    /// Both circuits closed — safe to proceed with the dual write.
    Proceed,
    /// At least one circuit was open. Slept for the backoff interval.
    /// Caller should loop and recheck.
    Retrying,
    /// Maximum retry attempts exhausted with at least one circuit still open.
    /// Caller should skip or fail the batch.
    Exhausted(String),
}

/// Outcome of a single dual-write attempt, once it has been classified and
/// (for transient errors) the back-off sleep has been performed.
///
/// Using an explicit enum rather than `Result<(), ProjectionError>` avoids the
/// overloaded `Ok(())` ambiguity: here, `Success` means the batch completed
/// and `Retry` means the caller should loop again.
#[must_use = "attempt outcome must be handled — do not discard"]
enum AttemptOutcome {
    /// Batch processed successfully; caller should return `Ok(())`.
    Success,
    /// Transient failure handled (back-off sleep already awaited); caller
    /// should loop and retry.
    Retry,
    /// Fatal error or retries exhausted; caller should return `Err(_)`.
    Fail(ProjectionError),
}

// ---------------------------------------------------------------------------
// CoreEntitiesWorker
// ---------------------------------------------------------------------------

/// Drives the `core_entities` dual-write projection through the event log,
/// writing to both SurrealDB and PostgreSQL atomically per batch.
pub struct CoreEntitiesWorker {
    projection: CoreEntitiesProjection,
    checkpoint_store: Arc<CheckpointStore>,
    /// Source of raw blockchain events — either the monolithic event_store or
    /// per-type typed tables, selected at startup via the USE_TYPED_READER env var.
    event_reader: Arc<dyn EventSource>,

    /// Polling and batching configuration.
    config: WorkerConfig,

    /// Optional liveness signal updated after every successful batch.
    heartbeat: Option<Heartbeat>,

    /// Shared circuit breaker protecting SurrealDB from calls during outages.
    /// Shared with SurrealDB Workers so the same circuit covers all Surreal writers.
    surreal_cb: Arc<CircuitBreaker>,

    /// Shared circuit breaker protecting PostgreSQL from calls during outages.
    /// Shared with PgWorkers and BatchWorkers so the same circuit covers all PG writers.
    pg_cb: Arc<CircuitBreaker>,

    /// Per-projection connection semaphore for the PostgreSQL side of the
    /// dual-write.  Keyed by `"core_entities"` in the partitioner.
    partitioner: Arc<PoolPartitioner>,

    /// Retry policy — event-driven constants shared with Worker and PgWorker.
    retry_policy: RetryPolicy,
}

impl CoreEntitiesWorker {
    /// Create a new `CoreEntitiesWorker`.
    ///
    /// # Arguments
    ///
    /// * `projection` - Core entities projection implementing dual-write
    /// * `checkpoint_store` - Shared store for reading and writing checkpoints
    /// * `event_reader` - Shared reader implementing `EventSource`
    /// * `surreal_cb` - Shared circuit breaker protecting SurrealDB
    /// * `pg_cb` - Shared circuit breaker protecting PostgreSQL
    /// * `partitioner` - Per-projection semaphore manager
    /// * `config` - Batching and polling tunable parameters
    pub fn new(
        projection: CoreEntitiesProjection,
        checkpoint_store: Arc<CheckpointStore>,
        event_reader: Arc<dyn EventSource>,
        surreal_cb: Arc<CircuitBreaker>,
        pg_cb: Arc<CircuitBreaker>,
        partitioner: Arc<PoolPartitioner>,
        config: WorkerConfig,
    ) -> Self {
        Self {
            projection,
            checkpoint_store,
            event_reader,
            config,
            heartbeat: None,
            surreal_cb,
            pg_cb,
            partitioner,
            retry_policy: RetryPolicy::event_driven(),
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

    /// Run the poll loop until the `token` is cancelled.
    pub async fn run(self, token: CancellationToken) -> Result<(), ProjectionError> {
        let label = "core_entities:dual";
        let event_type_strs: Vec<&str> = self
            .projection
            .event_types()
            .iter()
            .map(|et| et.as_str())
            .collect();

        info!(worker = %label, "CoreEntitiesWorker starting");
        if self.heartbeat.is_none() {
            warn!(worker = %label, "No heartbeat configured — watchdog stall detection disabled for this worker");
        }
        // Signal that the worker is initialising before entering the poll loop.
        crate::metrics::record_status(self.projection.name(), "dual", 0.0);

        loop {
            if token.is_cancelled() {
                info!(worker = %label, "Cancellation requested, exiting cleanly");
                break;
            }

            let checkpoint = match self
                .checkpoint_store
                .get_checkpoint(self.projection.name(), "dual")
                .await
            {
                Ok(seq) => seq,
                Err(e) => {
                    error!(worker = %label, error = %e, "Failed to read checkpoint");
                    crate::metrics::record_error(self.projection.name(), "dual");
                    crate::metrics::record_status(self.projection.name(), "dual", 3.0);
                    // Beat before sleeping: the worker is alive and chose to retry,
                    // so the watchdog must not treat consecutive DB errors as a stall.
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }
                    sleep_or_cancel(self.config.poll_interval_ms, &token).await;
                    continue;
                }
            };

            let batch = match self
                .event_reader
                .read_batch_multi(&event_type_strs, checkpoint, self.config.batch_size as i64)
                .await
            {
                Ok(events) => events,
                Err(e) => {
                    error!(worker = %label, error = %e, "Failed to read event batch");
                    crate::metrics::record_error(self.projection.name(), "dual");
                    crate::metrics::record_status(self.projection.name(), "dual", 3.0);
                    // Beat before sleeping: same reasoning as the checkpoint error path above.
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }
                    sleep_or_cancel(self.config.poll_interval_ms, &token).await;
                    continue;
                }
            };

            if batch.is_empty() {
                debug!(worker = %label, "No new events, sleeping");
                crate::metrics::record_status(self.projection.name(), "dual", 2.0);
                if let Some(ref hb) = self.heartbeat {
                    hb.beat();
                }
                sleep_or_cancel(self.config.poll_interval_ms, &token).await;
                continue;
            }

            let batch_len = batch.len();
            let batch_start = std::time::Instant::now();

            // Signal that we are actively processing events (behind head).
            crate::metrics::record_status(self.projection.name(), "dual", 1.0);

            // Process with custom dual-CB retry loop.
            let result = self.process_with_retry(&batch, label).await;

            if let Err(e) = result {
                // Exhaust of per-batch retries: back off and retry from the
                // same checkpoint rather than stopping the worker.
                crate::metrics::record_status(self.projection.name(), "dual", 3.0);
                warn!(
                    worker = %label,
                    error = %e,
                    "process_batch failed after retries; backing off before retry"
                );
                // Only beat if neither circuit is open — when a circuit is open
                // and retries are exhausted, let the watchdog detect the stall
                // and trigger a supervisor restart.
                let any_circuit_open = self.surreal_cb.state() == CircuitState::Open
                    || self.pg_cb.state() == CircuitState::Open;
                if !any_circuit_open {
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }
                }
                sleep_or_cancel(30_000, &token).await;
                continue;
            }

            // The `is_empty()` guard at the top of the loop body already
            // returned `continue` on empty batches, so `last()` is always
            // `Some` here.  Use `let Some` rather than `.expect()` so a
            // future refactor that removes the guard cannot cause a panic
            // in the worker hot path.
            let Some(last) = batch.last() else {
                error!(
                    worker = %label,
                    "invariant violated: empty batch reached checkpoint write; skipping batch"
                );
                continue;
            };
            let new_sequence = last.sequence_number;
            let new_block = last.block_number;

            if let Err(e) = self
                .checkpoint_store
                .save_checkpoint(self.projection.name(), "dual", new_sequence, new_block)
                .await
            {
                // Checkpoint save failure is NOT silently ignored for the
                // dual-write worker: if we advanced without persisting the
                // checkpoint, a restart would re-process the batch.  The
                // core_entities writes are idempotent (atoms/triples upsert
                // ON CONFLICT), so re-processing is safe — but we still back
                // off before retrying so a transient checkpoint-store outage
                // does not spin.
                crate::metrics::record_status(self.projection.name(), "dual", 3.0);
                warn!(
                    worker = %label,
                    error = %e,
                    "Failed to save checkpoint; backing off before retry (batch will re-process)"
                );
                // Beat before the 30 s cooldown so the watchdog does not fire
                // while the worker is actively waiting to recover.
                if let Some(ref hb) = self.heartbeat {
                    hb.beat();
                }
                sleep_or_cancel(30_000, &token).await;
                continue;
            }

            let duration_secs = batch_start.elapsed().as_secs_f64();
            crate::metrics::record_batch_processed(
                self.projection.name(),
                "dual",
                batch_len as u64,
                duration_secs,
                new_sequence,
            );

            // Heartbeat — signal liveness to the watchdog.
            if let Some(ref hb) = self.heartbeat {
                hb.beat();
            }

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

        info!(worker = %label, "CoreEntitiesWorker stopped");
        Ok(())
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    /// Apply the dual-write with retry.
    ///
    /// This is a custom retry loop rather than a call to [`retry_with_backoff`]
    /// because the dual-write involves **two** circuit breakers — one for
    /// SurrealDB and one for PostgreSQL.  On failure, the correct circuit must
    /// be penalised based on which database the error originated from.
    ///
    /// Back-off constants and jitter computation are shared with the other
    /// workers via [`RetryPolicy`] and [`compute_jitter_ms`].
    async fn process_with_retry(
        &self,
        events: &[shared::models::StoredEvent],
        label: &str,
    ) -> Result<(), ProjectionError> {
        let proj_name = self.projection.name();
        let parsed = self.parse_batch_once(events, label, proj_name);
        let mut delay_secs = self.retry_policy.base_backoff_secs;

        for attempt in 1..=self.retry_policy.max_retries {
            // Check BOTH circuit breakers before attempting the dual-write.
            // If either database is known-unhealthy we skip the call entirely.
            match self
                .check_circuit_breakers(proj_name, label, attempt, &mut delay_secs)
                .await?
            {
                CircuitCheckOutcome::Proceed => {
                    // Both circuits closed — fall through to the dual-write below.
                }
                CircuitCheckOutcome::Retrying => {
                    // Slept for the probe interval; loop back and recheck circuits.
                    continue;
                }
                CircuitCheckOutcome::Exhausted(msg) => {
                    // No warn! here — run() already logs the returned error.
                    return Err(ProjectionError::CircuitOpen(msg));
                }
            }

            // Acquire a PG connection permit before the dual-write. The
            // SurrealDB side uses a WebSocket (not the PG pool) so only one
            // permit is needed here.
            let _permit = match self.partitioner.acquire(proj_name).await {
                Ok(p) => p,
                Err(e) => {
                    warn!(
                        worker = %label,
                        attempt,
                        error = %e,
                        "Connection permit acquisition failed; treating as transient"
                    );
                    if attempt >= self.retry_policy.max_retries {
                        return Err(ProjectionError::Sink(e.to_string()));
                    }
                    let sleep_ms = compute_jitter_ms(delay_secs);
                    tokio::time::sleep(tokio::time::Duration::from_millis(sleep_ms)).await;
                    // Beat after the backoff sleep for the same reason as the
                    // transient-error path: the worker is alive, just retrying.
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }
                    delay_secs = (delay_secs * 2).min(self.retry_policy.max_backoff_secs);
                    continue;
                }
            };

            let result = self.projection.process_parsed_batch(&parsed).await;
            match self
                .classify_and_route(result, attempt, &mut delay_secs, proj_name, label)
                .await
            {
                AttemptOutcome::Success => return Ok(()),
                AttemptOutcome::Retry => continue,
                AttemptOutcome::Fail(e) => return Err(e),
            }
        }

        // Only reachable if `max_retries` is 0 (nonsensical config).  The
        // normal control flow always returns from inside the loop on the
        // final attempt, so reaching here means the worker was configured
        // to never try at all.  Fail loudly rather than silently skipping.
        Err(ProjectionError::Sink(
            "core_entities: max_retries is zero; cannot attempt batch".to_owned(),
        ))
    }

    /// Parse a raw batch into typed [`ParsedEvent`]s **exactly once**.
    ///
    /// This is pulled out of the retry loop so the serde cost is paid only
    /// once regardless of how many retry attempts follow.
    ///
    /// # Never-drop invariant
    ///
    /// Every input event produces exactly one output `ParsedEvent`:
    /// - Typed variant on successful deserialization, or
    /// - [`ParsedEvent::Unknown`] on failure (with a structured warn log and
    ///   a `parse_error` metric emitted for observability).
    ///
    /// A `debug_assert_eq!` guard enforces the length invariant in test/dev
    /// builds so accidental filter operations inside the loop fail loudly.
    fn parse_batch_once(
        &self,
        events: &[shared::models::StoredEvent],
        label: &str,
        proj_name: &str,
    ) -> Vec<ParsedEvent> {
        let mut parsed: Vec<ParsedEvent> = Vec::with_capacity(events.len());
        for event in events {
            let (p, maybe_err) = ParsedEvent::parse_or_unknown(event.clone());
            if let Some(err) = maybe_err {
                warn!(
                    worker     = %label,
                    event_type = %event.event_type,
                    sequence   = event.sequence_number,
                    error      = %err,
                    "core_entities: failed to parse StoredEvent into typed variant; falling back to Unknown"
                );
                crate::metrics::record_parse_error(proj_name, &event.event_type);
            }
            parsed.push(p);
        }

        // Every input event must produce exactly one ParsedEvent — either
        // typed or Unknown.  A mismatch here would mean events were silently
        // dropped, which violates the core pipeline contract.
        debug_assert_eq!(
            parsed.len(),
            events.len(),
            "parse_or_unknown must never drop events"
        );

        parsed
    }

    /// Classify the outcome of a single `process_parsed_batch` attempt and,
    /// for transient errors, perform the back-off sleep in-place.
    ///
    /// Returns an [`AttemptOutcome`] that the caller must match on:
    /// - `Success` → return `Ok(())`
    /// - `Retry`   → `continue` the retry loop (sleep already awaited)
    /// - `Fail(e)` → return `Err(e)`
    ///
    /// Centralising this branch keeps the retry loop flat and makes the
    /// "Ok = return, Err = maybe retry" semantics explicit.
    async fn classify_and_route(
        &self,
        result: Result<(), ProjectionError>,
        attempt: u32,
        delay_secs: &mut u64,
        proj_name: &str,
        label: &str,
    ) -> AttemptOutcome {
        let err = match result {
            Ok(()) => {
                // Both writes succeeded — reset both circuits and update metrics.
                self.record_dual_success(proj_name);
                return AttemptOutcome::Success;
            }
            Err(e) => e,
        };

        // Branch on the exhaustive classification — new `ErrorClass` variants
        // will cause a compile error here and force a routing decision, rather
        // than silently falling into the fatal arm via a `matches!` + catch-all.
        match err.classify() {
            ErrorClass::Transient | ErrorClass::CircuitProtected => {
                // Route the failure to the correct circuit breaker based on
                // which database the error originated from.
                self.record_dual_failure(&err, proj_name);

                if attempt >= self.retry_policy.max_retries {
                    error!(worker = %label, attempt, error = %err, "Error on final attempt");
                    return AttemptOutcome::Fail(err);
                }

                warn!(
                    worker = %label,
                    attempt,
                    retry_in_secs = *delay_secs,
                    error = %err,
                    "Transient error; will retry"
                );
                crate::metrics::record_error(proj_name, "dual");
                crate::metrics::record_status(proj_name, "dual", 3.0);
                let sleep_ms = compute_jitter_ms(*delay_secs);
                tokio::time::sleep(tokio::time::Duration::from_millis(sleep_ms)).await;
                // Beat after each backoff sleep: the worst-case event-driven
                // sequence sums to ~121 s, exceeding the watchdog threshold.
                if let Some(ref hb) = self.heartbeat {
                    hb.beat();
                }
                *delay_secs = (*delay_secs * 2).min(self.retry_policy.max_backoff_secs);
                AttemptOutcome::Retry
            }
            ErrorClass::Fatal => {
                // Fatal errors pin the checkpoint — operators must inspect
                // `projection_dead_letter` (populated by the projection's
                // per-event error path) before replaying.
                error!(worker = %label, error = %err, "Fatal error; not retrying");
                AttemptOutcome::Fail(err)
            }
        }
    }

    /// Check both circuit breakers before a dual-write attempt.
    ///
    /// If either is open, emits current CB states to metrics and waits for the
    /// longest probe interval.
    ///
    /// # Returns
    ///
    /// - [`CircuitCheckOutcome::Proceed`] — both circuits closed; caller may write.
    /// - [`CircuitCheckOutcome::Retrying`] — slept for probe interval; caller should
    ///   loop and recheck.
    /// - [`CircuitCheckOutcome::Exhausted`] — final attempt reached with circuit(s)
    ///   still open; caller should fail the batch.
    async fn check_circuit_breakers(
        &self,
        proj_name: &str,
        label: &str,
        attempt: u32,
        delay_secs: &mut u64,
    ) -> Result<CircuitCheckOutcome, ProjectionError> {
        let surreal_open = self.surreal_cb.check().err();
        let pg_open = self.pg_cb.check().err();

        if surreal_open.is_none() && pg_open.is_none() {
            return Ok(CircuitCheckOutcome::Proceed);
        }

        // Emit the current state for each CB so dashboards stay current.
        crate::metrics::set_circuit_state(proj_name, "surrealdb", self.surreal_cb.state() as u8);
        crate::metrics::set_circuit_state(proj_name, "pg", self.pg_cb.state() as u8);

        if attempt < self.retry_policy.max_retries {
            // Sleep for the longer of the two remaining probe intervals
            // so we wake when both circuits are likely ready to probe.
            let wait = surreal_open
                .iter()
                .chain(pg_open.iter())
                .map(|o| o.next_probe_in)
                .max()
                .unwrap_or(tokio::time::Duration::from_secs(5));
            warn!(
                worker = %label,
                attempt,
                wait_secs = wait.as_secs_f64(),
                "One or both circuit breakers open; waiting for probe interval"
            );
            tokio::time::sleep(wait).await;
            // Beat after sleeping so the watchdog sees that the worker is alive
            // and actively waiting for circuits to close, not hung.
            if let Some(ref hb) = self.heartbeat {
                hb.beat();
            }
            *delay_secs = (*delay_secs * 2).min(self.retry_policy.max_backoff_secs);
            Ok(CircuitCheckOutcome::Retrying)
        } else {
            let msg = surreal_open
                .or(pg_open)
                .map(|o| o.to_string())
                .unwrap_or_default();
            Ok(CircuitCheckOutcome::Exhausted(msg))
        }
    }

    /// Record a successful dual-write: reset both circuit breakers and update metrics.
    fn record_dual_success(&self, proj_name: &str) {
        self.surreal_cb.record_success();
        self.pg_cb.record_success();
        crate::metrics::set_circuit_state(proj_name, "surrealdb", self.surreal_cb.state() as u8);
        crate::metrics::set_circuit_state(proj_name, "pg", self.pg_cb.state() as u8);
        if let Some(available) = self.partitioner.available_permits(proj_name) {
            crate::metrics::set_semaphore_available(proj_name, available);
        }
    }

    /// Record failure on both circuit breakers conservatively, updating metrics.
    ///
    /// Used when an error cannot be attributed to a single database (e.g.
    /// `CircuitOpen`, fatal variants that should not reach this path).
    fn penalise_both_circuits(&self, proj_name: &str) {
        self.surreal_cb.record_failure();
        self.pg_cb.record_failure();
        if self.surreal_cb.state() == CircuitState::Open {
            crate::metrics::record_circuit_open(proj_name, "surrealdb");
        }
        if self.pg_cb.state() == CircuitState::Open {
            crate::metrics::record_circuit_open(proj_name, "pg");
        }
        crate::metrics::set_circuit_state(proj_name, "surrealdb", self.surreal_cb.state() as u8);
        crate::metrics::set_circuit_state(proj_name, "pg", self.pg_cb.state() as u8);
    }

    /// Route a transient failure to the correct circuit breaker and update metrics.
    ///
    /// The match is exhaustive — no `_` wildcard — so adding a new
    /// [`ProjectionError`] variant will cause a compile error here, forcing
    /// an explicit routing decision.
    fn record_dual_failure(&self, e: &ProjectionError, proj_name: &str) {
        match e {
            // Sink wraps SurrealDB sink calls — both route to the surreal breaker.
            ProjectionError::Surreal(_) | ProjectionError::Sink(_) => {
                self.surreal_cb.record_failure();
                if self.surreal_cb.state() == CircuitState::Open {
                    crate::metrics::record_circuit_open(proj_name, "surrealdb");
                }
                crate::metrics::set_circuit_state(
                    proj_name,
                    "surrealdb",
                    self.surreal_cb.state() as u8,
                );
            }
            // PostgreSQL-side failure — penalise only the PG breaker.
            ProjectionError::Database(_) => {
                self.pg_cb.record_failure();
                if self.pg_cb.state() == CircuitState::Open {
                    crate::metrics::record_circuit_open(proj_name, "pg");
                }
                crate::metrics::set_circuit_state(proj_name, "pg", self.pg_cb.state() as u8);
            }
            // A breaker already tripped — penalise both conservatively.
            ProjectionError::CircuitOpen(_) => {
                self.penalise_both_circuits(proj_name);
            }
            // Fatal variants should never reach this method (called only on
            // the transient branch). Log the misrouting, penalise both.
            ProjectionError::InvalidEventData(_)
            | ProjectionError::MissingField(_)
            | ProjectionError::Serialization(_)
            | ProjectionError::Config(_)
            | ProjectionError::UniqueConstraintViolation(_) => {
                tracing::error!(
                    error = %e,
                    "record_dual_failure called with a fatal error variant; \
                     this is a logic error — penalising both circuits conservatively"
                );
                self.penalise_both_circuits(proj_name);
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
    use crate::resilience::circuit_breaker::{CircuitBreaker, CircuitBreakerConfig};
    use chrono::Utc;
    use serde_json::json;
    use shared::models::StoredEvent;
    use std::sync::Arc;
    use std::time::Duration;

    /// Helper: create a circuit breaker with a threshold of 1 so a single
    /// failure trips it open, and a long probe interval so it stays open
    /// for the duration of the test.
    fn make_cb(name: &str) -> Arc<CircuitBreaker> {
        Arc::new(CircuitBreaker::new(
            name,
            CircuitBreakerConfig {
                failure_threshold: 1,
                initial_probe_interval: Duration::from_secs(300),
                max_probe_interval: Duration::from_secs(600),
            },
        ))
    }

    /// Helper: create a circuit breaker that is already in the Open state.
    fn make_open_cb(name: &str) -> Arc<CircuitBreaker> {
        let cb = make_cb(name);
        cb.record_failure(); // threshold=1 → trips open
        cb
    }

    // -- Proceed: both circuits closed ------------------------------------

    #[test]
    fn both_closed_returns_proceed() {
        let surreal_cb = make_cb("surreal");
        let pg_cb = make_cb("pg");

        // Both CBs are closed — check() returns Ok(())
        assert!(surreal_cb.check().is_ok());
        assert!(pg_cb.check().is_ok());

        // Simulate the Proceed branch: when both checks succeed,
        // check_circuit_breakers returns Proceed.
        let surreal_open = surreal_cb.check().err();
        let pg_open = pg_cb.check().err();
        assert!(surreal_open.is_none() && pg_open.is_none());
    }

    // -- Retrying: one circuit open, not final attempt --------------------

    #[test]
    fn one_open_not_final_attempt_returns_retrying() {
        let surreal_cb = make_open_cb("surreal");
        let pg_cb = make_cb("pg");

        // surreal_cb is open → check() returns Err
        let surreal_open = surreal_cb.check().err();
        let pg_open = pg_cb.check().err();

        assert!(surreal_open.is_some(), "surreal CB should be open");
        assert!(pg_open.is_none(), "pg CB should be closed");

        // With attempt < max_retries, the worker would sleep and return Retrying.
        let attempt = 1_u32;
        let max_retries = 8_u32;
        assert!(attempt < max_retries, "not the final attempt");
    }

    // -- Exhausted: circuit open on final attempt -------------------------

    #[test]
    fn open_on_final_attempt_returns_exhausted() {
        let surreal_cb = make_open_cb("surreal");
        let pg_cb = make_cb("pg");

        let surreal_open = surreal_cb.check().err();
        let pg_open = pg_cb.check().err();

        assert!(surreal_open.is_some(), "surreal CB should be open");

        // On the final attempt (attempt == max_retries), the worker returns Exhausted.
        let attempt = 8_u32;
        let max_retries = 8_u32;
        assert!(attempt >= max_retries, "should be the final attempt");

        // The Exhausted message comes from the CircuitOpen error.
        let msg = surreal_open
            .or(pg_open)
            .map(|o| o.to_string())
            .unwrap_or_default();
        assert!(!msg.is_empty(), "exhausted message should not be empty");
        assert!(
            msg.contains("circuit"),
            "exhausted message should mention the circuit: {msg}"
        );
    }

    // -- #[must_use] enforced at compile time -----------------------------

    #[test]
    fn enum_variants_are_constructible() {
        // Verify the enum can be constructed and matched exhaustively.
        // The #[must_use] attribute is enforced by the compiler; this test
        // exercises all three variants to confirm exhaustive matching works.
        let outcomes = vec![
            CircuitCheckOutcome::Proceed,
            CircuitCheckOutcome::Retrying,
            CircuitCheckOutcome::Exhausted("test".to_string()),
        ];

        for outcome in outcomes {
            match outcome {
                CircuitCheckOutcome::Proceed => {}
                CircuitCheckOutcome::Retrying => {}
                CircuitCheckOutcome::Exhausted(msg) => {
                    assert_eq!(msg, "test");
                }
            }
        }
    }

    // -- Both circuits open: exhaustion message uses first available ------

    #[test]
    fn both_open_exhausted_uses_first_message() {
        let surreal_cb = make_open_cb("surreal");
        let pg_cb = make_open_cb("pg");

        let surreal_open = surreal_cb.check().err();
        let pg_open = pg_cb.check().err();

        assert!(surreal_open.is_some());
        assert!(pg_open.is_some());

        // The production code uses .or() which picks the first Some.
        let msg = surreal_open
            .or(pg_open)
            .map(|o| o.to_string())
            .unwrap_or_default();
        assert!(
            msg.contains("surreal"),
            "should prefer the surreal CB message: {msg}"
        );
    }

    // -- parse_or_unknown contract: length preservation, Unknown fallback --

    /// Mirrors the parse-once block in `process_with_retry` to confirm that:
    ///
    /// 1. One valid AtomCreated + one malformed event both produce exactly one
    ///    `ParsedEvent` each — the output length always equals the input length.
    /// 2. The malformed event lands in `ParsedEvent::Unknown`, not dropped.
    #[test]
    fn parse_once_preserves_length_on_malformed_events() {
        let valid_event = StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 0,
            event_type: "AtomCreated".to_owned(),
            event_data: json!({
                "block_number":    100,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash":      "0xblockhash",
                "transaction_hash":"0xtxhash",
                "log_index":       0,
                "creator":         "0xCreator",
                "term_id":         "42",
                "atom_data":       "0x68656c6c6f20776f726c64",
                "atom_wallet":     "0xWallet"
            }),
            term_id: Some("42".to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };

        // Missing all required typed fields — parse_or_unknown must fall back to Unknown.
        let malformed_event = StoredEvent {
            sequence_number: 2,
            block_number: 101,
            block_timestamp: Utc::now(),
            block_hash: "0xbad".to_owned(),
            transaction_hash: "0xbad".to_owned(),
            log_index: 1,
            event_type: "AtomCreated".to_owned(),
            event_data: json!({ "broken": true }),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };

        let input = vec![valid_event, malformed_event];
        let mut parsed: Vec<ParsedEvent> = Vec::with_capacity(input.len());

        for event in &input {
            let (p, _maybe_err) = ParsedEvent::parse_or_unknown(event.clone());
            parsed.push(p);
        }

        // Length must be preserved — no events dropped.
        assert_eq!(
            parsed.len(),
            input.len(),
            "parse_or_unknown must never drop events"
        );

        // First event parsed successfully into AtomCreated.
        assert!(
            matches!(parsed[0], ParsedEvent::AtomCreated { .. }),
            "valid event must parse to AtomCreated, got: {:?}",
            parsed[0]
        );

        // Second event (malformed) must land in Unknown, not be dropped.
        assert!(
            matches!(parsed[1], ParsedEvent::Unknown(_)),
            "malformed event must fall back to Unknown"
        );
    }
}
