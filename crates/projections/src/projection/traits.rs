//! Projection traits for all database targets.
//!
//! - `Projection` — SurrealDB projections producing `SinkOperation` values
//! - `PgProjection` — PostgreSQL-direct projections using `sqlx::query!`
//! - `BatchProjection` — timer-driven batch projections

use async_trait::async_trait;
use shared::models::StoredEvent;
use shared::parsed_event::ParsedEvent;
use shared::types::EventType;
use sqlx::PgPool;

use crate::error::ProjectionError;
use crate::sink::SinkOperation;

/// A SurrealDB projection transforms a stored event into sink operations.
/// Pure transformation — no DB connections, no mutable state. Fully unit-testable.
pub trait Projection: Send + Sync + 'static {
    /// Which event types this projection handles.
    fn event_types(&self) -> &'static [EventType];

    /// Human-readable name for this projection.
    fn name(&self) -> &str;

    /// Transform a stored event into a set of sink operations.
    fn project(&self, event: &StoredEvent) -> Result<Vec<SinkOperation>, ProjectionError>;

    /// Typed-event path.  Default implementation converts [`ParsedEvent`] back
    /// to a [`StoredEvent`] via [`ParsedEvent::as_stored_event`] and forwards
    /// to [`project`].  Migrated projections override this to eliminate the
    /// round-trip JSON re-serialisation.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Serialization` if `as_stored_event` fails
    /// (classified Fatal — indicates a bug, not a transient DB error).
    // Callers will be added in Phase 4 (Surreal worker typed path) and Phase 2
    // test infrastructure.  Suppressed until then to keep the build clean.
    #[allow(dead_code)]
    fn project_parsed(&self, event: &ParsedEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        let stored = event
            .as_stored_event()
            .map_err(ProjectionError::Serialization)?;
        self.project(&stored)
    }

    /// Returns `true` when this projection overrides [`project_parsed`] and
    /// consumes [`ParsedEvent`] directly instead of round-tripping through JSON.
    ///
    /// The default is `false`.  Projections that override `project_parsed`
    /// should also override this to return `true` so tooling and tests can
    /// detect which projections have been migrated.
    // Will be used by the migration audit in Phase 4.
    #[allow(dead_code)]
    #[inline]
    fn uses_typed_events(&self) -> bool {
        false
    }
}

/// A projection that writes directly to PostgreSQL.
///
/// Implementors receive a batch of events and a `PgPool` reference,
/// and are responsible for their own SQL (typically inline `sqlx::query!`).
/// The worker handles checkpointing, retries, and metrics.
#[async_trait]
pub trait PgProjection: Send + Sync + 'static {
    /// Human-readable name for this projection (used in checkpoints and metrics).
    fn name(&self) -> &str;

    /// Which event types this projection consumes.
    fn event_types(&self) -> &'static [EventType];

    /// Returns `true` when this projection overrides [`process_parsed_batch`]
    /// and consumes [`ParsedEvent`] directly instead of round-tripping through
    /// JSON re-serialisation.
    ///
    /// The default is `false`.  Projections that override `process_parsed_batch`
    /// should also override this to return `true` so tooling and tests can
    /// detect which projections have been migrated.
    // Will be used by the migration audit in Phase 3.
    #[allow(dead_code)]
    #[inline]
    fn uses_typed_events(&self) -> bool {
        false
    }

    /// Optional shard identifier for sharded projections.
    ///
    /// When `Some(id)`, the coordinator uses `"{name}_s{id}"` as the
    /// checkpoint key so that each shard tracks its own progress
    /// independently. Returns `None` for non-sharded projections.
    fn shard_id(&self) -> Option<u32> {
        None
    }

    /// Process a batch of pre-parsed typed events, writing results directly
    /// to PostgreSQL.
    ///
    /// This is the **required** method on the trait: projections receive
    /// already-parsed events from the worker's parse-once block and should
    /// pattern-match on the [`ParsedEvent`] variants they care about. They
    /// can ignore `ParsedEvent::Unknown` variants (the worker filters events
    /// by `event_types()` before calling this method, so only relevant events
    /// reach the projection).
    ///
    /// The implementation should be idempotent — if the same batch is
    /// replayed after a checkpoint failure, the result must be identical.
    /// Use `ON CONFLICT DO NOTHING` or `ON CONFLICT DO UPDATE` as appropriate.
    async fn process_parsed_batch(
        &self,
        pool: &PgPool,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError>;

    /// Process a batch of raw stored events.
    ///
    /// # Default Behaviour
    ///
    /// The default implementation parses every event via
    /// [`ParsedEvent::parse_or_unknown`] and forwards to
    /// [`process_parsed_batch`].  This path exists for a small number of
    /// legacy call sites (tests, shims) that still hold raw [`StoredEvent`]
    /// values — the worker hot-path always parses once and calls
    /// [`process_parsed_batch`] directly so there is no double-parse on
    /// normal traffic.
    ///
    /// Parse failures are recorded via [`crate::metrics::record_parse_error`]
    /// using the projection's [`Self::name`] so the shim has parity with the
    /// worker hot-path's observability — no parse errors are silently dropped.
    ///
    /// # Errors
    ///
    /// Returns the same errors as [`process_parsed_batch`].  Parse failures
    /// from `parse_or_unknown` are *not* surfaced as errors here: they become
    /// `ParsedEvent::Unknown` variants and are forwarded to the projection,
    /// preserving the never-drops-events contract.
    // The worker hot path always parses once and calls `process_parsed_batch`
    // directly, so this shim is only exercised by tests and future raw-event
    // call sites. Suppress the dead-code warning until such a caller exists.
    #[allow(dead_code)]
    async fn process_batch(
        &self,
        pool: &PgPool,
        events: &[StoredEvent],
    ) -> Result<(), ProjectionError> {
        let proj_name = self.name();
        let parsed: Vec<ParsedEvent> = events
            .iter()
            .map(|e| {
                let (p, maybe_err) = ParsedEvent::parse_or_unknown(e.clone());
                if maybe_err.is_some() {
                    // Mirror the worker hot-path: emit the parse-error metric
                    // tagged with the projection name and event type so the
                    // shim is observability-equivalent to the production path.
                    crate::metrics::record_parse_error(proj_name, &e.event_type);
                }
                p
            })
            .collect();
        self.process_parsed_batch(pool, &parsed).await
    }
}

/// A timer-driven batch projection that runs on a fixed interval.
///
/// Unlike event-driven projections, `BatchProjection` does not consume
/// events directly. Instead it periodically wakes up and performs
/// aggregate computation (e.g. leaderboard refresh from dirty sets).
#[async_trait]
pub trait BatchProjection: Send + Sync + 'static {
    /// Human-readable name for this projection.
    fn name(&self) -> &str;

    /// Execute one cycle of batch computation.
    ///
    /// Called by the `BatchWorker` on a timer. Should be idempotent
    /// and handle its own transactionality.
    async fn run_cycle(&self, pool: &PgPool) -> Result<(), ProjectionError>;
}
