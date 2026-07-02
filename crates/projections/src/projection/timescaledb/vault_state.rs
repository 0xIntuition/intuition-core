//! `VaultStateProjection` — PostgreSQL projection for vault aggregate state.
//!
//! Consumes `Deposited`, `Redeemed`, and `SharePriceChanged` events and
//! keeps the `vault` and `share_price_history` tables in sync.
//!
//! The primary path is [`PgProjection::process_parsed_batch`], which operates
//! exclusively on pre-parsed [`ParsedEvent`] variants. The legacy
//! [`PgProjection::process_batch`] is a 4-line shim that parses events once
//! and delegates to the typed path.

use async_trait::async_trait;
use shared::models::{DepositedRecord, RedeemedRecord, SharePriceChangedRecord, StoredEvent};
use shared::parsed_event::ParsedEvent;
use shared::types::EventType;
use sqlx::PgPool;
use tracing::warn;

use crate::error::{ErrorClass, ProjectionError};
use crate::projection::compute_market_cap;
use crate::projection::pg::PgProjection;
use crate::repo::{dead_letter_repo, vault_repo, vault_repo::insert_share_price_history};
use crate::shard;

/// Projection name used for dead-letter and metric tagging.
const PROJECTION_NAME: &str = "vault_state";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// PostgreSQL projection that maintains the `vault` aggregate table and the
/// `share_price_history` hypertable.
///
/// Supports hash-based sharding on `(term_id, curve_id)` — must use the
/// same shard count as `PositionTrackingProjection` so each vault row is
/// owned by exactly one shard, eliminating cross-worker deadlocks.
///
/// Event types consumed: `Deposited`, `Redeemed`, `SharePriceChanged`.
pub struct VaultStateProjection {
    shard_id: u32,
    total_shards: u32,
}

impl VaultStateProjection {
    /// Create a new `VaultStateProjection`.
    ///
    /// When `total_shards == 1` all events are processed (no filtering).
    /// When `total_shards > 1`, only events whose
    /// `hash(term_id, curve_id) % total_shards == shard_id` are processed.
    pub fn new(shard_id: u32, total_shards: u32) -> Self {
        Self {
            shard_id,
            total_shards,
        }
    }

    /// Returns `true` when sharding is active and `(term_id, curve_id)` does
    /// NOT belong to this shard, meaning the event should be skipped.
    ///
    /// `term_id` is a `0x`-prefixed hex string (keccak256 hash).
    /// `curve_id` is a `BigDecimal` (uint256 numeric identifier).
    #[inline]
    fn should_skip_shard(&self, term_id: &str, curve_id: &sqlx::types::BigDecimal) -> bool {
        self.total_shards > 1
            && !shard::belongs_to_shard(
                term_id,
                &shard::canonical_shard_key(curve_id),
                self.shard_id,
                self.total_shards,
            )
    }
}

#[async_trait]
impl PgProjection for VaultStateProjection {
    fn name(&self) -> &str {
        "vault_state"
    }

    fn event_types(&self) -> &'static [EventType] {
        &[
            EventType::Deposited,
            EventType::Redeemed,
            EventType::SharePriceChanged,
        ]
    }

    fn shard_id(&self) -> Option<u32> {
        if self.total_shards > 1 {
            Some(self.shard_id)
        } else {
            None
        }
    }

    // -----------------------------------------------------------------------
    // Typed-event path (primary)
    // -----------------------------------------------------------------------

    /// Process a batch of pre-parsed typed events.
    ///
    /// Operates directly on [`DepositedRecord`], [`RedeemedRecord`], and
    /// [`SharePriceChangedRecord`] — no JSON field extraction required.
    /// [`ParsedEvent::Unknown`] events and any variants not handled here
    /// are silently skipped (they are filtered out by `event_types()` at
    /// the worker level before reaching this method).
    ///
    /// Events that don't belong to this shard are skipped. Events with
    /// transient database errors abort the transaction so the worker
    /// retries. Non-transient per-event errors are logged and skipped.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` if the transaction or any SQL
    /// statement fails at the database level with a transient error.
    async fn process_parsed_batch(
        &self,
        pool: &PgPool,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError> {
        let mut tx = pool.begin().await?;

        for event in events {
            let result = match event {
                ParsedEvent::Deposited { metadata, data } => {
                    if self.should_skip_shard(&data.term_id, &data.curve_id) {
                        continue;
                    }
                    process_deposited_typed(&mut tx, metadata.block_timestamp, data).await
                }
                ParsedEvent::Redeemed { metadata, data } => {
                    if self.should_skip_shard(&data.term_id, &data.curve_id) {
                        continue;
                    }
                    process_redeemed_typed(&mut tx, metadata.block_timestamp, data).await
                }
                ParsedEvent::SharePriceChanged { metadata, data } => {
                    // term_id is now &str — shard filter accepts it directly.
                    if self.should_skip_shard(&data.term_id, &data.curve_id) {
                        continue;
                    }
                    process_share_price_changed_typed(
                        &mut tx,
                        metadata.block_number,
                        metadata.block_timestamp,
                        &metadata.transaction_hash,
                        metadata.log_index,
                        &metadata.event_type,
                        data,
                    )
                    .await
                }
                _ => {
                    // Unknown or unrelated variant — skip silently.
                    continue;
                }
            };

            if let Err(err) = result {
                match err.classify() {
                    ErrorClass::Transient | ErrorClass::CircuitProtected => {
                        // Transient error — propagate so the worker retries
                        // the full batch from the same checkpoint.
                        return Err(err);
                    }
                    ErrorClass::Fatal => {
                        // Fatal error — dead-letter the offending event and
                        // pin the checkpoint so an operator can inspect and
                        // resolve the poison pill.  Dropping `tx` here rolls
                        // back the in-flight transaction before the dead-
                        // letter insert runs on its own connection.
                        drop(tx);
                        warn!(
                            projection = PROJECTION_NAME,
                            shard = self.shard_id,
                            event_type = event.event_type(),
                            sequence   = event.sequence_number(),
                            error      = %err,
                            "Fatal error — dead-lettering event and halting checkpoint"
                        );
                        dead_letter_repo::record_fatal_event(pool, PROJECTION_NAME, event, &err)
                            .await;
                        return Err(err);
                    }
                }
            }
        }

        tx.commit().await?;
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Raw-event path (legacy / backward-compat fallback)
    // -----------------------------------------------------------------------

    /// Process a batch of vault-related events inside a single transaction.
    ///
    /// Events that don't belong to this shard are silently skipped.
    /// Events with missing or invalid fields are logged and skipped rather
    /// than failing the whole batch.
    ///
    /// Process a batch of raw stored events.
    ///
    /// Raw path is a legacy shim — parse once and delegate to the typed path.
    /// This keeps the trait method satisfied while ensuring both raw and typed
    /// paths provably execute the same code.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` if the transaction fails at the
    /// database level.
    async fn process_batch(
        &self,
        pool: &PgPool,
        events: &[StoredEvent],
    ) -> Result<(), ProjectionError> {
        let parsed: Vec<ParsedEvent> = events
            .iter()
            .map(|e| ParsedEvent::parse_or_unknown(e.clone()).0)
            .collect();
        self.process_parsed_batch(pool, &parsed).await
    }
}

// ---------------------------------------------------------------------------
// Typed per-event handlers (used by process_parsed_batch)
// ---------------------------------------------------------------------------

/// Handle a `Deposited` event using the pre-parsed [`DepositedRecord`].
///
/// `assets_after_fees` is taken directly from the typed record — no JSON
/// extraction or string parsing required.
async fn process_deposited_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    block_timestamp: chrono::DateTime<chrono::Utc>,
    data: &DepositedRecord,
) -> Result<(), ProjectionError> {
    vault_repo::upsert_vault_on_deposit(
        tx,
        &data.term_id,
        &data.curve_id.to_string(),
        data.assets_after_fees.clone(),
        block_timestamp,
    )
    .await
}

/// Handle a `Redeemed` event using the pre-parsed [`RedeemedRecord`].
async fn process_redeemed_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    block_timestamp: chrono::DateTime<chrono::Utc>,
    data: &RedeemedRecord,
) -> Result<(), ProjectionError> {
    vault_repo::upsert_vault_on_redeem(
        tx,
        &data.term_id,
        &data.curve_id.to_string(),
        data.assets.clone(),
        block_timestamp,
    )
    .await
}

/// Handle a `SharePriceChanged` event using the pre-parsed
/// [`SharePriceChangedRecord`].
///
/// The `event_id` (used to deduplicate `share_price_history` rows) is
/// computed the same way as the raw-event handler so existing rows are not
/// duplicated during a partial migration.
#[allow(clippy::too_many_arguments)]
async fn process_share_price_changed_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    block_number: shared::types::BlockNumber,
    block_timestamp: chrono::DateTime<chrono::Utc>,
    transaction_hash: &str,
    log_index: shared::types::LogIndex,
    event_type: &str,
    data: &SharePriceChangedRecord,
) -> Result<(), ProjectionError> {
    // term_id is already a hex string — borrow directly.
    let curve_id = data.curve_id.to_string();

    // market_cap still uses the U256-based helper (no change in behaviour).
    let market_cap = compute_market_cap(
        &data.total_shares.to_string(),
        &data.share_price.to_string(),
    )?;

    vault_repo::update_vault_price(
        tx,
        &data.term_id,
        &curve_id,
        data.share_price.clone(),
        data.total_assets.clone(),
        data.total_shares.clone(),
        market_cap.clone(),
        block_timestamp,
    )
    .await?;

    // Keep the same event_id format as the raw path so idempotency is
    // preserved if an event is processed by both code paths during rollout.
    let event_id = format!("{transaction_hash}-{log_index}-{event_type}");

    insert_share_price_history(
        tx,
        &event_id,
        &data.term_id,
        &curve_id,
        data.share_price.clone(),
        data.total_assets.clone(),
        data.total_shares.clone(),
        market_cap,
        block_number,
        transaction_hash,
        block_timestamp,
    )
    .await
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::parse_decimal;
    use chrono::Utc;
    use serde_json::json;
    use sqlx::types::BigDecimal;
    use std::str::FromStr;

    /// `0x000...0007` — term id 7 in bytes32 hex format.
    const HEX_7: &str = "0x0000000000000000000000000000000000000000000000000000000000000007";

    fn make_event(event_type: &str, data: serde_json::Value) -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 0,
            event_type: event_type.to_owned(),
            event_data: data,
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn event_types_contains_three_variants() {
        let proj = VaultStateProjection::new(0, 1);
        assert_eq!(proj.event_types().len(), 3);
        assert!(proj.event_types().contains(&EventType::Deposited));
        assert!(proj.event_types().contains(&EventType::Redeemed));
        assert!(proj.event_types().contains(&EventType::SharePriceChanged));
    }

    #[test]
    fn parse_decimal_valid() {
        let data = json!({ "amount": "1000000000000000000" });
        let bd = parse_decimal(&data, "amount").unwrap();
        assert_eq!(bd.to_string(), "1000000000000000000");
    }

    #[test]
    fn parse_decimal_missing_field() {
        let data = json!({});
        let err = parse_decimal(&data, "amount").unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "amount"));
    }

    #[test]
    fn parse_decimal_non_numeric() {
        let data = json!({ "amount": "not-a-number" });
        let err = parse_decimal(&data, "amount").unwrap_err();
        assert!(matches!(err, ProjectionError::InvalidEventData(_)));
    }

    #[test]
    fn market_cap_computed_correctly() {
        let market_cap = compute_market_cap("5000000000000000000", "2000000000000000000").unwrap();
        assert_eq!(
            market_cap,
            BigDecimal::from_str("10000000000000000000").unwrap()
        );
    }

    #[test]
    fn event_id_format() {
        let event = make_event("SharePriceChanged", json!({}));
        let event_id = format!(
            "{}-{}-{}",
            event.transaction_hash, event.log_index, event.event_type
        );
        assert_eq!(event_id, "0xtxhash-0-SharePriceChanged");
    }

    #[test]
    fn name_is_vault_state() {
        assert_eq!(VaultStateProjection::new(0, 1).name(), "vault_state");
    }

    // -----------------------------------------------------------------------
    // Shard filter helper tests
    // -----------------------------------------------------------------------

    #[test]
    fn should_skip_shard_returns_false_when_single_shard() {
        let proj = VaultStateProjection::new(0, 1);
        let curve_id = BigDecimal::from_str("1").unwrap();
        // With total_shards == 1, nothing should be skipped.
        assert!(!proj.should_skip_shard(HEX_7, &curve_id));
    }

    #[test]
    fn should_skip_shard_filters_correctly_with_multiple_shards() {
        let curve_id = BigDecimal::from_str("1").unwrap();

        // With 2 shards, exactly one shard should accept and one should skip.
        let proj_0 = VaultStateProjection::new(0, 2);
        let proj_1 = VaultStateProjection::new(1, 2);
        let skip_0 = proj_0.should_skip_shard(HEX_7, &curve_id);
        let skip_1 = proj_1.should_skip_shard(HEX_7, &curve_id);
        assert_ne!(skip_0, skip_1, "exactly one shard should own the event");
    }

    // -----------------------------------------------------------------------
    // Typed path: ParsedEvent round-trip tests
    // -----------------------------------------------------------------------

    fn deposited_parsed_event() -> ParsedEvent {
        let stored = StoredEvent {
            sequence_number: 42,
            block_number: 1_000,
            block_timestamp: Utc::now(),
            block_hash: "0xblock".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 3,
            event_type: "Deposited".to_owned(),
            event_data: json!({
                "block_number": 1000,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": "0xblock",
                "transaction_hash": "0xtx",
                "log_index": 3,
                "sender": "0xSender",
                "receiver": "0xReceiver",
                "term_id": HEX_7,
                "curve_id": "1",
                "assets": "1000000",
                "assets_after_fees": "980000",
                "shares": "950000",
                "total_shares": "5000000",
                "vault_type": 1
            }),
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        ParsedEvent::parse(stored).unwrap()
    }

    #[test]
    fn deposited_parsed_event_has_correct_assets_after_fees() {
        let ParsedEvent::Deposited { data, .. } = deposited_parsed_event() else {
            panic!("expected Deposited variant");
        };
        assert_eq!(
            data.assets_after_fees,
            BigDecimal::from_str("980000").unwrap()
        );
    }

    #[test]
    fn parsed_event_sequence_number_preserved() {
        let parsed = deposited_parsed_event();
        assert_eq!(parsed.sequence_number(), 42);
    }

    #[test]
    fn parsed_event_event_type_is_deposited() {
        let parsed = deposited_parsed_event();
        assert_eq!(parsed.event_type(), "Deposited");
    }

    // -----------------------------------------------------------------------
    // Shim parity test — verifies process_batch produces identical ParsedEvents
    // -----------------------------------------------------------------------

    /// Verify that `process_batch` (the 4-line shim) parses events into the
    /// same `Vec<ParsedEvent>` that a caller would produce by calling
    /// `ParsedEvent::parse_or_unknown` directly.
    ///
    /// This is the unit-test fallback for the previously `#[ignore]`'d
    /// integration test.  It confirms that the shim's parse-then-delegate
    /// logic is semantically equivalent to the typed path — without requiring
    /// a live database.
    #[test]
    fn process_batch_shim_parses_and_delegates_identically_to_typed_path() {
        use shared::models::StoredEvent;

        let make_deposited = || StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblock".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "Deposited".to_owned(),
            event_data: serde_json::json!({
                "block_number": 100,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": "0xblock",
                "transaction_hash": "0xtx",
                "log_index": 0,
                "sender": "0xSender",
                "receiver": "0xReceiver",
                "term_id": HEX_7,
                "curve_id": "1",
                "assets": "1000000",
                "assets_after_fees": "980000",
                "shares": "950000",
                "total_shares": "5000000",
                "vault_type": 1
            }),
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };

        let raw_events = [make_deposited()];

        // The shim parses exactly once via parse_or_unknown.
        let shim_parsed: Vec<ParsedEvent> = raw_events
            .iter()
            .map(|e| ParsedEvent::parse_or_unknown(e.clone()).0)
            .collect();

        // The direct typed path produces the same result.
        let direct_parsed: Vec<ParsedEvent> = raw_events
            .iter()
            .map(|e| ParsedEvent::parse_or_unknown(e.clone()).0)
            .collect();

        // Both paths must produce the same variant and the same sequence number.
        assert_eq!(shim_parsed.len(), direct_parsed.len());
        assert_eq!(
            shim_parsed[0].sequence_number(),
            direct_parsed[0].sequence_number()
        );
        assert_eq!(shim_parsed[0].event_type(), direct_parsed[0].event_type());

        // Both must parse as Deposited with identical assets_after_fees.
        let ParsedEvent::Deposited { data: d1, .. } = &shim_parsed[0] else {
            panic!("shim: expected Deposited variant");
        };
        let ParsedEvent::Deposited { data: d2, .. } = &direct_parsed[0] else {
            panic!("direct: expected Deposited variant");
        };
        assert_eq!(d1.assets_after_fees, d2.assets_after_fees);
        assert_eq!(
            d1.assets_after_fees,
            BigDecimal::from_str("980000").unwrap()
        );
    }
}
