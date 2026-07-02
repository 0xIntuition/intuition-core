//! PostgreSQL projection that appends rows to the `signal` table.
//!
//! Each `Deposited` or `Redeemed` event produces one immutable signal row.
//! Idempotency is achieved via `ON CONFLICT DO NOTHING` keyed on a
//! deterministic `event_id` derived from the transaction hash, log index,
//! and event type.

use async_trait::async_trait;
use shared::models::{DepositedRecord, RedeemedRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;
use sqlx::PgPool;
use tracing::warn;

use crate::error::{ErrorClass, ProjectionError};
use crate::projection::pg::PgProjection;
use crate::repo::dead_letter_repo;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Projection name used for dead-letter and metric tagging.
const PROJECTION_NAME: &str = "signals_analytics";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Appends one row per `Deposited` / `Redeemed` event to the `signal` table.
///
/// Each row records: which account acted, on which (term, curve) vault, the
/// signal type (`"deposit"` or `"redemption"`), the numeric delta, and the
/// block context.  The table is append-only; existing rows are never mutated.
pub struct SignalsAnalyticsProjection;

#[async_trait]
impl PgProjection for SignalsAnalyticsProjection {
    fn name(&self) -> &str {
        "signals_analytics"
    }

    fn event_types(&self) -> &'static [EventType] {
        &[EventType::Deposited, EventType::Redeemed]
    }

    fn uses_typed_events(&self) -> bool {
        true
    }

    /// Process a batch of pre-parsed typed events, appending signal rows inside
    /// a single database transaction.
    ///
    /// Dispatches `Deposited` and `Redeemed` variants to typed helpers.
    /// `Unknown` events are warned and skipped.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` on any SQL failure.
    async fn process_parsed_batch(
        &self,
        pool: &PgPool,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError> {
        let mut tx = pool.begin().await?;

        for event in events {
            let result: Result<(), ProjectionError> = match event {
                ParsedEvent::Deposited { metadata, data } => {
                    insert_deposit_signal_typed(&mut tx, metadata, data).await
                }
                ParsedEvent::Redeemed { metadata, data } => {
                    insert_redemption_signal_typed(&mut tx, metadata, data).await
                }
                ParsedEvent::AtomCreated { .. }
                | ParsedEvent::TripleCreated { .. }
                | ParsedEvent::SharePriceChanged { .. }
                | ParsedEvent::ProtocolFeeAccrued { .. } => {
                    // Not handled by this projection; filtered by event_types().
                    continue;
                }
                ParsedEvent::Unknown(raw) => {
                    warn!(
                        projection = PROJECTION_NAME,
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
                        // Propagate — worker retries the batch from the same checkpoint.
                        return Err(err);
                    }
                    ErrorClass::Fatal => {
                        // Dead-letter the offending event before returning so the
                        // operator has a concrete row to inspect.  Drop the tx
                        // first to roll back the in-flight batch.
                        drop(tx);
                        warn!(
                            projection = PROJECTION_NAME,
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
    /// Returns `ProjectionError::Database` on any SQL failure.
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
// Typed per-event helpers (used by process_parsed_batch)
// ---------------------------------------------------------------------------

/// Insert one deposit signal row using the pre-parsed [`DepositedRecord`].
///
/// `account_id` is taken from `data.receiver` — the position holder.
/// `delta` is `data.assets_after_fees` — already a `BigDecimal`, no parsing.
async fn insert_deposit_signal_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &DepositedRecord,
) -> Result<(), ProjectionError> {
    let event_id = format!(
        "{}-{}-{}",
        metadata.transaction_hash, metadata.log_index, metadata.event_type
    );
    // term_id is already a hex string — borrow directly.
    let curve_id = data.curve_id.to_string();

    sqlx::query(
        r#"
        INSERT INTO signal
            (event_id, account_id, term_id, curve_id, signal_type, delta, block_number, ts)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(&event_id)
    .bind(&data.receiver)
    .bind(&data.term_id)
    .bind(&curve_id)
    .bind("deposit")
    .bind(&data.assets_after_fees)
    .bind(metadata.block_number)
    .bind(metadata.block_timestamp)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Insert one redemption signal row using the pre-parsed [`RedeemedRecord`].
///
/// `account_id` is taken from `data.sender` — the position holder unwinding.
/// `delta` is `data.assets` — already a `BigDecimal`, no parsing.
async fn insert_redemption_signal_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &RedeemedRecord,
) -> Result<(), ProjectionError> {
    let event_id = format!(
        "{}-{}-{}",
        metadata.transaction_hash, metadata.log_index, metadata.event_type
    );
    // term_id is already a hex string — borrow directly.
    let curve_id = data.curve_id.to_string();

    sqlx::query(
        r#"
        INSERT INTO signal
            (event_id, account_id, term_id, curve_id, signal_type, delta, block_number, ts)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT DO NOTHING
        "#,
    )
    .bind(&event_id)
    .bind(&data.sender)
    .bind(&data.term_id)
    .bind(&curve_id)
    .bind("redemption")
    .bind(&data.assets)
    .bind(metadata.block_number)
    .bind(metadata.block_timestamp)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::get_str;
    use chrono::Utc;
    use serde_json::json;
    use sqlx::types::BigDecimal;
    use std::str::FromStr;

    /// `0x000...0007` — term id 7 in bytes32 hex format.
    const HEX_7: &str = "0x0000000000000000000000000000000000000000000000000000000000000007";

    fn make_deposited() -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xhash".to_owned(),
            transaction_hash: "0xtx1".to_owned(),
            log_index: 2,
            event_type: "Deposited".to_owned(),
            event_data: json!({
                "sender":           "0xSender",
                "receiver":         "0xReceiver",
                "term_id":          HEX_7,
                "curve_id":         "1",
                "assets":           "1000000",
                "assets_after_fees":"980000",
                "shares":           "950000"
            }),
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    fn make_redeemed() -> StoredEvent {
        StoredEvent {
            sequence_number: 2,
            block_number: 101,
            block_timestamp: Utc::now(),
            block_hash: "0xhash2".to_owned(),
            transaction_hash: "0xtx2".to_owned(),
            log_index: 0,
            event_type: "Redeemed".to_owned(),
            event_data: json!({
                "sender":   "0xSender",
                "term_id":  HEX_7,
                "curve_id": "1",
                "shares":   "950000",
                "assets":   "980000"
            }),
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn name_is_correct() {
        assert_eq!(SignalsAnalyticsProjection.name(), "signals_analytics");
    }

    #[test]
    fn event_types_are_deposited_and_redeemed() {
        assert_eq!(
            SignalsAnalyticsProjection.event_types(),
            &[EventType::Deposited, EventType::Redeemed]
        );
    }

    /// Verify the deterministic event_id format used for idempotent inserts.
    #[test]
    fn event_id_format_for_deposited() {
        let event = make_deposited();
        let event_id = format!(
            "{}-{}-{}",
            event.transaction_hash, event.log_index, event.event_type
        );
        assert_eq!(event_id, "0xtx1-2-Deposited");
    }

    /// Verify the deterministic event_id format for redemptions.
    #[test]
    fn event_id_format_for_redeemed() {
        let event = make_redeemed();
        let event_id = format!(
            "{}-{}-{}",
            event.transaction_hash, event.log_index, event.event_type
        );
        assert_eq!(event_id, "0xtx2-0-Redeemed");
    }

    /// deposit signal uses receiver as account_id and assets_after_fees as delta.
    #[test]
    fn deposit_account_and_delta() {
        let event = make_deposited();
        let data = &event.event_data;
        let account = get_str(data, "receiver").unwrap();
        let delta_raw = get_str(data, "assets_after_fees").unwrap();
        assert_eq!(account, "0xReceiver");
        assert_eq!(
            BigDecimal::from_str(delta_raw).unwrap(),
            BigDecimal::from_str("980000").unwrap()
        );
    }

    /// redemption signal uses sender as account_id and assets as delta.
    #[test]
    fn redemption_account_and_delta() {
        let event = make_redeemed();
        let data = &event.event_data;
        let account = get_str(data, "sender").unwrap();
        let delta_raw = get_str(data, "assets").unwrap();
        assert_eq!(account, "0xSender");
        assert_eq!(
            BigDecimal::from_str(delta_raw).unwrap(),
            BigDecimal::from_str("980000").unwrap()
        );
    }

    // -----------------------------------------------------------------------
    // Typed-event path tests
    // -----------------------------------------------------------------------

    #[test]
    fn uses_typed_events_returns_true() {
        assert!(SignalsAnalyticsProjection.uses_typed_events());
    }

    #[test]
    fn process_parsed_batch_deposit_dispatch() {
        use serde_json::json;
        use shared::models::StoredEvent;

        let stored = StoredEvent {
            sequence_number: 10,
            block_number: 200,
            block_timestamp: Utc::now(),
            block_hash: "0xbh".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 1,
            event_type: "Deposited".to_owned(),
            event_data: json!({
                "block_number": 200,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": "0xbh",
                "transaction_hash": "0xtx",
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
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };

        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        // Verify it's a Deposited variant with the correct account and delta.
        let ParsedEvent::Deposited { data, .. } = &parsed else {
            panic!("expected Deposited variant");
        };
        assert_eq!(data.receiver, "0xReceiver");
        assert_eq!(
            data.assets_after_fees,
            BigDecimal::from_str("980000").unwrap()
        );
    }

    #[test]
    fn process_parsed_batch_redeem_dispatch() {
        use serde_json::json;
        use shared::models::StoredEvent;

        let stored = StoredEvent {
            sequence_number: 11,
            block_number: 201,
            block_timestamp: Utc::now(),
            block_hash: "0xbh2".to_owned(),
            transaction_hash: "0xtx2".to_owned(),
            log_index: 0,
            event_type: "Redeemed".to_owned(),
            event_data: json!({
                "block_number": 201,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": "0xbh2",
                "transaction_hash": "0xtx2",
                "log_index": 0,
                "sender": "0xSender",
                "receiver": "0xReceiver",
                "term_id": HEX_7,
                "curve_id": "1",
                "shares": "950000",
                "total_shares": "5000000",
                "assets": "980000",
                "fees": "20000",
                "vault_type": 1
            }),
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };

        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::Redeemed { data, .. } = &parsed else {
            panic!("expected Redeemed variant");
        };
        assert_eq!(data.sender, "0xSender");
        assert_eq!(data.assets, BigDecimal::from_str("980000").unwrap());
    }
}
