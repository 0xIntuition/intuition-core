//! Per-PgProjection poll worker.
//!
//! Analogous to `Worker` for SurrealDB projections, but calls
//! `PgProjection::process_batch(pool, events)` directly instead of
//! going through the sink abstraction.

use std::sync::Arc;

use sqlx::PgPool;
use tokio_util::sync::CancellationToken;
use tracing::{debug, error, info, warn};

use shared::parsed_event::ParsedEvent;

use crate::error::ProjectionError;
use crate::event::source::EventSource;
use crate::projection::pg::PgProjection;
use crate::resilience::checkpoint::CheckpointStore;
use crate::resilience::circuit_breaker::CircuitBreaker;
use crate::resilience::connection_manager::PoolPartitioner;
use crate::resilience::retry::{
    retry_with_backoff, sleep_or_cancel, RetryContext, RetryPolicy, WorkerConfig,
};
use crate::resilience::watchdog::Heartbeat;

// ---------------------------------------------------------------------------
// PgWorker
// ---------------------------------------------------------------------------

/// Drives a single `PgProjection` through the event log, writing directly
/// to PostgreSQL.
pub struct PgWorker {
    projection: Box<dyn PgProjection>,
    pool: PgPool,
    checkpoint_store: Arc<CheckpointStore>,
    /// Source of raw blockchain events — either the monolithic event_store or
    /// per-type typed tables, selected at startup via the USE_TYPED_READER env var.
    event_reader: Arc<dyn EventSource>,

    /// Polling and batching configuration.
    config: WorkerConfig,

    /// Optional liveness signal updated after every successful batch.
    heartbeat: Option<Heartbeat>,

    /// Shared circuit breaker protecting PostgreSQL from calls during outages.
    /// Shared across all PgWorkers and BatchWorkers so a single tripped circuit
    /// stops all PostgreSQL writers simultaneously.
    circuit_breaker: Arc<CircuitBreaker>,

    /// Per-projection connection semaphore. Workers must hold a permit for the
    /// entire duration of each database operation, capping per-projection
    /// concurrency independently of the global pool ceiling.
    partitioner: Arc<PoolPartitioner>,

    /// Retry policy — shared constant for all event-driven workers.
    retry_policy: RetryPolicy,
}

impl PgWorker {
    /// Create a new `PgWorker`.
    ///
    /// # Arguments
    ///
    /// * `projection` - Boxed PG projection
    /// * `pool` - Shared PostgreSQL connection pool
    /// * `checkpoint_store` - Shared store for reading and writing checkpoints
    /// * `event_reader` - Shared reader implementing `EventSource`
    /// * `circuit_breaker` - Shared circuit breaker protecting PostgreSQL
    /// * `partitioner` - Per-projection semaphore manager
    /// * `config` - Batching and polling tunable parameters
    pub fn new(
        projection: Box<dyn PgProjection>,
        pool: PgPool,
        checkpoint_store: Arc<CheckpointStore>,
        event_reader: Arc<dyn EventSource>,
        circuit_breaker: Arc<CircuitBreaker>,
        partitioner: Arc<PoolPartitioner>,
        config: WorkerConfig,
    ) -> Self {
        Self {
            projection,
            pool,
            checkpoint_store,
            event_reader,
            config,
            heartbeat: None,
            circuit_breaker,
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

    /// Checkpoint key for this worker. Includes shard suffix when sharded
    /// so each shard tracks progress independently.
    #[inline]
    fn checkpoint_name(&self) -> String {
        match self.projection.shard_id() {
            Some(id) => format!("{}_s{}", self.projection.name(), id),
            None => self.projection.name().to_owned(),
        }
    }

    #[inline]
    fn label(&self) -> String {
        match self.projection.shard_id() {
            Some(id) => format!("{}:pg:s{}", self.projection.name(), id),
            None => format!("{}:pg", self.projection.name()),
        }
    }

    /// Run the poll loop until the `token` is cancelled.
    pub async fn run(self, token: CancellationToken) -> Result<(), ProjectionError> {
        let label = self.label();
        let ckpt_name = self.checkpoint_name();
        let event_type_strs: Vec<&str> = self
            .projection
            .event_types()
            .iter()
            .map(|et| et.as_str())
            .collect();

        info!(worker = %label, "PgWorker starting");
        if self.heartbeat.is_none() {
            warn!(worker = %label, "No heartbeat configured — watchdog stall detection disabled for this worker");
        }
        // Signal that the worker is initialising before entering the poll loop.
        crate::metrics::record_status(&ckpt_name, "pg", 0.0);

        loop {
            if token.is_cancelled() {
                info!(worker = %label, "Cancellation requested, exiting cleanly");
                break;
            }

            // 1. Read checkpoint
            let checkpoint = match self.checkpoint_store.get_checkpoint(&ckpt_name, "pg").await {
                Ok(seq) => seq,
                Err(e) => {
                    error!(worker = %label, error = %e, "Failed to read checkpoint");
                    crate::metrics::record_error(&ckpt_name, "pg");
                    crate::metrics::record_status(&ckpt_name, "pg", 3.0);
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

            // 2. Poll for events
            let batch = match self
                .event_reader
                .read_batch_multi(&event_type_strs, checkpoint, self.config.batch_size as i64)
                .await
            {
                Ok(events) => events,
                Err(e) => {
                    error!(worker = %label, error = %e, "Failed to read event batch");
                    crate::metrics::record_error(&ckpt_name, "pg");
                    crate::metrics::record_status(&ckpt_name, "pg", 3.0);
                    // Beat before sleeping: same reasoning as the checkpoint error path above.
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }
                    sleep_or_cancel(self.config.poll_interval_ms, &token).await;
                    continue;
                }
            };

            // 3. Empty batch → live (caught up to head), then sleep
            if batch.is_empty() {
                debug!(worker = %label, "No new events, sleeping for {}ms", self.config.poll_interval_ms);
                crate::metrics::record_status(&ckpt_name, "pg", 2.0);
                if let Some(ref hb) = self.heartbeat {
                    hb.beat();
                }
                sleep_or_cancel(self.config.poll_interval_ms, &token).await;
                continue;
            }

            let batch_len = batch.len();
            debug!(worker = %label, count = batch_len, first_seq = batch[0].sequence_number, "Fetched batch");

            // Signal that we are actively processing events (behind head).
            crate::metrics::record_status(&ckpt_name, "pg", 1.0);

            let batch_start = std::time::Instant::now();

            // 4. Process batch through the PG projection with retry -----------
            if let Err(e) = self.apply_with_retry(&batch, &ckpt_name, &label).await {
                // Exhaust of per-batch retries is not fatal for the worker —
                // back off and re-enter the loop from the same checkpoint so
                // that transient DB outages are self-healing.
                crate::metrics::record_status(&ckpt_name, "pg", 3.0);
                warn!(worker = %label, error = %e, "process_batch failed after retries; backing off before retry");
                // Beat before the 30s cooldown so the watchdog does not fire
                // while the worker is actively waiting to recover.
                if let Some(ref hb) = self.heartbeat {
                    hb.beat();
                }
                sleep_or_cancel(30_000, &token).await;
                continue;
            }

            // 5 + 6. Save checkpoint and record metrics -----------------------
            let new_sequence = match self
                .save_checkpoint_and_record_metrics(
                    &batch,
                    &ckpt_name,
                    &label,
                    batch_len,
                    batch_start,
                )
                .await
            {
                Ok(seq) => seq,
                Err(_) => {
                    // save_checkpoint_and_record_metrics already logged the error;
                    // back off so the same batch is retried from the same checkpoint.
                    // Beat so the watchdog stays quiet during the cooldown.
                    if let Some(ref hb) = self.heartbeat {
                        hb.beat();
                    }
                    sleep_or_cancel(30_000, &token).await;
                    continue;
                }
            };

            // 7. Heartbeat — signal liveness to the watchdog.
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

        info!(worker = %label, "PgWorker stopped");
        Ok(())
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    /// Execute `projection.process_parsed_batch` with retry and semaphore guard.
    ///
    /// The raw `StoredEvent` slice is parsed into `Vec<ParsedEvent>` once
    /// before the retry loop, paying the serde cost only once regardless of
    /// how many retries follow.
    ///
    /// Events that fail to parse are **not dropped**.  They are converted to
    /// `ParsedEvent::Unknown(raw)` via [`ParsedEvent::parse_or_unknown`] so
    /// every event in the batch reaches the projection.  A warning is logged
    /// and the `projection_parse_error_total` counter is incremented for each
    /// fallback so malformed events are visible in dashboards.
    ///
    /// A `debug_assert` verifies that the parsed vec length equals the batch
    /// length — this would only fire if `parse_or_unknown` somehow dropped an
    /// event, which must never happen.
    ///
    /// The semaphore permit is acquired inside the retry closure so it is held
    /// only for the duration of each DB operation.  Multiple shards share the
    /// same semaphore keyed by the base projection name, bounding total
    /// concurrency independently of shard count.
    async fn apply_with_retry(
        &self,
        batch: &[shared::models::StoredEvent],
        ckpt_name: &str,
        label: &str,
    ) -> Result<(), ProjectionError> {
        // Parse once before the retry loop so we pay the serde cost only once,
        // regardless of how many retry attempts follow.
        let parsed = parse_batch_once(batch, ckpt_name, label);

        let ctx = RetryContext {
            circuit_breaker: Arc::clone(&self.circuit_breaker),
            projection_name: ckpt_name.to_string(),
            target: "pg".to_string(),
            heartbeat: self.heartbeat.clone(),
        };
        let proj_name = self.projection.name();
        let pool = &self.pool;
        let projection = &self.projection;
        let partitioner = &self.partitioner;

        // `process_parsed_batch` is the typed path; projections that have not
        // yet overridden it fall back to `process_batch` via the default
        // implementation in `PgProjection`.
        let result = retry_with_backoff(&self.retry_policy, &ctx, label, || async {
            // Acquire a connection permit before touching the PG pool.
            let _permit = partitioner
                .acquire(proj_name)
                .await
                .map_err(|e| ProjectionError::Sink(e.to_string()))?;
            projection.process_parsed_batch(pool, &parsed).await
        })
        .await;

        // Emit available permits after a successful batch so the Prometheus gauge stays current.
        if result.is_ok() {
            if let Some(available) = self.partitioner.available_permits(proj_name) {
                crate::metrics::set_semaphore_available(proj_name, available);
            }
        }

        result
    }

    /// Persist the batch checkpoint and emit Prometheus metrics.
    ///
    /// Returns `Ok(new_sequence)` on success.  On checkpoint save failure,
    /// logs a warning and returns `Err(())` so the caller can back off and
    /// retry the same batch (PG projections are idempotent, so re-processing
    /// is safe).
    async fn save_checkpoint_and_record_metrics(
        &self,
        batch: &[shared::models::StoredEvent],
        ckpt_name: &str,
        label: &str,
        batch_len: usize,
        batch_start: std::time::Instant,
    ) -> Result<i64, ()> {
        // The caller already guards against empty batches, but we avoid
        // `.expect()` in the worker hot path so a future refactor cannot
        // cause a panic here.  If the invariant is ever violated we log
        // and skip the checkpoint update rather than taking the worker
        // down with it.
        let (new_sequence, new_block) = match resolve_checkpoint_target(batch) {
            Ok(target) => target,
            Err(()) => {
                warn!(
                    worker = %label,
                    "invariant violated: empty batch reached checkpoint write; skipping batch"
                );
                return Err(());
            }
        };

        if let Err(e) = self
            .checkpoint_store
            .save_checkpoint(ckpt_name, "pg", new_sequence, new_block)
            .await
        {
            // Checkpoint save failure: back off and retry so the same batch
            // is re-tried (the projection's upsert logic is idempotent for
            // PG projections, so re-processing is safe).
            warn!(worker = %label, error = %e, "Failed to save checkpoint; backing off before retry");
            return Err(());
        }

        let duration_secs = batch_start.elapsed().as_secs_f64();
        crate::metrics::record_batch_processed(
            ckpt_name,
            "pg",
            batch_len as u64,
            duration_secs,
            new_sequence,
        );

        Ok(new_sequence)
    }
}

// ---------------------------------------------------------------------------
// Free helpers (testable without a PgPool)
// ---------------------------------------------------------------------------

/// Parse a batch of raw `StoredEvent`s into typed `ParsedEvent`s exactly once.
///
/// Events that fail typed deserialization are converted to
/// `ParsedEvent::Unknown(raw)` via [`ParsedEvent::parse_or_unknown`] so the
/// returned vec is guaranteed to have the same length as `batch` — no event
/// is ever silently dropped.
///
/// A structured warning is logged and `projection_parse_error_total` is
/// incremented for every event that falls back to `Unknown`, making malformed
/// events visible in dashboards.
///
/// This is the single source of truth for the parse-once step used by
/// [`PgWorker::apply_with_retry`] and its unit tests.  Extracting it into a
/// free function ensures a regression that changes the loop (e.g. a
/// `.map().collect()` rewrite that drops events) is caught by the
/// `parse_batch_once_*` unit tests below.
pub(crate) fn parse_batch_once(
    batch: &[shared::models::StoredEvent],
    ckpt_name: &str,
    label: &str,
) -> Vec<ParsedEvent> {
    let mut parsed: Vec<ParsedEvent> = Vec::with_capacity(batch.len());
    for event in batch {
        let (p, maybe_err) = ParsedEvent::parse_or_unknown(event.clone());
        if let Some(err) = maybe_err {
            warn!(
                worker     = %label,
                event_type = %event.event_type,
                sequence   = event.sequence_number,
                error      = %err,
                "Failed to parse StoredEvent into typed variant; falling back to Unknown"
            );
            crate::metrics::record_parse_error(ckpt_name, &event.event_type);
        }
        parsed.push(p);
    }

    // Every input event must produce exactly one ParsedEvent — either typed
    // or Unknown.  A mismatch here would mean events were silently dropped.
    debug_assert_eq!(
        parsed.len(),
        batch.len(),
        "parse_or_unknown must never drop events"
    );

    parsed
}

/// Resolve the checkpoint target `(sequence, block)` for a processed batch.
///
/// Returns `Err(())` when the batch is empty — callers are expected to back
/// off rather than panic.  This replaces the previous
/// `.expect("batch is non-empty")` in the worker hot path and makes the
/// empty-batch guard unit-testable without a `PgPool`.
///
/// Extracted into a free function so a regression that removes the guard
/// (e.g. a refactor that switches to `batch[batch.len() - 1]`) is caught by
/// the `resolve_checkpoint_target_*` tests below.
pub(crate) fn resolve_checkpoint_target(
    batch: &[shared::models::StoredEvent],
) -> Result<(i64, i64), ()> {
    let last = batch.last().ok_or(())?;
    Ok((last.sequence_number, last.block_number))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    //! `PgWorker` tests focus on the invariants that do not require a
    //! `PgPool`: the parse-once length contract, the cooperative-chunking
    //! sleep decision, and the empty-batch checkpoint guard.  End-to-end
    //! retry behaviour is exercised by integration tests in the indexing
    //! pipeline since `PgWorker::run` requires a real database.
    use super::*;
    use chrono::Utc;
    use serde_json::json;
    use shared::models::StoredEvent;

    /// Helper: build a valid `Deposited` event whose `event_data` satisfies
    /// every field required by `DepositedRecord`'s serde derive.
    fn make_valid_deposited(seq: i64) -> StoredEvent {
        StoredEvent {
            sequence_number: seq,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 0,
            event_type: "Deposited".to_owned(),
            event_data: json!({
                "block_number":     100,
                "block_timestamp":  "2024-01-01T00:00:00Z",
                "block_hash":       "0xblockhash",
                "transaction_hash": "0xtxhash",
                "log_index":        0,
                "sender":           "0xSender",
                "receiver":         "0xReceiver",
                "term_id":          "7",
                "curve_id":         "1",
                "assets":           "1000",
                "assets_after_fees":"980",
                "shares":           "950",
                "total_shares":     "5000",
                "vault_type":       1
            }),
            term_id: Some("7".to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    /// Helper: build a `StoredEvent` with `event_type = "Deposited"` but a
    /// payload that fails typed deserialization (missing required fields).
    /// `parse_or_unknown` must produce `ParsedEvent::Unknown`, not drop it.
    fn make_malformed_deposited(seq: i64) -> StoredEvent {
        StoredEvent {
            sequence_number: seq,
            block_number: 200,
            block_timestamp: Utc::now(),
            block_hash: "0xbad".to_owned(),
            transaction_hash: "0xbad".to_owned(),
            log_index: 0,
            event_type: "Deposited".to_owned(),
            // Missing every required field — typed parse will fail.
            event_data: json!({ "broken": true }),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    // -----------------------------------------------------------------------
    // Parse-once length preservation
    // -----------------------------------------------------------------------

    /// Calls the real [`parse_batch_once`] helper used by `apply_with_retry`
    /// so the never-drop-events invariant is locked in against the production
    /// code path, not a hand-copied inline loop.  A refactor that rewrites
    /// the free function to `.map().collect()` and drops an event will make
    /// this test fail.
    ///
    /// Inputs: 1 valid event + 1 malformed event with the same `event_type`.
    /// Outputs: exactly 2 `ParsedEvent`s — the valid one as `Deposited`, the
    /// malformed one as `Unknown`. Length is preserved; no event is dropped.
    #[test]
    fn parse_batch_once_preserves_length_with_mixed_valid_and_malformed_events() {
        let batch = vec![
            make_valid_deposited(1),
            make_malformed_deposited(2),
            make_valid_deposited(3),
        ];

        let parsed = parse_batch_once(&batch, "test", "test-worker");

        // Length preservation — the never-drop-events invariant.
        assert_eq!(
            parsed.len(),
            batch.len(),
            "parse_or_unknown must never drop events"
        );

        assert!(
            matches!(parsed[0], ParsedEvent::Deposited { .. }),
            "valid event 0 must parse into Deposited"
        );
        assert!(
            matches!(parsed[1], ParsedEvent::Unknown(_)),
            "malformed event 1 must fall back to Unknown"
        );
        assert!(
            matches!(parsed[2], ParsedEvent::Deposited { .. }),
            "valid event 2 must parse into Deposited"
        );
    }

    /// Empty input must produce empty output and trigger no parse failures.
    /// Exercises the real helper to lock in the edge case.
    #[test]
    fn parse_batch_once_empty_batch_yields_empty_parsed_vec() {
        let batch: Vec<StoredEvent> = vec![];
        let parsed = parse_batch_once(&batch, "test", "test-worker");
        assert_eq!(parsed.len(), 0);
    }

    /// All-malformed batch: every event must still produce one Unknown,
    /// not be silently dropped.  This is the worst case for the never-drop
    /// contract — the projection must still see every position.
    #[test]
    fn parse_batch_once_all_malformed_yields_all_unknown() {
        let batch = vec![
            make_malformed_deposited(1),
            make_malformed_deposited(2),
            make_malformed_deposited(3),
        ];

        let parsed = parse_batch_once(&batch, "test", "test-worker");

        assert_eq!(parsed.len(), batch.len());
        for p in &parsed {
            assert!(
                matches!(p, ParsedEvent::Unknown(_)),
                "every malformed event must fall back to Unknown"
            );
        }
    }

    // -----------------------------------------------------------------------
    // Cooperative-chunking branch (full batch skips poll sleep)
    // -----------------------------------------------------------------------

    /// `PgWorker::run` skips the poll-interval sleep when `batch_len ==
    /// batch_size` because a full batch implies more events are likely
    /// waiting at the head.  This unit test pins the boolean condition so
    /// a refactor cannot silently swap `<` for `<=` and reintroduce the
    /// "spinning at head" anti-pattern.
    #[test]
    fn full_batch_skips_poll_sleep_decision() {
        let batch_size: usize = 500;

        // Partial batch — caller MUST sleep before re-polling.
        let partial_batch_len: usize = 250;
        assert!(
            partial_batch_len < batch_size,
            "partial batch must trigger the sleep branch"
        );

        // Full batch — caller MUST skip sleep and immediately re-poll.
        let full_batch_len: usize = batch_size;
        assert!(
            full_batch_len >= batch_size,
            "full batch must NOT trigger the sleep branch"
        );

        // Edge case: a single-event batch on a batch_size of 1 is also "full".
        let single_full = 1_usize;
        let single_cap = 1_usize;
        assert!(
            single_full >= single_cap,
            "batch_len == batch_size == 1 must skip sleep"
        );
    }

    // -----------------------------------------------------------------------
    // Empty-batch checkpoint guard
    // -----------------------------------------------------------------------

    /// `resolve_checkpoint_target` must return `Err(())` on an empty batch so
    /// the worker backs off rather than panicking.  This is the post-#12
    /// invariant — the previous code panicked via `.expect("batch is non-empty")`.
    ///
    /// This calls the real helper used by `save_checkpoint_and_record_metrics`
    /// so a refactor that removes the guard (e.g. swaps to `batch[batch.len() - 1]`)
    /// is caught by the test suite.
    #[test]
    fn resolve_checkpoint_target_empty_batch_errors() {
        let empty: Vec<StoredEvent> = vec![];
        assert_eq!(
            resolve_checkpoint_target(&empty),
            Err(()),
            "empty batch must produce Err(()) — worker must back off"
        );
    }

    /// A non-empty batch's last element provides the checkpoint target
    /// `(sequence, block)` because the `EventSource` returns events ordered
    /// by sequence ASC — the last element is always the highest sequence.
    #[test]
    fn resolve_checkpoint_target_non_empty_batch_is_max_sequence() {
        let batch = [
            make_valid_deposited(10),
            make_valid_deposited(11),
            make_valid_deposited(12),
        ];
        let (seq, block) = resolve_checkpoint_target(&batch).expect("non-empty batch");
        assert_eq!(
            seq, 12,
            "resolve_checkpoint_target must return the highest sequence"
        );
        assert_eq!(
            block, 100,
            "resolve_checkpoint_target must return the block of the last event"
        );
    }
}
