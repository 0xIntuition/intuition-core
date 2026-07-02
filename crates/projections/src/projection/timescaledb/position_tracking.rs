//! `PositionTrackingProjection` — PostgreSQL projection for per-account
//! position state.
//!
//! Consumes `Deposited` and `Redeemed` events and keeps the `position` and
//! `position_change` tables in sync, also updating `vault.holder_count` when
//! positions are opened or fully closed.
//!
//! This projection supports **hash-based sharding** on `(term_id, curve_id)`.
//! When `total_shards > 1`, each shard worker only processes events whose
//! vault key hashes to its `shard_id`, eliminating row-level contention with
//! the `vault_state` projection on the `vault` table.

use async_trait::async_trait;
use shared::models::{DepositedRecord, RedeemedRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;
use sqlx::types::BigDecimal;
use sqlx::PgPool;
use tracing::warn;

use crate::error::{ErrorClass, ProjectionError};
use crate::projection::pg::PgProjection;
use crate::repo::{dead_letter_repo, position_repo};
use crate::shard;

/// Projection name used for dead-letter and metric tagging.
const PROJECTION_NAME: &str = "position_tracking";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// PostgreSQL projection that maintains per-account `position` rows and the
/// `position_change` hypertable, and keeps `vault.holder_count` consistent.
///
/// Event types consumed: `Deposited`, `Redeemed`.
pub struct PositionTrackingProjection {
    shard_id: u32,
    total_shards: u32,
}

impl PositionTrackingProjection {
    /// Create a new projection instance.
    ///
    /// When `total_shards == 1` the projection processes all events (no
    /// filtering). When `total_shards > 1`, only events whose
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
impl PgProjection for PositionTrackingProjection {
    fn name(&self) -> &str {
        // Each shard gets a unique checkpoint key via the coordinator which
        // appends `_s{N}` to the name. The base name stays constant so that
        // metrics labels are stable and the event_types() filter works.
        "position_tracking"
    }

    fn event_types(&self) -> &'static [EventType] {
        &[EventType::Deposited, EventType::Redeemed]
    }

    fn shard_id(&self) -> Option<u32> {
        if self.total_shards > 1 {
            Some(self.shard_id)
        } else {
            None
        }
    }

    fn uses_typed_events(&self) -> bool {
        true
    }

    /// Process a batch of pre-parsed typed events inside a single transaction.
    ///
    /// Events whose `(term_id, curve_id)` does not belong to this shard are
    /// silently skipped. Transient DB errors abort immediately; `InvalidEventData`
    /// errors are warned and the event is skipped.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` if the transaction fails at the DB level.
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
                    process_deposited_typed(&mut tx, metadata, data).await
                }
                ParsedEvent::Redeemed { metadata, data } => {
                    if self.should_skip_shard(&data.term_id, &data.curve_id) {
                        continue;
                    }
                    process_redeemed_typed(&mut tx, metadata, data).await
                }
                ParsedEvent::AtomCreated { .. }
                | ParsedEvent::TripleCreated { .. }
                | ParsedEvent::SharePriceChanged { .. }
                | ParsedEvent::ProtocolFeeAccrued { .. } => {
                    // Filtered by event_types().
                    continue;
                }
                ParsedEvent::Unknown(raw) => {
                    warn!(
                        projection = "position_tracking",
                        shard = self.shard_id,
                        seq = raw.sequence_number,
                        event_type = %raw.event_type,
                        "Unknown event type; skipping"
                    );
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
                            seq = event.sequence_number(),
                            event_type = event.event_type(),
                            error = %err,
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

    /// Process a batch of raw stored events.
    ///
    /// Raw path is a legacy shim — parse once and delegate to the typed path.
    /// This keeps the trait method satisfied while ensuring both raw and typed
    /// paths provably execute the same code.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` if the transaction fails at the DB level.
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
/// Upserts the position and appends a `position_change` history row.
/// All amounts are already `BigDecimal` — no JSON extraction needed.
async fn process_deposited_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &DepositedRecord,
) -> Result<(), ProjectionError> {
    // term_id is already a hex string — borrow directly.
    let curve_id = data.curve_id.to_string();
    let shares = data.shares.clone();
    let assets_after_fees = data.assets_after_fees.clone();

    let _is_new_position = position_repo::upsert_position_on_deposit(
        tx,
        &data.receiver,
        &data.term_id,
        &curve_id,
        shares.clone(),
        assets_after_fees.clone(),
        metadata.block_timestamp,
    )
    .await?;

    // execution_price = assets_after_fees / shares (or 0 when shares == 0).
    let execution_price = if shares > 0 {
        &assets_after_fees / &shares
    } else {
        BigDecimal::from(0)
    };

    let event_id = format!(
        "{}-{}-{}",
        metadata.transaction_hash, metadata.log_index, metadata.event_type
    );

    position_repo::insert_position_change(
        tx,
        &event_id,
        &data.receiver,
        &data.term_id,
        &curve_id,
        "Deposited",
        shares,
        assets_after_fees,
        BigDecimal::from(0),
        execution_price,
        metadata.block_number,
        &metadata.transaction_hash,
        metadata.block_timestamp,
    )
    .await
}

/// Handle a `Redeemed` event using the pre-parsed [`RedeemedRecord`].
///
/// Decrements the position and appends a negative `position_change` history row.
/// All amounts are already `BigDecimal` — no JSON extraction needed.
async fn process_redeemed_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &RedeemedRecord,
) -> Result<(), ProjectionError> {
    // term_id is already a hex string — borrow directly.
    let curve_id = data.curve_id.to_string();
    let shares = data.shares.clone();
    let assets = data.assets.clone();

    let _is_closed = position_repo::upsert_position_on_redeem(
        tx,
        &data.receiver,
        &data.term_id,
        &curve_id,
        shares.clone(),
        assets.clone(),
        metadata.block_timestamp,
    )
    .await?;

    // execution_price = assets / shares (or 0 when shares == 0).
    let execution_price = if shares > 0 {
        &assets / &shares
    } else {
        BigDecimal::from(0)
    };

    // shares_delta is negative on redemption.
    let shares_delta = -shares;

    let event_id = format!(
        "{}-{}-{}",
        metadata.transaction_hash, metadata.log_index, metadata.event_type
    );

    position_repo::insert_position_change(
        tx,
        &event_id,
        &data.receiver,
        &data.term_id,
        &curve_id,
        "Redeemed",
        shares_delta,
        BigDecimal::from(0),
        assets,
        execution_price,
        metadata.block_number,
        &metadata.transaction_hash,
        metadata.block_timestamp,
    )
    .await
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::parse_decimal;
    use chrono::Utc;
    use serde_json::json;
    use shared::parsed_event::ParsedEvent;
    use std::str::FromStr;

    /// `0x000...0007` — term id 7 in bytes32 hex format.
    const HEX_7: &str = "0x0000000000000000000000000000000000000000000000000000000000000007";

    fn make_event(event_type: &str, data: serde_json::Value) -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 200,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 1,
            event_type: event_type.to_owned(),
            event_data: data,
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn event_types_contains_two_variants() {
        let proj = PositionTrackingProjection::new(0, 1);
        assert_eq!(proj.event_types().len(), 2);
        assert!(proj.event_types().contains(&EventType::Deposited));
        assert!(proj.event_types().contains(&EventType::Redeemed));
    }

    #[test]
    fn name_is_position_tracking() {
        assert_eq!(
            PositionTrackingProjection::new(0, 1).name(),
            "position_tracking"
        );
    }

    #[test]
    fn shard_id_none_when_single_shard() {
        let proj = PositionTrackingProjection::new(0, 1);
        assert_eq!(proj.shard_id(), None);
    }

    #[test]
    fn shard_id_some_when_multi_shard() {
        let proj = PositionTrackingProjection::new(2, 4);
        assert_eq!(proj.shard_id(), Some(2));
    }

    #[test]
    fn parse_decimal_valid() {
        let data = json!({ "shares": "500000" });
        let bd = parse_decimal(&data, "shares").unwrap();
        assert_eq!(bd.to_string(), "500000");
    }

    #[test]
    fn parse_decimal_missing_field() {
        let data = json!({});
        let err = parse_decimal(&data, "shares").unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "shares"));
    }

    #[test]
    fn execution_price_zero_when_shares_zero() {
        let shares = BigDecimal::from(0);
        let price = if shares > 0 {
            BigDecimal::from_str("1000000").unwrap() / &shares
        } else {
            BigDecimal::from(0)
        };
        assert_eq!(price, BigDecimal::from(0));
    }

    #[test]
    fn shares_delta_negative_on_redeem() {
        let shares = BigDecimal::from_str("100000").unwrap();
        let shares_delta = -shares;
        assert!(shares_delta < 0);
    }

    #[test]
    fn event_id_format_deposit() {
        let event = make_event("Deposited", json!({}));
        let event_id = format!(
            "{}-{}-{}",
            event.transaction_hash, event.log_index, event.event_type
        );
        assert_eq!(event_id, "0xtxhash-1-Deposited");
    }

    #[test]
    fn event_id_format_redeem() {
        let event = make_event("Redeemed", json!({}));
        let event_id = format!(
            "{}-{}-{}",
            event.transaction_hash, event.log_index, event.event_type
        );
        assert_eq!(event_id, "0xtxhash-1-Redeemed");
    }

    // -----------------------------------------------------------------------
    // Typed-event path tests
    // -----------------------------------------------------------------------

    #[test]
    fn uses_typed_events_returns_true() {
        assert!(PositionTrackingProjection::new(0, 1).uses_typed_events());
    }

    #[test]
    fn should_skip_shard_false_for_single_shard() {
        let proj = PositionTrackingProjection::new(0, 1);
        let curve_id = BigDecimal::from_str("1").unwrap();
        assert!(!proj.should_skip_shard(HEX_7, &curve_id));
    }

    #[test]
    fn should_skip_shard_exactly_one_owner_with_two_shards() {
        let curve_id = BigDecimal::from_str("1").unwrap();
        let proj0 = PositionTrackingProjection::new(0, 2);
        let proj1 = PositionTrackingProjection::new(1, 2);
        let skip0 = proj0.should_skip_shard(HEX_7, &curve_id);
        let skip1 = proj1.should_skip_shard(HEX_7, &curve_id);
        assert_ne!(skip0, skip1, "exactly one shard must own the event");
    }

    #[test]
    fn typed_deposited_fields_parsed() {
        let stored = make_event(
            "Deposited",
            json!({
                "block_number": 200,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": "0xblockhash",
                "transaction_hash": "0xtxhash",
                "log_index": 1,
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
        );
        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::Deposited { data, .. } = &parsed else {
            panic!("expected Deposited");
        };
        assert_eq!(data.receiver, "0xReceiver");
        assert_eq!(data.shares, BigDecimal::from_str("950000").unwrap());
        assert_eq!(
            data.assets_after_fees,
            BigDecimal::from_str("980000").unwrap()
        );
    }
}
