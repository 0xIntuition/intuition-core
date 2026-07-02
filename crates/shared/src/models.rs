use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::types::BigDecimal;

use crate::types::*;

/// Stored event from event_store table
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct StoredEvent {
    pub sequence_number: SequenceNumber,
    pub block_number: BlockNumber,
    pub block_timestamp: DateTime<Utc>,
    pub block_hash: String,
    pub transaction_hash: String,
    pub log_index: LogIndex,
    pub event_type: String,
    pub event_data: serde_json::Value,
    pub term_id: Option<String>,
    pub entity_id: Option<String>,
    pub is_canonical: bool,
    pub ingested_at: DateTime<Utc>,
}

/// New event for insertion (without auto-generated fields)
#[derive(Debug, Clone)]
pub struct NewEvent {
    pub block_number: BlockNumber,
    pub block_timestamp: DateTime<Utc>,
    pub block_hash: String,
    pub transaction_hash: String,
    pub log_index: LogIndex,
    pub event_type: EventType,
    pub event_data: serde_json::Value,
    pub is_canonical: bool,
}

/// Projection checkpoint
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ProjectionCheckpoint {
    pub projection_name: String,
    pub last_sequence_number: SequenceNumber,
    pub last_block_number: BlockNumber,
    pub last_updated_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
}

/// Ingestion state
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct IngestionState {
    pub id: i32,
    pub last_indexed_block: BlockNumber,
    pub last_block_hash: Option<String>,
    pub mode: String,
    pub current_leader_id: Option<String>,
    pub leader_last_heartbeat: Option<DateTime<Utc>>,
    pub started_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Vault (metadata projection)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Vault {
    pub term_id: String,
    pub vault_type: String,
    pub created_at_block: BlockNumber,
    pub created_at_timestamp: Option<DateTime<Utc>>,
    pub subject_id: Option<String>,
    pub predicate_id: Option<String>,
    pub object_id: Option<String>,
    pub total_assets: Option<BigDecimal>,
    pub total_shares: Option<BigDecimal>,
    pub share_price: Option<BigDecimal>,
    pub last_price_update_block: Option<BlockNumber>,
    pub metadata: Option<serde_json::Value>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Position (user state projection)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct Position {
    pub user_id: String,
    pub term_id: String,
    pub curve_id: BigDecimal,
    pub shares: BigDecimal,
    pub last_updated_block: BlockNumber,
    pub last_updated_timestamp: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// Share price history entry (market data projection)
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct SharePriceHistory {
    pub time: DateTime<Utc>,
    pub term_id: String,
    pub curve_id: BigDecimal,
    pub share_price: BigDecimal,
    pub total_assets: BigDecimal,
    pub total_shares: BigDecimal,
    pub vault_type: String,
    pub block_number: BlockNumber,
}

/// Reorg event
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
pub struct ReorgEvent {
    pub id: i64,
    pub reorg_depth: i64,
    pub old_head_block: BlockNumber,
    pub new_head_block: BlockNumber,
    pub old_head_hash: Option<String>,
    pub new_head_hash: Option<String>,
    pub events_invalidated: Option<i32>,
    pub detected_at: DateTime<Utc>,
    pub resolved_at: Option<DateTime<Utc>>,
}

// ---------------------------------------------------------------------------
// Read-side typed event records (one per event type)
// ---------------------------------------------------------------------------
//
// These structs are the deserialisation targets for `event_data` JSONB.
// The envelope fields (block_number, block_hash, etc.) live in the parent
// `StoredEvent` / `EventMetadata` — they are NOT part of the JSON payload
// and therefore NOT fields on these structs.
//
// `sqlx::FromRow` is intentionally absent: these records are never fetched
// directly via `query_as` — only `StoredEvent` is. Removing it prevents the
// derive macro from demanding envelope columns that are not in the JSON.

/// Parsed payload from an `AtomCreated` event's `event_data` column.
///
/// `term_id` is the original `0x`-prefixed hex string (e.g.
/// `"0xa0e157e5fa1b17d3b54ec73622ce3317296920a06502661617613d59f58e947e"`).
/// This matches the `term_id_hex` column in the typed storage tables and the
/// hex format expected by all downstream dimension tables and projection logic.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AtomCreatedRecord {
    pub creator: String,
    /// Keccak256 hash of the term, stored as a `0x`-prefixed hex string.
    pub term_id: String,
    pub atom_data: String,
    pub atom_wallet: String,
}

/// Parsed payload from a `TripleCreated` event's `event_data` column.
///
/// All ID fields (`term_id`, `subject_id`, `predicate_id`, `object_id`) are
/// `0x`-prefixed hex strings matching the `*_hex` columns in the typed tables.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TripleCreatedRecord {
    pub creator: String,
    /// Keccak256 hash of the triple term, stored as a `0x`-prefixed hex string.
    pub term_id: String,
    /// Keccak256 hash of the subject atom, stored as a `0x`-prefixed hex string.
    pub subject_id: String,
    /// Keccak256 hash of the predicate atom, stored as a `0x`-prefixed hex string.
    pub predicate_id: String,
    /// Keccak256 hash of the object atom, stored as a `0x`-prefixed hex string.
    pub object_id: String,
}

/// Parsed payload from a `Deposited` event's `event_data` column.
///
/// `term_id` is a `0x`-prefixed hex string. Numeric vault fields (`curve_id`,
/// `assets`, `shares`, etc.) remain `BigDecimal` — they are genuine uint256 values.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DepositedRecord {
    pub sender: String,
    pub receiver: String,
    /// Keccak256 hash of the vault term, stored as a `0x`-prefixed hex string.
    pub term_id: String,
    pub curve_id: BigDecimal,
    pub assets: BigDecimal,
    pub assets_after_fees: BigDecimal,
    pub shares: BigDecimal,
    pub total_shares: BigDecimal,
    pub vault_type: i32,
}

/// Parsed payload from a `Redeemed` event's `event_data` column.
///
/// `term_id` is a `0x`-prefixed hex string. Numeric fields remain `BigDecimal`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RedeemedRecord {
    pub sender: String,
    pub receiver: String,
    /// Keccak256 hash of the vault term, stored as a `0x`-prefixed hex string.
    pub term_id: String,
    pub curve_id: BigDecimal,
    pub shares: BigDecimal,
    pub total_shares: BigDecimal,
    pub assets: BigDecimal,
    pub fees: BigDecimal,
    pub vault_type: i32,
}

/// Parsed payload from a `SharePriceChanged` event's `event_data` column.
///
/// `term_id` is a `0x`-prefixed hex string. Numeric price fields remain `BigDecimal`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SharePriceChangedRecord {
    /// Keccak256 hash of the vault term, stored as a `0x`-prefixed hex string.
    pub term_id: String,
    pub curve_id: BigDecimal,
    pub share_price: BigDecimal,
    pub total_assets: BigDecimal,
    pub total_shares: BigDecimal,
    pub vault_type: i32,
}

/// Parsed payload from a `ProtocolFeeAccrued` event's `event_data` column.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProtocolFeeAccruedRecord {
    pub epoch: BigDecimal,
    pub sender: String,
    pub amount: BigDecimal,
}
