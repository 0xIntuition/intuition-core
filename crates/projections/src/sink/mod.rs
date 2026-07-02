pub mod surreal;

use std::collections::HashMap;

use async_trait::async_trait;
use serde_json::Value;

use crate::error::ProjectionError;

/// A record identifier: (table, id)
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RecordId {
    pub table: String,
    pub id: String,
}

impl RecordId {
    pub fn new(table: impl Into<String>, id: impl Into<String>) -> Self {
        Self {
            table: table.into(),
            id: id.into(),
        }
    }
}

impl std::fmt::Display for RecordId {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}", self.table, self.id)
    }
}

/// Graph-database-agnostic operation.
/// Maps naturally to SurrealDB (UPSERT, RELATE, UPDATE)
/// and Neo4j (MERGE, CREATE relationship, SET).
#[derive(Debug, Clone, PartialEq)]
pub enum SinkOperation {
    /// Upsert a node record with the given fields.
    UpsertNode {
        id: RecordId,
        fields: HashMap<String, Value>,
    },
    /// Upsert an edge (relationship) between two nodes.
    UpsertEdge {
        from: RecordId,
        edge_table: String,
        to: RecordId,
        id_suffix: Option<String>,
        fields: HashMap<String, Value>,
    },
    /// Atomically increment numeric fields. Uses UPSERT semantics
    /// so the record is created with the increment value if it doesn't exist.
    IncrementFields {
        id: RecordId,
        increments: HashMap<String, Value>,
    },
    /// Reconcile a draft triple: find any draft with matching SPO but different
    /// ID, rewrite all edge references from the draft to the on-chain record,
    /// delete the draft, then UPSERT the on-chain record.
    ///
    /// This handles the case where the UI creates a draft triple with a random
    /// SurrealDB ID before the same SPO goes on-chain with a deterministic
    /// `triple:<term_id>` key.
    ReconcileTripleDraft {
        /// The on-chain record ID, e.g. `triple:<term_id>`.
        id: RecordId,
        /// Atom hex id for subject.
        subject: String,
        /// Atom hex id for predicate.
        predicate: String,
        /// Atom hex id for object.
        object: String,
        /// Fields to UPSERT on the on-chain record (createdBy, onchain, updatedAt, vault, etc.).
        fields: HashMap<String, Value>,
    },
}

/// Trait for projection sinks (SurrealDB, Neo4j, ClickHouse, etc.)
#[async_trait]
pub trait ProjectionSink: Send + Sync + 'static {
    /// Human-readable name for this sink (e.g. "surrealdb", "neo4j")
    fn name(&self) -> &str;

    /// Apply a batch of operations atomically (or as close to atomically as the sink supports).
    async fn apply_batch(&self, ops: &[SinkOperation]) -> Result<(), ProjectionError>;
}

/// No-op sink used when a real backend (e.g. SurrealDB) is intentionally
/// disabled for an environment. Accepting `apply_batch` calls as a successful
/// no-op lets Surreal-dependent projections keep running their canonical
/// PostgreSQL writes (`kg.nodes`, `intuition.*`) without crashing on
/// `expect("SurrealDB must be connected")` paths.
///
/// Activated automatically by `connect_surreal_if_needed` when
/// `SURREAL_DB_URL` is empty — staging and prod (greenfield, no SurrealDB)
/// take this path; dev keeps writing to its existing SurrealDB instance.
///
/// Full SurrealDB retirement is tracked as an internal follow-up.
pub(crate) struct NoopSink;

#[async_trait]
impl ProjectionSink for NoopSink {
    fn name(&self) -> &str {
        "noop"
    }

    async fn apply_batch(&self, _ops: &[SinkOperation]) -> Result<(), ProjectionError> {
        Ok(())
    }
}
