//! PostgreSQL event-log projection.
//!
//! Writes a canonical record for every event into `event`, and materialises
//! fact tables for the three financial event types:
//! - `deposit_fact`  — one row per `Deposited` event
//! - `redemption_fact` — one row per `Redeemed` event
//! - `fee_transfer_fact` — one row per `ProtocolFeeAccrued` event
//!
//! All writes are wrapped in a single transaction and every INSERT uses
//! `ON CONFLICT DO NOTHING` so the handler is fully idempotent on replay.

use async_trait::async_trait;
use shared::models::{DepositedRecord, ProtocolFeeAccruedRecord, RedeemedRecord, StoredEvent};
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
const PROJECTION_NAME: &str = "event_log";

// ---------------------------------------------------------------------------
// Projection struct
// ---------------------------------------------------------------------------

/// PgProjection that fans every event into `event` (the canonical event log)
/// and populates three financial fact tables.
pub struct EventLogProjection;

// ---------------------------------------------------------------------------
// PgProjection impl
// ---------------------------------------------------------------------------

#[async_trait]
impl PgProjection for EventLogProjection {
    fn name(&self) -> &str {
        "event_log"
    }

    fn event_types(&self) -> &'static [EventType] {
        &[
            EventType::AtomCreated,
            EventType::TripleCreated,
            EventType::Deposited,
            EventType::Redeemed,
            EventType::SharePriceChanged,
            EventType::ProtocolFeeAccrued,
        ]
    }

    fn uses_typed_events(&self) -> bool {
        true
    }

    /// Process a batch of pre-parsed typed events, writing to `event` and the
    /// three financial fact tables.
    ///
    /// Handles all six event types: `Deposited` and `Redeemed` write fact rows;
    /// `ProtocolFeeAccrued` writes a fee row; `AtomCreated`, `TripleCreated`,
    /// and `SharePriceChanged` write only the canonical event row. `Unknown`
    /// events are warned and skipped.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` on any SQL error.
    async fn process_parsed_batch(
        &self,
        pool: &PgPool,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError> {
        let mut tx = pool.begin().await?;

        for event in events {
            // Use EventMetadataRef to access envelope fields uniformly across
            // typed and Unknown variants without pattern matching.
            let meta = event.metadata();
            let event_id = format!(
                "{}-{}-{}",
                meta.transaction_hash(),
                meta.log_index(),
                meta.event_type()
            );

            // 1. Insert canonical row into `event` for every variant.
            // A failure here is a plain DB error — propagate directly so the
            // worker retries from the same checkpoint.
            sqlx::query(
                r#"
                INSERT INTO event (event_id, event_type, block_number, transaction_hash, log_index, ts)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (event_id) DO NOTHING
                "#,
            )
            .bind(&event_id)
            .bind(meta.event_type())
            .bind(meta.block_number())
            .bind(meta.transaction_hash())
            // `LogIndex` is an `i32` newtype; the widening to `i64` is
            // infallible, so prefer `i64::from` over `as i64`.
            .bind(i64::from(meta.log_index()))
            .bind(meta.block_timestamp())
            .execute(&mut *tx)
            .await?;

            // 2. Populate the appropriate fact table based on variant.
            // Capture the result so we can classify transient vs. fatal errors.
            let result: Result<(), ProjectionError> = match event {
                ParsedEvent::Deposited { metadata, data } => {
                    insert_deposit_fact_typed(&mut tx, metadata, data, &event_id).await
                }
                ParsedEvent::Redeemed { metadata, data } => {
                    insert_redemption_fact_typed(&mut tx, metadata, data, &event_id).await
                }
                ParsedEvent::ProtocolFeeAccrued { metadata, data } => {
                    insert_fee_transfer_fact_typed(&mut tx, metadata, data, &event_id).await
                }
                // AtomCreated, TripleCreated, SharePriceChanged: canonical row only.
                ParsedEvent::AtomCreated { .. }
                | ParsedEvent::TripleCreated { .. }
                | ParsedEvent::SharePriceChanged { .. } => {
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
    /// Returns `ProjectionError::Database` on any SQL error.
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
// Typed fact-table helpers (used by process_parsed_batch)
// ---------------------------------------------------------------------------

/// Insert one row into `deposit_fact` using the pre-parsed [`DepositedRecord`].
///
/// All amount fields are already `BigDecimal` — no JSON extraction required.
async fn insert_deposit_fact_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &DepositedRecord,
    event_id: &str,
) -> Result<(), ProjectionError> {
    // term_id is already a hex string — borrow directly.
    let curve_id = data.curve_id.to_string();

    sqlx::query(
        r#"
        INSERT INTO deposit_fact (
            event_id, sender_id, receiver_id, term_id, curve_id, vault_type,
            assets, assets_after_fees, shares, total_shares,
            block_number, transaction_hash, ts
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (event_id) DO NOTHING
        "#,
    )
    .bind(event_id)
    .bind(&data.sender)
    .bind(&data.receiver)
    .bind(&data.term_id)
    .bind(&curve_id)
    .bind(data.vault_type)
    .bind(&data.assets)
    .bind(&data.assets_after_fees)
    .bind(&data.shares)
    .bind(&data.total_shares)
    .bind(metadata.block_number)
    .bind(&metadata.transaction_hash)
    .bind(metadata.block_timestamp)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Insert one row into `redemption_fact` using the pre-parsed [`RedeemedRecord`].
///
/// All amount fields are already `BigDecimal` — no JSON extraction required.
async fn insert_redemption_fact_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &RedeemedRecord,
    event_id: &str,
) -> Result<(), ProjectionError> {
    // term_id is already a hex string — borrow directly.
    let curve_id = data.curve_id.to_string();

    sqlx::query(
        r#"
        INSERT INTO redemption_fact (
            event_id, sender_id, receiver_id, term_id, curve_id, vault_type,
            shares, total_shares, assets, fees,
            block_number, transaction_hash, ts
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
        ON CONFLICT (event_id) DO NOTHING
        "#,
    )
    .bind(event_id)
    .bind(&data.sender)
    .bind(&data.receiver)
    .bind(&data.term_id)
    .bind(&curve_id)
    .bind(data.vault_type)
    .bind(&data.shares)
    .bind(&data.total_shares)
    .bind(&data.assets)
    .bind(&data.fees)
    .bind(metadata.block_number)
    .bind(&metadata.transaction_hash)
    .bind(metadata.block_timestamp)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Insert one row into `fee_transfer_fact` using the pre-parsed
/// [`ProtocolFeeAccruedRecord`].
///
/// `epoch` is already a `BigDecimal`; it is converted to string for the
/// `TEXT` column (matching the raw-path behaviour of binding `get_str(epoch)`).
async fn insert_fee_transfer_fact_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &ProtocolFeeAccruedRecord,
    event_id: &str,
) -> Result<(), ProjectionError> {
    let epoch = data.epoch.to_string();

    sqlx::query(
        r#"
        INSERT INTO fee_transfer_fact (
            event_id, sender_id, amount, epoch,
            block_number, transaction_hash, ts
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (event_id) DO NOTHING
        "#,
    )
    .bind(event_id)
    .bind(&data.sender)
    .bind(&data.amount)
    .bind(&epoch)
    .bind(metadata.block_number)
    .bind(&metadata.transaction_hash)
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
    use crate::projection::parse_decimal;
    use shared::types::EventType;
    use std::str::FromStr;

    #[test]
    fn name_is_event_log() {
        assert_eq!(EventLogProjection.name(), "event_log");
    }

    #[test]
    fn event_types_contains_all_six() {
        let types = EventLogProjection.event_types();
        assert_eq!(types.len(), 6);
        assert!(types.contains(&EventType::AtomCreated));
        assert!(types.contains(&EventType::TripleCreated));
        assert!(types.contains(&EventType::Deposited));
        assert!(types.contains(&EventType::Redeemed));
        assert!(types.contains(&EventType::SharePriceChanged));
        assert!(types.contains(&EventType::ProtocolFeeAccrued));
    }

    // Note: tests previously exercised the local 3-arg `parse_decimal`.
    // The local helper was deleted; these tests now exercise the module-level
    // 2-arg `parse_decimal` (returns `Result` rather than `Option`).

    #[test]
    fn parse_decimal_returns_err_on_missing_field() {
        let data = serde_json::json!({});
        assert!(parse_decimal(&data, "amount").is_err());
    }

    #[test]
    fn parse_decimal_returns_err_on_non_numeric() {
        let data = serde_json::json!({ "amount": "not-a-number" });
        assert!(parse_decimal(&data, "amount").is_err());
    }

    #[test]
    fn parse_decimal_succeeds_on_valid_numeric_string() {
        let data = serde_json::json!({ "amount": "1000000000000000000" });
        let result = parse_decimal(&data, "amount").unwrap();
        assert_eq!(
            result,
            sqlx::types::BigDecimal::from_str("1000000000000000000").unwrap()
        );
    }

    // -----------------------------------------------------------------------
    // Typed-event path tests
    // -----------------------------------------------------------------------

    #[test]
    fn uses_typed_events_returns_true() {
        assert!(EventLogProjection.uses_typed_events());
    }

    #[test]
    fn typed_deposited_fact_event_id_format() {
        use chrono::Utc;
        use serde_json::json;
        use shared::models::StoredEvent;
        use shared::parsed_event::ParsedEvent;

        let stored = StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xbh".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 2,
            event_type: "Deposited".to_owned(),
            event_data: json!({
                "block_number": 100,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": "0xbh",
                "transaction_hash": "0xtx",
                "log_index": 2,
                "sender": "0xSender",
                "receiver": "0xReceiver",
                "term_id": "0x0000000000000000000000000000000000000000000000000000000000000007",
                "curve_id": "1",
                "assets": "1000000",
                "assets_after_fees": "980000",
                "shares": "950000",
                "total_shares": "5000000",
                "vault_type": 1
            }),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        // Verify event_id format matches legacy path.
        let expected_id = format!("{}-{}-{}", "0xtx", 2_i32, "Deposited");
        let meta = parsed.metadata();
        let actual_id = format!(
            "{}-{}-{}",
            meta.transaction_hash(),
            meta.log_index(),
            meta.event_type()
        );
        assert_eq!(actual_id, expected_id);
    }

    #[test]
    fn typed_fee_accrued_epoch_converts_to_string() {
        use chrono::Utc;
        use serde_json::json;
        use shared::models::StoredEvent;
        use shared::parsed_event::ParsedEvent;

        let stored = StoredEvent {
            sequence_number: 5,
            block_number: 200,
            block_timestamp: Utc::now(),
            block_hash: "0xbh".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "ProtocolFeeAccrued".to_owned(),
            event_data: json!({
                "block_number": 200,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": "0xbh",
                "transaction_hash": "0xtx",
                "log_index": 0,
                "epoch": "3",
                "sender": "0xFeeRecipient",
                "amount": "50000"
            }),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::ProtocolFeeAccrued { data, .. } = &parsed else {
            panic!("expected ProtocolFeeAccrued");
        };
        // epoch is BigDecimal; to_string() must produce the raw numeric value.
        assert_eq!(data.epoch.to_string(), "3");
        assert_eq!(
            data.amount,
            sqlx::types::BigDecimal::from_str("50000").unwrap()
        );
    }
}
