//! Phase 5: core_entities — triple-write projection (typed pipeline).
//!
//! Consumes AtomCreated and TripleCreated events. Writes to three destinations:
//! - SurrealDB: atom/triple/account/vault nodes (legacy stack; preserved during
//!   migration phase)
//! - PostgreSQL `term` dimension table (indexing-services timescale DB; legacy;
//!   preserved during migration phase)
//! - PostgreSQL `kg.nodes` + `kg.events` (KG database via `DATABASE_KG_URL`;
//!   canonical post-migration destination; optional — graceful no-op when
//!   `DATABASE_KG_URL` is absent)
//!
//! ## Write Ordering
//!
//! SurrealDB → term (timescale) → kg.nodes/kg.events (KG DB).
//!
//! The KG database is a separate Postgres instance from the timescale DB, so
//! there is no single transaction spanning all three destinations.  Safety
//! analysis:
//!
//! 1. All three sinks use idempotent operations (`UPSERT MERGE` for SurrealDB;
//!    `ON CONFLICT DO NOTHING` for both PG destinations), so any replay is safe.
//! 2. The checkpoint advances only after `process_parsed_batch` returns `Ok`,
//!    so a crash anywhere inside this method causes the full batch to replay on
//!    restart, converging all three stores.
//! 3. Consistency windows exist between each step:
//!    - After SurrealDB but before term commit: SurrealDB ahead of both PG stores.
//!    - After term commit but before KG commit: SurrealDB + term ahead of KG.
//!
//!    Both windows are self-healing via replay on restart.
//!
//! ## kg.nodes fields
//!
//! `raw_type` defaults to `'string'` on insert — PR #492's parse worker refines
//! it to the correct type (`'string'`, `'json'`, `'http_uri'`, `'ipfs_uri'`).
//! `classification_type` defaults to `'Unknown'` — the classification worker
//! overwrites it with the correct entity type (`'Person'`, `'Stack'`, etc.).
//! `data_resolved` and `search_text` default to `'{}'`/`''` and are populated
//! by the enrichment worker after classification completes.
//!
//! ## Deferred (follow-up PRs)
//!
//! - Counter-triple activation projector (when a user takes the counter
//!   position via vault deposit) — see helper module doc for rationale
//! - kg-vs-term parity script (follow-up)
//! - Dropping the `term` write path (internal follow-up; requires parity soak)
//!
//! See `docs/core-entities-dual-write-atomicity.md` for the full atomicity
//! analysis, and the internal notes for the migration context.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use serde_json::Value;
use shared::models::{AtomCreatedRecord, StoredEvent, TripleCreatedRecord};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;
use sqlx::PgPool;
use tracing::{debug, info, warn};

use crate::error::{ErrorClass, ProjectionError};
use crate::projection::{datetime_value, get_str};
use crate::repo::dead_letter_repo;
#[cfg(test)]
use crate::sink::NoopSink;
use crate::sink::{ProjectionSink, RecordId, SinkOperation};

/// Projection name used for dead-letter and metric tagging.
const PROJECTION_NAME: &str = "core_entities";

/// Dual-write projection for atoms and triples.
///
/// Holds references to a SurrealDB sink, a timescale PgPool (for `term`
/// writes), and an optional KG PgPool (for `kg.nodes` + `kg.events` writes).
///
/// The KG pool is optional so the projection degrades gracefully when
/// `DATABASE_KG_URL` is not configured (e.g. unit tests, local dev without
/// the KG database running).
pub struct CoreEntitiesProjection {
    surreal_sink: Arc<dyn ProjectionSink>,
    /// Timescale / indexing-services pool: writes to `term`.
    pool: PgPool,
    /// KG database pool: writes to `kg.nodes` + `kg.events`.
    /// `None` when `DATABASE_KG_URL` is not configured; writes are skipped
    /// with an `info!` log on first call, then silently thereafter.
    kg_pool: Option<PgPool>,
}

impl CoreEntitiesProjection {
    pub fn new(surreal_sink: Arc<dyn ProjectionSink>, pool: PgPool) -> Self {
        Self {
            surreal_sink,
            pool,
            kg_pool: None,
        }
    }

    /// Attach a KG database pool.  When present, each `AtomCreated` event
    /// also inserts into `kg.nodes` and `kg.events` in addition to the
    /// existing `term` write.
    pub fn with_kg_pool(mut self, kg_pool: PgPool) -> Self {
        self.kg_pool = Some(kg_pool);
        self
    }
}

/// Decode an atom payload from `0x`-prefixed hex into a UTF-8 string.
///
/// Returns `None` if the hex is invalid, the bytes are not valid UTF-8,
/// or the decoded string contains null bytes (which PostgreSQL TEXT rejects).
fn decode_atom_data_hex(atom_data_hex: &str) -> Option<String> {
    let normalized_hex = atom_data_hex.strip_prefix("0x").unwrap_or(atom_data_hex);
    let decoded_bytes = hex::decode(normalized_hex).ok()?;
    let s = String::from_utf8(decoded_bytes).ok()?;
    // PostgreSQL TEXT columns reject \0 bytes.
    if s.contains('\0') {
        return None;
    }
    Some(s)
}

// ---------------------------------------------------------------------------
// Typed SurrealDB operation builders
// ---------------------------------------------------------------------------

/// Build the three atom sink operations from raw string fields.
///
/// Shared between the typed builder ([`build_atom_ops_typed`]) and the
/// `Unknown` raw-fallback path so both produce byte-identical operations
/// regardless of which entry point we use to recover from a failed parse.
fn build_atom_ops_raw(
    creator: &str,
    term_id: &str,
    atom_data_hex: &str,
    ts: Value,
) -> Vec<SinkOperation> {
    // Binary atoms (images, CBOR, etc.) won't decode to UTF-8.  Store the
    // raw hex as the `data` fallback rather than dropping the event.
    let display_data =
        decode_atom_data_hex(atom_data_hex).unwrap_or_else(|| atom_data_hex.to_owned());

    vec![
        SinkOperation::UpsertNode {
            id: RecordId::new("account", creator),
            fields: HashMap::from([
                ("address".to_owned(), Value::String(creator.to_owned())),
                ("onchain".to_owned(), Value::Bool(true)),
                ("updatedAt".to_owned(), ts.clone()),
            ]),
        },
        SinkOperation::UpsertNode {
            id: RecordId::new("vault", term_id),
            fields: HashMap::from([
                ("createdBy".to_owned(), Value::String(creator.to_owned())),
                ("onchain".to_owned(), Value::Bool(true)),
                ("updatedAt".to_owned(), ts.clone()),
            ]),
        },
        SinkOperation::UpsertNode {
            id: RecordId::new("atom", term_id),
            fields: HashMap::from([
                ("data".to_owned(), Value::String(display_data)),
                (
                    "dataHex".to_owned(),
                    Value::String(atom_data_hex.to_owned()),
                ),
                ("createdBy".to_owned(), Value::String(creator.to_owned())),
                ("type".to_owned(), Value::String("default".to_owned())),
                ("onchain".to_owned(), Value::Bool(true)),
                ("updatedAt".to_owned(), ts),
                ("vault".to_owned(), Value::String(term_id.to_owned())),
            ]),
        },
    ]
}

/// Build SurrealDB sink operations for an AtomCreated event using typed fields.
///
/// Produces three `UpsertNode` operations: account, vault, and atom.
/// `term_id` is already a `0x`-prefixed hex string — pass it through directly.
fn build_atom_ops_typed(metadata: &EventMetadata, data: &AtomCreatedRecord) -> Vec<SinkOperation> {
    let ts = datetime_value(&metadata.block_timestamp);
    build_atom_ops_raw(
        data.creator.as_str(),
        &data.term_id,
        data.atom_data.as_str(),
        ts,
    )
}

/// Build SurrealDB sink operations for a TripleCreated event using typed fields.
///
/// Produces three operations: account `UpsertNode`, vault `UpsertNode`, and
/// `ReconcileTripleDraft`.  All ID fields are already `0x`-prefixed hex
/// strings — pass through directly.
///
/// Delegates to [`crate::projection::surreal::triple::build_raw_triple_ops`]
/// so this projection and `TripleProjection` always produce identical ops,
/// keeping the two code paths in sync with a single implementation.
fn build_triple_ops_typed(
    metadata: &EventMetadata,
    data: &TripleCreatedRecord,
) -> Vec<SinkOperation> {
    let ts = datetime_value(&metadata.block_timestamp);
    crate::projection::surreal::triple::build_raw_triple_ops(
        data.creator.as_str(),
        &data.term_id,
        &data.subject_id,
        &data.predicate_id,
        &data.object_id,
        ts,
    )
}

// ---------------------------------------------------------------------------
// Typed PostgreSQL insert helpers — timescale `term` table
// ---------------------------------------------------------------------------

/// Insert an atom term row into PostgreSQL from raw string fields.
///
/// Shared by both the typed insert helper and the `Unknown` raw-fallback
/// path so both code paths produce byte-identical rows in the `term`
/// table.  Uses `ON CONFLICT DO NOTHING` — safe to replay.
async fn insert_atom_term_pg_raw(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    creator: &str,
    atom_data_hex: &str,
    block_number: i64,
    block_timestamp: DateTime<Utc>,
    transaction_hash: &str,
) -> Result<(), ProjectionError> {
    let decoded = decode_atom_data_hex(atom_data_hex);

    sqlx::query(
        "INSERT INTO term (term_id, term_type, creator, atom_data, atom_data_hex, subject_id, predicate_id, object_id, block_number, block_timestamp, transaction_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (term_id) DO NOTHING",
    )
    .bind(term_id)
    .bind("atom")
    .bind(creator)
    .bind(&decoded)
    .bind(atom_data_hex)
    .bind(None::<String>)
    .bind(None::<String>)
    .bind(None::<String>)
    .bind(block_number)
    .bind(block_timestamp)
    .bind(transaction_hash)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Insert an atom term row into PostgreSQL from a typed record.
///
/// `term_id` is already a `0x`-prefixed hex string — pass through directly.
/// Uses `ON CONFLICT DO NOTHING` — safe to replay.
async fn insert_atom_term_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &AtomCreatedRecord,
) -> Result<(), ProjectionError> {
    insert_atom_term_pg_raw(
        tx,
        &data.term_id,
        data.creator.as_str(),
        data.atom_data.as_str(),
        metadata.block_number,
        metadata.block_timestamp,
        &metadata.transaction_hash,
    )
    .await
}

/// Insert a triple term row into PostgreSQL from raw string fields.
///
/// Shared between the typed insert helper and the `Unknown` raw-fallback
/// path.  Uses `ON CONFLICT DO NOTHING` — safe to replay.
#[allow(clippy::too_many_arguments)]
async fn insert_triple_term_pg_raw(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    creator: &str,
    subject_id: &str,
    predicate_id: &str,
    object_id: &str,
    block_number: i64,
    block_timestamp: DateTime<Utc>,
    transaction_hash: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "INSERT INTO term (term_id, term_type, creator, atom_data, atom_data_hex, subject_id, predicate_id, object_id, block_number, block_timestamp, transaction_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         ON CONFLICT (term_id) DO NOTHING",
    )
    .bind(term_id)
    .bind("triple")
    .bind(creator)
    .bind(None::<String>)
    .bind(None::<String>)
    .bind(subject_id)
    .bind(predicate_id)
    .bind(object_id)
    .bind(block_number)
    .bind(block_timestamp)
    .bind(transaction_hash)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Insert a triple term row into PostgreSQL from a typed record.
///
/// All ID fields are already `0x`-prefixed hex strings — pass through directly.
/// Uses `ON CONFLICT DO NOTHING` — safe to replay.
async fn insert_triple_term_pg(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &TripleCreatedRecord,
) -> Result<(), ProjectionError> {
    insert_triple_term_pg_raw(
        tx,
        &data.term_id,
        data.creator.as_str(),
        &data.subject_id,
        &data.predicate_id,
        &data.object_id,
        metadata.block_number,
        metadata.block_timestamp,
        &metadata.transaction_hash,
    )
    .await
}

// ---------------------------------------------------------------------------
// KG database insert helpers — kg.accounts, kg.nodes, kg.events
// ---------------------------------------------------------------------------

/// Ensure the `kg.accounts` row exists for `account_id`.
///
/// `kg.nodes.created_by` has a FK to `kg.accounts(id)`.  This upsert must
/// run before any `kg.nodes` insert that references `account_id`.
///
/// Uses `ON CONFLICT DO NOTHING` — safe to replay.
async fn upsert_kg_account(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query("INSERT INTO kg.accounts (id) VALUES ($1) ON CONFLICT DO NOTHING")
        .bind(account_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Insert an atom node into `kg.nodes`.
///
/// Field notes:
/// - `raw_type`: defaults to `'string'`; PR #492's parse worker refines it.
/// - `classification_type`: defaults to `'Unknown'`; classification worker
///   overwrites it with the actual entity type.
/// - `data_resolved`: defaults to `'{}'`; enrichment worker populates it.
/// - `search_text`: defaults to `''`; enrichment worker populates it after
///   classification.
/// - `created_at` / `updated_at`: bound to the on-chain `block_timestamp` so
///   replay produces stable timestamps (using `now()` would corrupt audit
///   ordering on every replay).
/// - `ON CONFLICT (id) DO NOTHING`: idempotent on replay.
async fn insert_kg_node_atom(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    creator: &str,
    atom_data: &str,
    atom_data_hex: &str,
    block_timestamp: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    sqlx::query(
        "INSERT INTO kg.nodes
             (id, is_onchain, status, visibility, created_by,
              raw_type, classification_type, data, data_hex, data_resolved,
              parse_attempts, parse_status,
              classification_attempts, classification_status,
              enrichment_attempts, enrichment_status,
              search_text, processing_meta,
              created_at, updated_at)
         VALUES
             ($1, true, 'active', 'public', $2,
              'string', 'Unknown', $3, $4, '{}'::jsonb,
              0, 'pending',
              0, 'pending',
              0, 'pending',
              '', '{}'::jsonb,
              $5, $5)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(term_id)
    .bind(creator)
    .bind(atom_data)
    .bind(atom_data_hex)
    .bind(block_timestamp)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Insert a creation event into `kg.events` for an atom node.
///
/// `kg.events` is a TimescaleDB hypertable partitioned on `event_time`;
/// `(event_time, id)` is the composite primary key. We make the insert
/// truly replay-idempotent by:
///   1. Using `block_timestamp` as `event_time` (stable per chain log).
///   2. Building `id` deterministically from `(tx_hash, log_index)` —
///      unique per emitted log on the canonical chain.
///   3. Adding `ON CONFLICT (event_time, id) DO NOTHING` so a checkpoint
///      replay produces zero duplicate rows instead of growing the audit
///      log on every restart.
///
/// `created_at` is left as wall-clock `now()` because it represents when the
/// row was written into KG (useful for distinguishing initial ingest from
/// replay/backfill); the canonical chain time lives in `event_time`.
///
/// `block_number` is stored as `bigint` in the schema; the event metadata
/// carries it as `i64` which maps directly.
async fn insert_kg_event_atom_created(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    creator: &str,
    term_id: &str,
    block_number: i64,
    tx_hash: &str,
    log_index: i32,
    block_timestamp: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    let event_id = format!("{tx_hash}:{log_index}");
    sqlx::query(
        "INSERT INTO kg.events
             (event_time, id, actor_id, entity_kind, entity_id, event_type,
              classification_type, is_onchain, block_number, tx_hash,
              payload, created_at)
         VALUES ($1, $2, $3, 'node', $4, 'created',
                 'Unknown', true, $5, $6, '{}'::jsonb, now())
         ON CONFLICT (event_time, id) DO NOTHING",
    )
    .bind(block_timestamp)
    .bind(&event_id)
    .bind(creator)
    .bind(term_id)
    .bind(block_number)
    .bind(tx_hash)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// KG database insert helpers — kg.predicates, kg.triples, kg.events (triples)
// ---------------------------------------------------------------------------
//
// Counter-triple semantics (PR #2 scope note):
//
// The on-chain MultiVault contract emits exactly one `TripleCreated` event
// per `createTriples` call — for the canonical / "original" leg. The
// counter-triple's id is derivable (`keccak256(COUNTER_SALT || tripleId)`)
// but no chain event is emitted for it; the contract guards against direct
// initialization (`MultiVault_CannotDirectlyInitializeCounterTriple`). The
// existing `term` and SurrealDB writers store only the original; we mirror
// that here so kg.triples ↔ term parity holds (one row per chain event).
//
// `kg.triples.is_counter_triple` and `kg.triples.sibling_triple_id` are
// retained in the schema for a follow-up PR that explicitly tracks counter
// activations (e.g. when a user deposits to the counter vault). For now,
// originals land with `is_counter_triple = false`, `sibling_triple_id = NULL`.

/// Lazy-upsert `kg.predicates` for a chain predicate.
///
/// `kg.triples.predicate_id` has no FK to `kg.predicates`, but the read clients
/// join on it for slug/label resolution. Pre-seeded predicates (`pred_follows`
/// etc.) are unaffected — `ON CONFLICT (id) DO NOTHING` short-circuits and
/// preserves their human-curated `slug` / `label`. Unknown chain predicates
/// land here with `slug = label = id` so a subsequent enrichment worker can
/// refine without breaking joins in the meantime.
async fn upsert_kg_predicate_lazy(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    predicate_id: &str,
) -> Result<(), ProjectionError> {
    // The chain's TripleCreated emits `predicate_id` from a bytes32 atom hash,
    // which is always 32 non-zero bytes after the `parsed_event` parser. An
    // empty id can only arrive via a malformed test fixture or a future
    // upstream regression; surface that as a debug-time panic rather than
    // a silent `('', '', '')` row.
    debug_assert!(
        !predicate_id.is_empty(),
        "predicate_id must not be empty (parsed_event parser invariant)"
    );
    sqlx::query(
        "INSERT INTO kg.predicates (id, slug, label)
         VALUES ($1, $1, $1)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(predicate_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Insert a triple into `kg.triples`.
///
/// Field notes:
/// - `subject_type` / `predicate_type` / `object_type`: default `'node'` for
///   v1 chain triples (the protocol references atoms only). Triple-of-triple
///   payloads are not yet emitted by the chain; revisit when they are.
///   See the `TODO` markers in the SQL below for the exact
///   literals to lift.
/// - `is_counter_triple`: always `false` in PR #2 — the chain only emits
///   `TripleCreated` for the original. A follow-up PR that tracks counter
///   activations (e.g. counter-vault deposits) will set `true` and populate
///   `sibling_triple_id` accordingly.
/// - `sibling_triple_id`: always `NULL` in PR #2 (see above).
/// - `created_at` / `updated_at`: bound to the on-chain `block_timestamp` —
///   replays land on stable timestamps.
/// - `source = 'onchain'` and `provenance = {"block_number","tx_hash"}`.
/// - `ON CONFLICT (id) DO NOTHING`: idempotent on replay.
#[allow(clippy::too_many_arguments)]
async fn insert_kg_triple(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    triple_id: &str,
    creator: &str,
    subject_id: &str,
    predicate_id: &str,
    object_id: &str,
    is_counter: bool,
    sibling_triple_id: Option<&str>,
    block_number: i64,
    tx_hash: &str,
    block_timestamp: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    debug_assert!(
        !triple_id.is_empty() && !subject_id.is_empty() && !object_id.is_empty(),
        "triple/subject/object ids must not be empty (parsed_event parser invariant)"
    );
    let provenance = serde_json::json!({
        "block_number": block_number,
        "tx_hash": tx_hash,
    });
    sqlx::query(
        // TODO: lift the three `'node'` literals once the chain
        // begins emitting triple-of-triple payloads (subject/object can then
        // be `'triple'`). Schema CHECK `chk_triples_subject_type` etc.
        // already accept that variant.
        "INSERT INTO kg.triples
             (id, status, visibility, created_by,
              subject_id, subject_type, predicate_id, predicate_type,
              object_id, object_type,
              sibling_triple_id, is_counter_triple, edge_kind,
              source, provenance, metadata,
              created_at, updated_at)
         VALUES
             ($1, 'active', 'public', $2,
              $3, 'node', $4, 'node',
              $5, 'node',
              $6, $7, 'claim',
              'onchain', $8, '{}'::jsonb,
              $9, $9)
         ON CONFLICT (id) DO NOTHING",
    )
    .bind(triple_id)
    .bind(creator)
    .bind(subject_id)
    .bind(predicate_id)
    .bind(object_id)
    .bind(sibling_triple_id)
    .bind(is_counter)
    .bind(&provenance)
    .bind(block_timestamp)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// Insert a creation event into `kg.events` for a triple.
///
/// Mirrors `insert_kg_event_atom_created` with `entity_kind = 'triple'`. The
/// event id is deterministic (`{tx_hash}:{log_index}`) and the row is gated by
/// `ON CONFLICT (event_time, id) DO NOTHING` so a replay of the same chain log
/// produces zero new rows.
async fn insert_kg_event_triple_created(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    creator: &str,
    triple_id: &str,
    block_number: i64,
    tx_hash: &str,
    log_index: i32,
    block_timestamp: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    let event_id = format!("{tx_hash}:{log_index}");
    sqlx::query(
        "INSERT INTO kg.events
             (event_time, id, actor_id, entity_kind, entity_id, event_type,
              classification_type, is_onchain, block_number, tx_hash,
              payload, created_at)
         VALUES ($1, $2, $3, 'triple', $4, 'created',
                 'Unknown', true, $5, $6, '{}'::jsonb, now())
         ON CONFLICT (event_time, id) DO NOTHING",
    )
    .bind(block_timestamp)
    .bind(&event_id)
    .bind(creator)
    .bind(triple_id)
    .bind(block_number)
    .bind(tx_hash)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// Per-row apply helpers — drive the kg.* writes for a single chain event
// ---------------------------------------------------------------------------

/// Apply a single AtomCreated row to the KG transaction.
///
/// Performs `kg.accounts` upsert → `kg.nodes` insert → `kg.events` insert.
/// Borrows all string args so the typed and raw call sites share one body
/// without cloning.
#[allow(clippy::too_many_arguments)]
async fn apply_atom_row(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    creator: &str,
    term_id: &str,
    atom_data: &str,
    atom_data_hex: &str,
    block_number: i64,
    tx_hash: &str,
    log_index: i32,
    block_timestamp: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    upsert_kg_account(tx, creator).await?;
    insert_kg_node_atom(
        tx,
        term_id,
        creator,
        atom_data,
        atom_data_hex,
        block_timestamp,
    )
    .await?;
    insert_kg_event_atom_created(
        tx,
        creator,
        term_id,
        block_number,
        tx_hash,
        log_index,
        block_timestamp,
    )
    .await?;
    Ok(())
}

/// Apply a single TripleCreated row to the KG transaction.
///
/// Performs `kg.accounts` upsert → `kg.predicates` lazy upsert → `kg.triples`
/// insert (original leg only — see helper module doc) → `kg.events` insert.
/// `is_counter_triple` and `sibling_triple_id` are unconditionally `false` /
/// `None` for PR #2; a follow-up projector will set them when counter
/// activations are tracked. Borrows all string args.
#[allow(clippy::too_many_arguments)]
async fn apply_triple_row(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    creator: &str,
    triple_id: &str,
    subject_id: &str,
    predicate_id: &str,
    object_id: &str,
    block_number: i64,
    tx_hash: &str,
    log_index: i32,
    block_timestamp: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    upsert_kg_account(tx, creator).await?;
    upsert_kg_predicate_lazy(tx, predicate_id).await?;
    insert_kg_triple(
        tx,
        triple_id,
        creator,
        subject_id,
        predicate_id,
        object_id,
        false, // is_counter_triple — see helper module doc
        None,  // sibling_triple_id — see helper module doc
        block_number,
        tx_hash,
        block_timestamp,
    )
    .await?;
    insert_kg_event_triple_created(
        tx,
        creator,
        triple_id,
        block_number,
        tx_hash,
        log_index,
        block_timestamp,
    )
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------
// PG row plan — buffers which insert to run after the SurrealDB apply_batch
// ---------------------------------------------------------------------------

/// Identifies which PostgreSQL insert to execute for a given event.
///
/// Borrowed references keep the hot loop allocation-free — we hold the
/// original `ParsedEvent` slice alive for the lifetime of the batch.
///
/// The `*Raw` variants carry pre-canonicalized term-id strings (the
/// typed path also produces canonicalized strings via `canonical_shard_key`)
/// so the typed and raw paths land on the same `term` rows regardless of
/// how the event first entered the pipeline.
enum PgTermRow<'a> {
    Atom {
        metadata: &'a EventMetadata,
        data: &'a AtomCreatedRecord,
    },
    Triple {
        metadata: &'a EventMetadata,
        data: &'a TripleCreatedRecord,
    },
    /// Raw-fallback variant for `AtomCreated` events whose typed parse
    /// failed. Borrows the original `StoredEvent` so we can read metadata
    /// (block_number, block_timestamp, transaction_hash) without cloning.
    AtomRaw {
        raw: &'a StoredEvent,
        creator: &'a str,
        /// Pre-canonicalized term id (owned because the canonicalization
        /// step may reallocate).
        term_id: String,
        atom_data_hex: &'a str,
    },
    /// Raw-fallback variant for `TripleCreated` events whose typed parse
    /// failed.
    TripleRaw {
        raw: &'a StoredEvent,
        creator: &'a str,
        term_id: String,
        subject_id: String,
        predicate_id: String,
        object_id: String,
    },
}

// ---------------------------------------------------------------------------
// CoreEntitiesProjection implementation
// ---------------------------------------------------------------------------

impl CoreEntitiesProjection {
    /// Return the projection name used for checkpoints and metrics.
    pub fn name(&self) -> &str {
        "core_entities"
    }

    /// Event types consumed by this projection.
    pub fn event_types(&self) -> &'static [EventType] {
        &[EventType::AtomCreated, EventType::TripleCreated]
    }

    /// Parse a raw event batch and delegate to `process_parsed_batch`.
    ///
    /// This shim is retained for call sites that hold a `&[StoredEvent]`
    /// slice and have not yet parsed it (e.g. integration tests, supervisor
    /// restart paths).  The worker's hot path calls `process_parsed_batch`
    /// directly after parsing once outside the retry loop.
    ///
    /// Kept `pub` so external test harnesses can drive the projection without
    /// constructing `ParsedEvent` values manually.
    // Retained as a parse-once shim: the worker calls process_parsed_batch
    // directly, but this method stays for callers that hold raw StoredEvents.
    #[allow(dead_code)]
    pub async fn process_batch(&self, events: &[StoredEvent]) -> Result<(), ProjectionError> {
        let parsed: Vec<ParsedEvent> = events
            .iter()
            .map(|e| ParsedEvent::parse_or_unknown(e.clone()).0)
            .collect();
        self.process_parsed_batch(&parsed).await
    }

    /// Process a typed batch: write to SurrealDB, the timescale `term` table,
    /// and (when configured) the `kg.nodes` + `kg.events` tables.
    ///
    /// # Write ordering
    ///
    /// SurrealDB first, timescale PG second, KG PG third — see the module-level
    /// doc for the full atomicity reasoning and the safety argument.
    ///
    /// Unknown / unparseable events are skipped with a `warn!` log; the
    /// worker's `process_with_retry` is responsible for emitting the
    /// `projection_parse_error_total` metric for those events.
    pub async fn process_parsed_batch(
        &self,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError> {
        if events.is_empty() {
            return Ok(());
        }

        // Phase 1 — pure planning.  Turns the batch into two buffers: SurrealDB
        // operations and a PG write plan.  No I/O, no gauge side-effects.
        //
        // If planning fails, the returned error is paired with the **index** of
        // the offending event so we can dead-letter exactly that row on a
        // fatal error without polluting the planner's signature with
        // dead-letter concerns.
        let (surreal_ops, pg_plan) = match build_write_plan(events) {
            Ok(plan) => plan,
            Err((err, offending_idx)) => {
                if let ErrorClass::Fatal = err.classify() {
                    let offending = &events[offending_idx];
                    warn!(
                        projection = PROJECTION_NAME,
                        seq = offending.sequence_number(),
                        event_type = offending.event_type(),
                        error = %err,
                        "Fatal error in build_write_plan — dead-lettering event and halting checkpoint"
                    );
                    dead_letter_repo::record_fatal_event(
                        &self.pool,
                        PROJECTION_NAME,
                        offending,
                        &err,
                    )
                    .await;
                }
                return Err(err);
            }
        };

        // ── Write order: SurrealDB FIRST, PostgreSQL SECOND (term), KG THIRD ─
        //
        // This ordering is intentional and critical to safety.  The old order
        // (PG first, then SurrealDB) had a silent-gap failure mode: if the
        // process crashed after the PG commit but before the SurrealDB write,
        // the batch checkpoint would not have advanced.  On restart, the PG
        // `ON CONFLICT DO NOTHING` would skip those rows silently, so SurrealDB
        // would never receive them — a permanent, undetected gap.
        //
        // With the new order the safety argument is:
        //
        //  1. SurrealDB upserts are idempotent (UPSERT + MERGE).  Replaying the
        //     same atoms/triples is always safe.
        //  2. PG uses `ON CONFLICT DO NOTHING`.  Replaying the same term rows is
        //     always safe.
        //  3. kg.nodes also uses `ON CONFLICT DO NOTHING`.  Replaying is safe.
        //  4. The checkpoint is written by the worker *after*
        //     `process_parsed_batch` returns `Ok`.  If the process crashes
        //     anywhere inside this method, the checkpoint stays at its old value,
        //     the full batch replays on restart, and all stores converge.
        //
        // The only remaining inconsistency windows are between steps A/B/C.
        // Each window is typically milliseconds and self-healing via replay.

        // Step A — SurrealDB upserts (idempotent; safe to replay).
        //
        // The gauge management stays inline here rather than inside the helper
        // so the dual-write consistency window is explicit at the call site.
        if !surreal_ops.is_empty() {
            // Signal that we have entered the consistency window: SurrealDB is
            // ahead of PG.  The gauge returns to 0 after the PG commit below,
            // or immediately on error (the caller's retry loop will replay
            // the full batch from the same checkpoint, closing the window).
            crate::metrics::set_dual_write_in_flight(true);
            if let Err(e) = self.surreal_sink.apply_batch(&surreal_ops).await {
                // SurrealDB write failed — PG has not been touched yet, so
                // both stores are still in sync.  Clear the gauge and propagate
                // the error so the worker can retry the full batch.
                crate::metrics::set_dual_write_in_flight(false);
                return Err(e);
            }
        }

        // Step B — PostgreSQL term transaction (ON CONFLICT DO NOTHING; safe to replay).
        let pg_result = self.commit_pg_transaction(&pg_plan).await;

        // Consistency window closes after step B regardless of success/failure.
        // On failure the caller retries from the same checkpoint, so
        // step A will re-run (idempotent) before step B is attempted again.
        crate::metrics::set_dual_write_in_flight(false);
        pg_result?;

        // Step C — KG database writes (kg.nodes + kg.events).
        // This is a separate Postgres instance from the timescale DB; no single
        // transaction can span both.  Idempotency is preserved via ON CONFLICT.
        //
        // The kg_pool is optional: when absent (e.g. unit tests, deployments
        // without DATABASE_KG_URL), we skip this step entirely.
        self.write_kg_batch(&pg_plan).await?;

        Ok(())
    }

    /// Run the PG write plan inside a single transaction.
    ///
    /// Returns `Ok(())` immediately if the plan is empty (no PG writes needed).
    /// Otherwise begins a transaction, inserts every row, and commits.
    ///
    /// This helper is intentionally I/O only — the caller is responsible for
    /// gauge management and replay semantics.  Keeping it separate makes the
    /// orchestration in [`process_parsed_batch`] small enough to read at a
    /// glance.
    async fn commit_pg_transaction(
        &self,
        pg_plan: &[PgTermRow<'_>],
    ) -> Result<(), ProjectionError> {
        if pg_plan.is_empty() {
            return Ok(());
        }

        let mut tx = self.pool.begin().await?;
        for row in pg_plan {
            match row {
                PgTermRow::Atom { metadata, data } => {
                    insert_atom_term_pg(&mut tx, metadata, data).await?;
                }
                PgTermRow::Triple { metadata, data } => {
                    insert_triple_term_pg(&mut tx, metadata, data).await?;
                }
                PgTermRow::AtomRaw {
                    raw,
                    creator,
                    term_id,
                    atom_data_hex,
                } => {
                    insert_atom_term_pg_raw(
                        &mut tx,
                        term_id,
                        creator,
                        atom_data_hex,
                        raw.block_number,
                        raw.block_timestamp,
                        &raw.transaction_hash,
                    )
                    .await?;
                }
                PgTermRow::TripleRaw {
                    raw,
                    creator,
                    term_id,
                    subject_id,
                    predicate_id,
                    object_id,
                } => {
                    insert_triple_term_pg_raw(
                        &mut tx,
                        term_id,
                        creator,
                        subject_id,
                        predicate_id,
                        object_id,
                        raw.block_number,
                        raw.block_timestamp,
                        &raw.transaction_hash,
                    )
                    .await?;
                }
            }
        }
        tx.commit().await?;
        Ok(())
    }

    /// Write atom and triple rows to the KG database (`kg.nodes` / `kg.triples`
    /// / `kg.events`).
    ///
    /// Opens a single transaction per call. Each row in the plan is dispatched
    /// to one of two helpers:
    ///   - [`apply_atom_row`] for `Atom` / `AtomRaw` (kg.accounts → kg.nodes →
    ///     kg.events).
    ///   - [`apply_triple_row`] for `Triple` / `TripleRaw` (kg.accounts →
    ///     kg.predicates → kg.triples → kg.events; original leg only — see
    ///     the helper module doc for the counter-triple deferral rationale).
    ///
    /// **Intra-batch ordering assumption**: callers must populate `pg_plan` in
    /// chain order. The `parsed_event` source preserves this naturally, so
    /// atoms always precede the triples that reference them within a batch.
    /// `kg.triples` has no FK to `kg.nodes`, so an out-of-order batch would
    /// only produce briefly-stale read-side JOINs (not an error), but the
    /// invariant is worth flagging here.
    ///
    /// Returns `Ok(())` immediately when the KG pool is absent or the plan
    /// is empty (atom-only batches still write atoms; triple-only batches
    /// still write triples).
    async fn write_kg_batch(&self, pg_plan: &[PgTermRow<'_>]) -> Result<(), ProjectionError> {
        let kg_pool = match &self.kg_pool {
            Some(p) => p,
            None => return Ok(()),
        };

        if pg_plan.is_empty() {
            return Ok(());
        }

        let mut tx = kg_pool.begin().await?;

        for row in pg_plan {
            match row {
                PgTermRow::Atom { metadata, data } => {
                    let atom_data = decode_atom_data_hex(data.atom_data.as_str())
                        .unwrap_or_else(|| data.atom_data.clone());
                    apply_atom_row(
                        &mut tx,
                        data.creator.as_str(),
                        data.term_id.as_str(),
                        &atom_data,
                        data.atom_data.as_str(),
                        metadata.block_number,
                        &metadata.transaction_hash,
                        metadata.log_index,
                        metadata.block_timestamp,
                    )
                    .await?;
                }
                PgTermRow::AtomRaw {
                    raw,
                    creator,
                    term_id,
                    atom_data_hex,
                } => {
                    let atom_data = decode_atom_data_hex(atom_data_hex)
                        .unwrap_or_else(|| (*atom_data_hex).to_owned());
                    apply_atom_row(
                        &mut tx,
                        creator,
                        term_id,
                        &atom_data,
                        atom_data_hex,
                        raw.block_number,
                        &raw.transaction_hash,
                        raw.log_index,
                        raw.block_timestamp,
                    )
                    .await?;
                }
                PgTermRow::Triple { metadata, data } => {
                    apply_triple_row(
                        &mut tx,
                        data.creator.as_str(),
                        data.term_id.as_str(),
                        &data.subject_id,
                        &data.predicate_id,
                        &data.object_id,
                        metadata.block_number,
                        &metadata.transaction_hash,
                        metadata.log_index,
                        metadata.block_timestamp,
                    )
                    .await?;
                }
                PgTermRow::TripleRaw {
                    raw,
                    creator,
                    term_id,
                    subject_id,
                    predicate_id,
                    object_id,
                } => {
                    apply_triple_row(
                        &mut tx,
                        creator,
                        term_id,
                        subject_id,
                        predicate_id,
                        object_id,
                        raw.block_number,
                        &raw.transaction_hash,
                        raw.log_index,
                        raw.block_timestamp,
                    )
                    .await?;
                }
            }
        }

        tx.commit().await?;

        let (atom_count, triple_count) =
            pg_plan.iter().fold((0usize, 0usize), |(a, t), r| match r {
                PgTermRow::Atom { .. } | PgTermRow::AtomRaw { .. } => (a + 1, t),
                PgTermRow::Triple { .. } | PgTermRow::TripleRaw { .. } => (a, t + 1),
            });
        info!(
            projection = PROJECTION_NAME,
            atom_count,
            triple_count,
            // Per atom: 1 kg.nodes + 1 kg.events. Per triple: 1 kg.triples +
            // 1 kg.events (and N kg.predicates upserts where N <= triple_count).
            "kg writes committed (kg.nodes/kg.triples/kg.predicates/kg.events)"
        );

        Ok(())
    }
}

/// Pure planner: walk a batch of typed events and produce two buffers — the
/// SurrealDB operations to apply and the PG write plan to commit.
///
/// No I/O, no metrics, no side-effects: the result depends only on the input
/// events.  Unknown variants for `AtomCreated` and `TripleCreated` fall back
/// to raw extraction so no event is silently dropped.  Any other Unknown
/// variant is logged at debug and skipped; unexpected typed variants are
/// logged at warn (upstream `event_types()` should have filtered them).
///
/// # Errors
///
/// Returns `Err((ProjectionError, offending_index))` if a raw-fallback event
/// is missing a required field (`creator`, `term_id`, `atom_data`, etc.).
/// The index points at the event in `events` that caused the failure so the
/// caller can dead-letter it precisely without re-scanning the batch.
fn build_write_plan(
    events: &[ParsedEvent],
) -> Result<(Vec<SinkOperation>, Vec<PgTermRow<'_>>), (ProjectionError, usize)> {
    let mut surreal_ops = Vec::with_capacity(events.len() * 3);
    let mut pg_plan: Vec<PgTermRow<'_>> = Vec::with_capacity(events.len());

    for (idx, event) in events.iter().enumerate() {
        // Per-event planner — uses `?` on `ProjectionError` internally; the
        // outer match wraps any error with the offending index so the caller
        // can dead-letter exactly the row that failed.
        let per_event = (|| -> Result<(), ProjectionError> {
            match event {
                ParsedEvent::AtomCreated { metadata, data } => {
                    surreal_ops.extend(build_atom_ops_typed(metadata, data));
                    pg_plan.push(PgTermRow::Atom { metadata, data });
                }
                ParsedEvent::TripleCreated { metadata, data } => {
                    surreal_ops.extend(build_triple_ops_typed(metadata, data));
                    pg_plan.push(PgTermRow::Triple { metadata, data });
                }
                // Raw-fallback: AtomCreated that failed typed parse.
                //
                // Mirrors `surreal/atom.rs` — we never drop an event just
                // because serde could not deserialize it.  Read the raw
                // fields from `raw.event_data`; `term_id` is already a hex
                // string so no canonicalization is needed.
                ParsedEvent::Unknown(raw) if raw.event_type == "AtomCreated" => {
                    let creator = get_str(&raw.event_data, "creator")?;
                    let term_id = get_str(&raw.event_data, "term_id")?;
                    let atom_data_hex = get_str(&raw.event_data, "atom_data")?;
                    let ts = datetime_value(&raw.block_timestamp);
                    surreal_ops.extend(build_atom_ops_raw(creator, term_id, atom_data_hex, ts));
                    pg_plan.push(PgTermRow::AtomRaw {
                        raw,
                        creator,
                        term_id: term_id.to_owned(),
                        atom_data_hex,
                    });
                }
                // Raw-fallback: TripleCreated that failed typed parse.
                ParsedEvent::Unknown(raw) if raw.event_type == "TripleCreated" => {
                    let creator = get_str(&raw.event_data, "creator")?;
                    let term_id = get_str(&raw.event_data, "term_id")?;
                    let subject_id = get_str(&raw.event_data, "subject_id")?;
                    let predicate_id = get_str(&raw.event_data, "predicate_id")?;
                    let object_id = get_str(&raw.event_data, "object_id")?;
                    let ts = datetime_value(&raw.block_timestamp);
                    surreal_ops.extend(crate::projection::surreal::triple::build_raw_triple_ops(
                        creator,
                        term_id,
                        subject_id,
                        predicate_id,
                        object_id,
                        ts,
                    ));
                    pg_plan.push(PgTermRow::TripleRaw {
                        raw,
                        creator,
                        term_id: term_id.to_owned(),
                        subject_id: subject_id.to_owned(),
                        predicate_id: predicate_id.to_owned(),
                        object_id: object_id.to_owned(),
                    });
                }
                ParsedEvent::Unknown(raw) => {
                    // Any other unknown event type — not one of the two
                    // this projection consumes.  The worker already emitted
                    // `projection_parse_error_total` for typed parse failures,
                    // so just log at debug level and move on.
                    debug!(
                        sequence   = raw.sequence_number,
                        event_type = %raw.event_type,
                        "core_entities: unknown event type — skipping"
                    );
                }
                // Other typed variants (Deposited, Redeemed, etc.) should never
                // reach here — event_types() filters upstream.  Log defensively.
                _ => {
                    warn!("core_entities: received unexpected typed event variant, skipping");
                }
            }
            Ok(())
        })();

        if let Err(err) = per_event {
            return Err((err, idx));
        }
    }

    Ok((surreal_ops, pg_plan))
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;

    // ── Shared test helpers ──────────────────────────────────────────────────

    const HELLO_WORLD_HEX: &str = "0x68656c6c6f20776f726c64";

    // Hex-format IDs used by atom and triple test records.
    const HEX_42: &str = "0x000000000000000000000000000000000000000000000000000000000000002a";
    const HEX_99: &str = "0x0000000000000000000000000000000000000000000000000000000000000063";
    const HEX_1: &str = "0x0000000000000000000000000000000000000000000000000000000000000001";
    const HEX_2: &str = "0x0000000000000000000000000000000000000000000000000000000000000002";
    const HEX_3: &str = "0x0000000000000000000000000000000000000000000000000000000000000003";

    /// Build a minimal `EventMetadata` for use in typed-builder tests.
    fn make_metadata() -> EventMetadata {
        EventMetadata {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 0,
            event_type: "AtomCreated".to_owned(),
            term_id: Some(HEX_42.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    /// Build a minimal `AtomCreatedRecord` with a UTF-8 hex payload.
    fn make_atom_record() -> AtomCreatedRecord {
        AtomCreatedRecord {
            creator: "0xCreator".to_owned(),
            term_id: HEX_42.to_owned(),
            atom_data: HELLO_WORLD_HEX.to_owned(),
            atom_wallet: "0xWallet".to_owned(),
        }
    }

    /// Build a minimal `TripleCreatedRecord`.
    fn make_triple_record() -> TripleCreatedRecord {
        TripleCreatedRecord {
            creator: "0xCreator".to_owned(),
            term_id: HEX_99.to_owned(),
            subject_id: HEX_1.to_owned(),
            predicate_id: HEX_2.to_owned(),
            object_id: HEX_3.to_owned(),
        }
    }

    /// Build a complete `StoredEvent` whose `event_data` satisfies all fields
    /// required by `AtomCreatedRecord` for serde deserialization.
    ///
    /// Envelope fields (block_number, block_hash, etc.) live on the outer
    /// `StoredEvent` and are NOT repeated inside `event_data`.
    fn make_atom_stored_event() -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 0,
            event_type: "AtomCreated".to_owned(),
            event_data: json!({
                "creator":     "0xCreator",
                "term_id":     HEX_42,
                "atom_data":   HELLO_WORLD_HEX,
                "atom_wallet": "0xWallet"
            }),
            term_id: Some(HEX_42.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    /// Build a complete `StoredEvent` for TripleCreated.
    ///
    /// Envelope fields (block_number, block_hash, etc.) live on the outer
    /// `StoredEvent` and are NOT repeated inside `event_data`.
    fn make_triple_stored_event() -> StoredEvent {
        StoredEvent {
            sequence_number: 2,
            block_number: 101,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash2".to_owned(),
            transaction_hash: "0xtxhash2".to_owned(),
            log_index: 1,
            event_type: "TripleCreated".to_owned(),
            event_data: json!({
                "creator":      "0xCreator",
                "term_id":      HEX_99,
                "subject_id":   HEX_1,
                "predicate_id": HEX_2,
                "object_id":    HEX_3
            }),
            term_id: Some(HEX_99.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    // ── build_atom_ops_typed tests ──────────────────────────────────────────

    #[test]
    fn build_atom_ops_typed_emits_three_ops() {
        let metadata = make_metadata();
        let data = make_atom_record();
        let ops = build_atom_ops_typed(&metadata, &data);
        assert_eq!(ops.len(), 3, "atom builder must emit exactly 3 ops");
    }

    #[test]
    fn build_atom_ops_typed_matches_raw_path_for_all_fields() {
        let metadata = make_metadata();
        let data = make_atom_record();
        let ops = build_atom_ops_typed(&metadata, &data);

        // Op 0: account node
        let SinkOperation::UpsertNode { id, fields } = &ops[0] else {
            panic!("expected UpsertNode for account");
        };
        assert_eq!(id.table, "account");
        assert_eq!(id.id, "0xCreator");
        assert_eq!(fields["address"], json!("0xCreator"));
        assert_eq!(fields["onchain"], Value::Bool(true));

        // Op 1: vault node
        let SinkOperation::UpsertNode { id, fields } = &ops[1] else {
            panic!("expected UpsertNode for vault");
        };
        assert_eq!(id.table, "vault");
        assert_eq!(id.id, HEX_42);
        assert_eq!(fields["createdBy"], json!("0xCreator"));

        // Op 2: atom node — decoded hex must equal "hello world"
        let SinkOperation::UpsertNode { id, fields } = &ops[2] else {
            panic!("expected UpsertNode for atom");
        };
        assert_eq!(id.table, "atom");
        assert_eq!(id.id, HEX_42);
        assert_eq!(fields["data"], json!("hello world"));
        assert_eq!(fields["dataHex"], json!(HELLO_WORLD_HEX));
        assert_eq!(fields["createdBy"], json!("0xCreator"));
        assert_eq!(fields["vault"], json!(HEX_42));
        assert_eq!(fields["type"], json!("default"));
        assert_eq!(fields["onchain"], Value::Bool(true));
    }

    #[test]
    fn build_atom_ops_typed_binary_atom_falls_back_to_hex() {
        // "0xff" is invalid UTF-8 — the builder must store the hex as both
        // `data` and `dataHex` rather than panicking or silently dropping it.
        let metadata = make_metadata();
        let data = AtomCreatedRecord {
            atom_data: "0xff".to_owned(),
            ..make_atom_record()
        };
        let ops = build_atom_ops_typed(&metadata, &data);
        assert_eq!(ops.len(), 3);
        let SinkOperation::UpsertNode { fields, .. } = &ops[2] else {
            panic!("expected UpsertNode");
        };
        assert_eq!(
            fields["data"],
            json!("0xff"),
            "binary atoms fall back to hex in data"
        );
        assert_eq!(
            fields["dataHex"],
            json!("0xff"),
            "binary atoms store hex in dataHex"
        );
    }

    // ── build_triple_ops_typed tests ────────────────────────────────────────

    #[test]
    fn build_triple_ops_typed_emits_three_ops() {
        let metadata = make_metadata();
        let data = make_triple_record();
        let ops = build_triple_ops_typed(&metadata, &data);
        assert_eq!(ops.len(), 3, "triple builder must emit exactly 3 ops");
    }

    #[test]
    fn build_triple_ops_typed_matches_raw_path_for_all_fields() {
        let metadata = make_metadata();
        let data = make_triple_record();
        let ops = build_triple_ops_typed(&metadata, &data);

        // Op 0: account node
        let SinkOperation::UpsertNode { id, fields } = &ops[0] else {
            panic!("expected UpsertNode for account");
        };
        assert_eq!(id.table, "account");
        assert_eq!(id.id, "0xCreator");
        assert_eq!(fields["address"], json!("0xCreator"));

        // Op 1: vault node
        let SinkOperation::UpsertNode { id, fields } = &ops[1] else {
            panic!("expected UpsertNode for vault");
        };
        assert_eq!(id.table, "vault");
        assert_eq!(id.id, HEX_99);
        assert_eq!(fields["createdBy"], json!("0xCreator"));

        // Op 2: triple reconcile with subject/predicate/object
        let SinkOperation::ReconcileTripleDraft {
            id,
            subject,
            predicate,
            object,
            fields,
        } = &ops[2]
        else {
            panic!("expected ReconcileTripleDraft for triple, got {:?}", ops[2]);
        };
        assert_eq!(id.table, "triple");
        assert_eq!(id.id, HEX_99);
        assert_eq!(subject, HEX_1);
        assert_eq!(predicate, HEX_2);
        assert_eq!(object, HEX_3);
        assert_eq!(fields["subject"], json!(HEX_1));
        assert_eq!(fields["predicate"], json!(HEX_2));
        assert_eq!(fields["object"], json!(HEX_3));
        assert_eq!(fields["createdBy"], json!("0xCreator"));
        assert_eq!(fields["vault"], json!(HEX_99));
        assert_eq!(fields["onchain"], Value::Bool(true));
    }

    // ── decode_atom_data_hex tests ──────────────────────────────────────────

    #[test]
    fn decode_atom_data_hex_fallback_to_hex_for_binary() {
        // Binary payload — decode fails silently; builder stores hex in both fields.
        let metadata = make_metadata();
        let data = AtomCreatedRecord {
            atom_data: "0xff".to_owned(),
            ..make_atom_record()
        };
        let ops = build_atom_ops_typed(&metadata, &data);
        let SinkOperation::UpsertNode { fields, .. } = &ops[2] else {
            panic!("expected UpsertNode");
        };
        // Both `data` and `dataHex` must hold the raw hex string.
        assert_eq!(fields.get("data").unwrap(), &json!("0xff"));
        assert_eq!(fields.get("dataHex").unwrap(), &json!("0xff"));
    }

    // ── build_write_plan tests ──────────────────────────────────────────────

    #[test]
    fn build_write_plan_empty_slice_produces_no_ops_and_no_pg_rows() {
        let events: &[ParsedEvent] = &[];
        let (surreal_ops, pg_plan) = build_write_plan(events).expect("empty slice must succeed");
        assert!(
            surreal_ops.is_empty(),
            "empty input must produce no surreal ops"
        );
        assert!(pg_plan.is_empty(), "empty input must produce no pg rows");
    }

    #[test]
    fn build_write_plan_atom_event_produces_atom_row_and_surreal_ops() {
        let (atom_parsed, err) = ParsedEvent::parse_or_unknown(make_atom_stored_event());
        assert!(err.is_none(), "atom parse must succeed");

        let events = vec![atom_parsed];
        let (surreal_ops, pg_plan) = build_write_plan(&events).expect("plan must succeed");

        assert_eq!(surreal_ops.len(), 3, "one atom => 3 surreal ops");
        assert_eq!(pg_plan.len(), 1, "one atom => 1 pg row");
        assert!(
            matches!(pg_plan[0], PgTermRow::Atom { .. }),
            "row must be Atom variant"
        );
    }

    #[test]
    fn build_write_plan_triple_event_produces_triple_row_and_surreal_ops() {
        let (triple_parsed, err) = ParsedEvent::parse_or_unknown(make_triple_stored_event());
        assert!(err.is_none(), "triple parse must succeed");

        let events = vec![triple_parsed];
        let (surreal_ops, pg_plan) = build_write_plan(&events).expect("plan must succeed");

        assert_eq!(surreal_ops.len(), 3, "one triple => 3 surreal ops");
        assert_eq!(pg_plan.len(), 1, "one triple => 1 pg row");
        assert!(
            matches!(pg_plan[0], PgTermRow::Triple { .. }),
            "row must be Triple variant"
        );
    }

    #[test]
    fn build_write_plan_skips_other_unknown_events() {
        // Unknown event type that is NOT AtomCreated or TripleCreated.
        let unknown_event = StoredEvent {
            sequence_number: 99,
            block_number: 1,
            block_timestamp: Utc::now(),
            block_hash: "0xhash".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "SomethingElse".to_owned(),
            event_data: json!({}),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        let (unknown_parsed, _) = ParsedEvent::parse_or_unknown(unknown_event);

        let events = vec![unknown_parsed];
        let (surreal_ops, pg_plan) = build_write_plan(&events).expect("plan must succeed");
        assert!(surreal_ops.is_empty(), "unknown event => no surreal ops");
        assert!(pg_plan.is_empty(), "unknown event => no pg rows");
    }

    #[test]
    fn build_write_plan_handles_mixed_atom_and_triple() {
        let (atom_parsed, _) = ParsedEvent::parse_or_unknown(make_atom_stored_event());
        let (triple_parsed, _) = ParsedEvent::parse_or_unknown(make_triple_stored_event());

        let events = vec![atom_parsed, triple_parsed];
        let (surreal_ops, pg_plan) = build_write_plan(&events).expect("plan must succeed");

        assert_eq!(surreal_ops.len(), 6, "atom+triple => 6 surreal ops");
        assert_eq!(pg_plan.len(), 2, "atom+triple => 2 pg rows");
        assert!(matches!(pg_plan[0], PgTermRow::Atom { .. }));
        assert!(matches!(pg_plan[1], PgTermRow::Triple { .. }));
    }

    #[test]
    fn build_write_plan_atom_created_unknown_falls_back_to_raw() {
        // Unknown parse of an AtomCreated event — must fall back to raw path.
        let unknown_atom = StoredEvent {
            sequence_number: 5,
            block_number: 200,
            block_timestamp: Utc::now(),
            block_hash: "0xhash".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "AtomCreated".to_owned(),
            // Intentionally invalid typed fields so serde parse fails → Unknown
            event_data: json!({
                "creator": "0xFallbackCreator",
                "term_id": HEX_42,
                "atom_data": HELLO_WORLD_HEX,
                // atom_wallet missing — serde parse will fail
            }),
            term_id: Some(HEX_42.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        let (parsed, _) = ParsedEvent::parse_or_unknown(unknown_atom);
        // Whether this parses as typed or Unknown depends on the AtomCreatedRecord
        // definition — the important thing is that build_write_plan handles it.
        let events = vec![parsed];
        let result = build_write_plan(&events);
        assert!(
            result.is_ok(),
            "build_write_plan must not error on fallback"
        );
    }

    #[test]
    fn build_write_plan_triple_created_unknown_falls_back_to_raw() {
        let unknown_triple = StoredEvent {
            sequence_number: 6,
            block_number: 201,
            block_timestamp: Utc::now(),
            block_hash: "0xhash2".to_owned(),
            transaction_hash: "0xtx2".to_owned(),
            log_index: 0,
            event_type: "TripleCreated".to_owned(),
            event_data: json!({
                "creator":      "0xCreator",
                "term_id":      HEX_99,
                "subject_id":   HEX_1,
                "predicate_id": HEX_2,
                "object_id":    HEX_3,
                // no other fields to trigger fallback
            }),
            term_id: Some(HEX_99.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        let (parsed, _) = ParsedEvent::parse_or_unknown(unknown_triple);
        let events = vec![parsed];
        let result = build_write_plan(&events);
        assert!(
            result.is_ok(),
            "build_write_plan must not error on triple fallback"
        );
    }

    // ── write_kg_batch unit tests (no-op when kg_pool is None) ───────
    //
    // These tests use `crate::sink::NoopSink` (the production `pub(crate)`
    // null-object sink) to satisfy the `Arc<dyn ProjectionSink>` constructor
    // argument. `apply_batch` is never invoked by the tests below — they only
    // exercise the `kg_pool: None` early-return on the kg-write helper, which
    // never touches the surreal sink.

    #[tokio::test]
    async fn write_kg_batch_skips_when_no_kg_pool() {
        // Build a CoreEntitiesProjection with NO kg_pool. PgPool::connect_lazy
        // returns a pool handle that performs no I/O until first query, so
        // this test runs without any live database — the early-return path
        // we are asserting must fire before any pool method is touched.
        let surreal_sink: Arc<dyn ProjectionSink> = Arc::new(NoopSink);
        let pg_pool = sqlx::PgPool::connect_lazy("postgres://invalid:invalid@127.0.0.1:1/x")
            .expect("connect_lazy must not perform I/O");
        let projection = CoreEntitiesProjection::new(surreal_sink, pg_pool);

        // Empty plan: trivially fine — the kg_pool check still runs first.
        projection
            .write_kg_batch(&[])
            .await
            .expect("kg_pool=None must return Ok for empty plan");

        // Non-empty plan with an Atom row: this would attempt to begin a
        // transaction on the kg_pool if the early-return were broken. The
        // test covers the exact regression we care about — accidentally
        // dropping the `None => return Ok(())` branch.
        let metadata = sample_metadata();
        let atom = sample_atom_record();
        let plan = vec![PgTermRow::Atom {
            metadata: &metadata,
            data: &atom,
        }];
        projection
            .write_kg_batch(&plan)
            .await
            .expect("kg_pool=None must return Ok before touching the (absent) pool");
    }

    fn sample_metadata() -> EventMetadata {
        EventMetadata {
            sequence_number: 0,
            block_number: 1,
            block_timestamp: Utc::now(),
            block_hash: "0xblock".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "AtomCreated".to_owned(),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    fn sample_atom_record() -> AtomCreatedRecord {
        AtomCreatedRecord {
            creator: "0xabc".to_owned(),
            term_id: "0xterm".to_owned(),
            atom_wallet: "0xwallet".to_owned(),
            atom_data: "0x68656c6c6f".to_owned(),
        }
    }

    // ── write_kg_batch graceful skip with Triple plans ──────────────────────

    #[tokio::test]
    async fn write_kg_batch_skips_triple_plan_when_no_kg_pool() {
        // Mirror `write_kg_batch_skips_when_no_kg_pool` for the triple path:
        // build a Triple-populated plan and prove `kg_pool=None` returns Ok
        // before touching the (absent) pool.
        let surreal_sink: Arc<dyn ProjectionSink> = Arc::new(NoopSink);
        let pg_pool = sqlx::PgPool::connect_lazy("postgres://invalid:invalid@127.0.0.1:1/x")
            .expect("connect_lazy must not perform I/O");
        let projection = CoreEntitiesProjection::new(surreal_sink, pg_pool);

        let metadata = sample_metadata();
        let triple = sample_triple_record();
        let plan = vec![PgTermRow::Triple {
            metadata: &metadata,
            data: &triple,
        }];
        projection
            .write_kg_batch(&plan)
            .await
            .expect("kg_pool=None must return Ok for triple plan");
    }

    fn sample_triple_record() -> TripleCreatedRecord {
        TripleCreatedRecord {
            creator: "0xabc".to_owned(),
            term_id: "0x57946a02776dbd4eec339ecf5cdf6e0005b8de381fb3d9a2bf303da083bf5166"
                .to_owned(),
            subject_id: "0x05bb6d28ed5ca3c5206f33f5818da27b3b0bbf6401cd40f082e8db7fcf481787"
                .to_owned(),
            predicate_id: "0xdb3dc8c92d6141c4e0c9b453b00fc1f237624ef8373b6ae9972d09557d8aaa8d"
                .to_owned(),
            object_id: "0x39afce29ac0e4be2400fa0421b537f63ad2d78d7f8b4be4ff839a162ff3e5ffc"
                .to_owned(),
        }
    }

    // ── kg.nodes field population tests ─────────────────────────────────────

    #[test]
    fn kg_node_atom_decode_uses_utf8_when_possible() {
        // HELLO_WORLD_HEX decodes to "hello world" — verify the decode path
        // used for kg.nodes.data returns the readable string.
        let decoded = decode_atom_data_hex(HELLO_WORLD_HEX);
        assert_eq!(decoded, Some("hello world".to_owned()));
    }

    #[test]
    fn kg_node_atom_decode_falls_back_for_binary_data() {
        // 0xff is not valid UTF-8 — the fallback must return None so the
        // caller can substitute the raw hex.
        let decoded = decode_atom_data_hex("0xff");
        assert!(decoded.is_none(), "binary data must decode to None");
    }

    #[test]
    fn kg_node_atom_decode_strips_0x_prefix() {
        // Verify 0x prefix stripping works correctly.
        let decoded = decode_atom_data_hex("0x68656c6c6f20776f726c64");
        assert_eq!(decoded, Some("hello world".to_owned()));
    }

    #[test]
    fn kg_node_atom_decode_handles_empty_hex() {
        // Empty payload (0x with nothing after) should decode to empty string.
        let decoded = decode_atom_data_hex("0x");
        assert_eq!(decoded, Some(String::new()));
    }

    // ── process_parsed_batch unit tests (no DB) ─────────────────────────────

    #[test]
    fn build_typed_plan_empty_slice_produces_no_ops_and_no_pg_rows() {
        // Verify the pre-write iteration loop is a no-op for empty input.
        // We unit-test the loop directly since we cannot call process_parsed_batch
        // without a real pool and surreal_sink.
        let events: &[ParsedEvent] = &[];
        let mut surreal_ops: Vec<SinkOperation> = Vec::new();
        let mut pg_count = 0usize;

        for event in events {
            match event {
                ParsedEvent::AtomCreated { metadata, data } => {
                    surreal_ops.extend(build_atom_ops_typed(metadata, data));
                    pg_count += 1;
                }
                ParsedEvent::TripleCreated { metadata, data } => {
                    surreal_ops.extend(build_triple_ops_typed(metadata, data));
                    pg_count += 1;
                }
                _ => {}
            }
        }

        assert!(
            surreal_ops.is_empty(),
            "empty input must produce no surreal ops"
        );
        assert_eq!(pg_count, 0, "empty input must produce no pg rows");
    }

    #[test]
    fn build_typed_plan_skips_unknown_variant_and_counts_only_typed() {
        // Mixed batch: one valid atom + one Unknown (malformed parse result).
        // The loop must buffer exactly 1 PgTermRow and 3 SurrealDB ops.
        let (atom_parsed, err) = ParsedEvent::parse_or_unknown(make_atom_stored_event());
        assert!(err.is_none(), "atom parse must succeed");

        let unknown_event = StoredEvent {
            sequence_number: 99,
            block_number: 1,
            block_timestamp: Utc::now(),
            block_hash: "0xhash".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "AtomCreated".to_owned(),
            // Missing required fields — parse will produce Unknown
            event_data: json!({ "bad": "data" }),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        let (unknown_parsed, _) = ParsedEvent::parse_or_unknown(unknown_event);
        assert!(
            matches!(unknown_parsed, ParsedEvent::Unknown(_)),
            "malformed event must parse to Unknown"
        );

        let events = vec![atom_parsed, unknown_parsed];
        let mut surreal_ops: Vec<SinkOperation> = Vec::new();
        let mut pg_count = 0usize;

        for event in &events {
            match event {
                ParsedEvent::AtomCreated { metadata, data } => {
                    surreal_ops.extend(build_atom_ops_typed(metadata, data));
                    pg_count += 1;
                }
                ParsedEvent::TripleCreated { metadata, data } => {
                    surreal_ops.extend(build_triple_ops_typed(metadata, data));
                    pg_count += 1;
                }
                ParsedEvent::Unknown(_) => { /* skip */ }
                _ => {}
            }
        }

        assert_eq!(surreal_ops.len(), 3, "one atom => 3 surreal ops");
        assert_eq!(pg_count, 1, "one atom => 1 pg row; Unknown is skipped");
    }

    #[test]
    fn build_typed_plan_handles_mixed_atom_and_triple() {
        // Two typed events in one batch — verify both are buffered correctly.
        let (atom_parsed, _) = ParsedEvent::parse_or_unknown(make_atom_stored_event());
        let (triple_parsed, _) = ParsedEvent::parse_or_unknown(make_triple_stored_event());

        let events = vec![atom_parsed, triple_parsed];
        let mut surreal_ops: Vec<SinkOperation> = Vec::new();
        let mut pg_count = 0usize;

        for event in &events {
            match event {
                ParsedEvent::AtomCreated { metadata, data } => {
                    surreal_ops.extend(build_atom_ops_typed(metadata, data));
                    pg_count += 1;
                }
                ParsedEvent::TripleCreated { metadata, data } => {
                    surreal_ops.extend(build_triple_ops_typed(metadata, data));
                    pg_count += 1;
                }
                _ => {}
            }
        }

        // 3 ops per event × 2 events = 6
        assert_eq!(surreal_ops.len(), 6, "atom+triple => 6 surreal ops");
        assert_eq!(pg_count, 2, "atom+triple => 2 pg rows");
    }
}
