//! PostgreSQL projection that maintains `active_vault_position` rows.
//!
//! Tracks per-account share balances inside each vault.  On deposit the
//! position is upserted and shares/deposits are incremented.  On redemption
//! shares are decremented and the row is pruned once it reaches zero.

use std::collections::HashSet;

use async_trait::async_trait;
use shared::models::{DepositedRecord, RedeemedRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;
use sqlx::PgPool;
use tracing::warn;

use crate::error::{ErrorClass, ProjectionError};
use crate::projection::pg::PgProjection;
use crate::repo::{dead_letter_repo, vault_repo};

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/// Projection name used for dead-letter and metric tagging.
const PROJECTION_NAME: &str = "vault_holders_index";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Maintains `active_vault_position` rows from `Deposited` and `Redeemed` events.
///
/// Each row represents one account's live position inside a (term, curve) vault.
/// Rows are automatically removed when shares fall to zero or below after a
/// redemption.
pub struct VaultHoldersIndexProjection;

#[async_trait]
impl PgProjection for VaultHoldersIndexProjection {
    fn name(&self) -> &str {
        "vault_holders_index"
    }

    fn event_types(&self) -> &'static [EventType] {
        &[EventType::Deposited, EventType::Redeemed]
    }

    fn uses_typed_events(&self) -> bool {
        true
    }

    /// Process a batch of pre-parsed typed events inside a single database
    /// transaction.
    ///
    /// Dispatches `Deposited` → upsert position.
    /// Dispatches `Redeemed` → decrement shares, prune zero positions.
    /// After all events are processed, refreshes `vault.holder_count` once per
    /// unique `(term_id, curve_id)` vault touched in the batch (dedup).
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
        let mut touched_vaults: HashSet<(String, String)> = HashSet::new();

        for event in events {
            let result: Result<(), ProjectionError> = match event {
                ParsedEvent::Deposited { metadata, data } => {
                    touched_vaults.insert((data.term_id.clone(), data.curve_id.to_string()));
                    process_deposit_typed(&mut tx, metadata, data).await
                }
                ParsedEvent::Redeemed { metadata, data } => {
                    touched_vaults.insert((data.term_id.clone(), data.curve_id.to_string()));
                    process_redeem_typed(&mut tx, metadata, data).await
                }
                ParsedEvent::AtomCreated { .. }
                | ParsedEvent::TripleCreated { .. }
                | ParsedEvent::SharePriceChanged { .. }
                | ParsedEvent::ProtocolFeeAccrued { .. } => {
                    // Filtered by event_types() — not expected here.
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

        // Refresh holder_count once per unique vault touched in this batch.
        // K COUNT queries instead of N (K = distinct vaults, K <= N = event count).
        for (term_id, curve_id) in &touched_vaults {
            vault_repo::refresh_holder_count(&mut tx, term_id, curve_id).await?;
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
// Typed per-event handlers (used by process_parsed_batch)
// ---------------------------------------------------------------------------

/// Handle a `Deposited` event using the pre-parsed [`DepositedRecord`].
///
/// Upserts the position row (accumulating shares and deposits).
/// `vault.holder_count` is NOT refreshed here — caller collects touched vaults
/// and refreshes once per unique vault after the per-event loop.
async fn process_deposit_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    _metadata: &EventMetadata,
    data: &DepositedRecord,
) -> Result<(), ProjectionError> {
    let curve_id = data.curve_id.to_string();
    vault_repo::upsert_position_on_deposit(
        tx,
        &data.term_id,
        &curve_id,
        &data.receiver,
        data.shares.clone(),
        data.assets_after_fees.clone(),
    )
    .await
}

/// Handle a `Redeemed` event using the pre-parsed [`RedeemedRecord`].
///
/// Decrements shares, records total redemptions, prunes fully-exited positions.
/// `vault.holder_count` is NOT refreshed here — caller collects touched vaults
/// and refreshes once per unique vault after the per-event loop.
async fn process_redeem_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    _metadata: &EventMetadata,
    data: &RedeemedRecord,
) -> Result<(), ProjectionError> {
    let curve_id = data.curve_id.to_string();
    vault_repo::decrement_position_on_redeem(
        tx,
        &data.term_id,
        &curve_id,
        &data.sender,
        data.shares.clone(),
        data.assets.clone(),
    )
    .await?;
    vault_repo::prune_zero_position(tx, &data.term_id, &curve_id, &data.sender).await
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

    /// Extract `(term_id, curve_id, account_id, shares, total_deposits)` from a
    /// `Deposited` event.
    ///
    /// Test-only helper — documents the legacy raw-extraction contract that the
    /// typed path (`process_parsed_batch`) now replaces.
    fn extract_deposit_fields(
        event: &StoredEvent,
    ) -> Result<(String, String, String, BigDecimal, BigDecimal), ProjectionError> {
        let data = &event.event_data;
        let term_id = get_str(data, "term_id")?.to_owned();
        let curve_id = get_str(data, "curve_id")?.to_owned();
        // The depositing receiver becomes the position's account.
        let account_id = get_str(data, "receiver")?.to_owned();
        let shares_raw = get_str(data, "shares")?;
        let assets_raw = get_str(data, "assets_after_fees")?;

        let shares = BigDecimal::from_str(shares_raw).map_err(|_| {
            ProjectionError::InvalidEventData(format!("shares is not numeric: {shares_raw}"))
        })?;
        let total_deposits = BigDecimal::from_str(assets_raw).map_err(|_| {
            ProjectionError::InvalidEventData(format!(
                "assets_after_fees is not numeric: {assets_raw}"
            ))
        })?;

        Ok((term_id, curve_id, account_id, shares, total_deposits))
    }

    /// Extract `(term_id, curve_id, account_id, shares, assets)` from a
    /// `Redeemed` event.
    ///
    /// Test-only helper — documents the legacy raw-extraction contract that the
    /// typed path (`process_parsed_batch`) now replaces.
    fn extract_redeem_fields(
        event: &StoredEvent,
    ) -> Result<(String, String, String, BigDecimal, BigDecimal), ProjectionError> {
        let data = &event.event_data;
        let term_id = get_str(data, "term_id")?.to_owned();
        let curve_id = get_str(data, "curve_id")?.to_owned();
        // The redeeming sender owns the position being unwound.
        let account_id = get_str(data, "sender")?.to_owned();
        let shares_raw = get_str(data, "shares")?;
        let assets_raw = get_str(data, "assets")?;

        let shares = BigDecimal::from_str(shares_raw).map_err(|_| {
            ProjectionError::InvalidEventData(format!("shares is not numeric: {shares_raw}"))
        })?;
        let assets = BigDecimal::from_str(assets_raw).map_err(|_| {
            ProjectionError::InvalidEventData(format!("assets is not numeric: {assets_raw}"))
        })?;

        Ok((term_id, curve_id, account_id, shares, assets))
    }

    fn deposited_event() -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xhash".to_owned(),
            transaction_hash: "0xtx1".to_owned(),
            log_index: 0,
            event_type: "Deposited".to_owned(),
            event_data: json!({
                "sender":           "0xSender",
                "receiver":         "0xReceiver",
                "term_id":          "42",
                "curve_id":         "1",
                "assets":           "1000000",
                "assets_after_fees":"980000",
                "shares":           "950000"
            }),
            term_id: Some("42".to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    fn redeemed_event() -> StoredEvent {
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
                "term_id":  "42",
                "curve_id": "1",
                "shares":   "950000",
                "assets":   "980000"
            }),
            term_id: Some("42".to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn name_is_correct() {
        assert_eq!(VaultHoldersIndexProjection.name(), "vault_holders_index");
    }

    #[test]
    fn event_types_are_deposited_and_redeemed() {
        assert_eq!(
            VaultHoldersIndexProjection.event_types(),
            &[EventType::Deposited, EventType::Redeemed]
        );
    }

    #[test]
    fn extract_deposit_fields_happy_path() {
        let event = deposited_event();
        let (term_id, curve_id, account_id, shares, deposits) =
            extract_deposit_fields(&event).unwrap();
        assert_eq!(term_id, "42");
        assert_eq!(curve_id, "1");
        // receiver becomes the account_id for deposits.
        assert_eq!(account_id, "0xReceiver");
        assert_eq!(shares, BigDecimal::from_str("950000").unwrap());
        assert_eq!(deposits, BigDecimal::from_str("980000").unwrap());
    }

    #[test]
    fn extract_redeem_fields_happy_path() {
        let event = redeemed_event();
        let (term_id, curve_id, account_id, shares, assets) =
            extract_redeem_fields(&event).unwrap();
        assert_eq!(term_id, "42");
        assert_eq!(curve_id, "1");
        // sender becomes the account_id for redemptions.
        assert_eq!(account_id, "0xSender");
        assert_eq!(shares, BigDecimal::from_str("950000").unwrap());
        assert_eq!(assets, BigDecimal::from_str("980000").unwrap());
    }

    #[test]
    fn extract_deposit_fields_missing_receiver_errors() {
        let mut event = deposited_event();
        // Remove the receiver field.
        event.event_data.as_object_mut().unwrap().remove("receiver");
        let err = extract_deposit_fields(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "receiver"));
    }

    #[test]
    fn extract_deposit_fields_non_numeric_shares_errors() {
        let mut event = deposited_event();
        event.event_data["shares"] = json!("not-a-number");
        let err = extract_deposit_fields(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::InvalidEventData(_)));
    }

    #[test]
    fn extract_redeem_fields_missing_assets_errors() {
        let mut event = redeemed_event();
        event.event_data.as_object_mut().unwrap().remove("assets");
        let err = extract_redeem_fields(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "assets"));
    }

    // -----------------------------------------------------------------------
    // Typed-event path tests
    // -----------------------------------------------------------------------

    #[test]
    fn uses_typed_events_returns_true() {
        assert!(VaultHoldersIndexProjection.uses_typed_events());
    }

    #[test]
    fn typed_deposit_fields_correct() {
        use serde_json::json;
        use shared::models::StoredEvent;

        let stored = StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xbh".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "Deposited".to_owned(),
            event_data: json!({
                "block_number": 100,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": "0xbh",
                "transaction_hash": "0xtx",
                "log_index": 0,
                "sender": "0xSender",
                "receiver": "0xReceiver",
                "term_id": "0x000000000000000000000000000000000000000000000000000000000000002a",
                "curve_id": "1",
                "assets": "1000000",
                "assets_after_fees": "980000",
                "shares": "950000",
                "total_shares": "5000000",
                "vault_type": 1
            }),
            term_id: Some(
                "0x000000000000000000000000000000000000000000000000000000000000002a".to_owned(),
            ),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };

        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::Deposited { data, .. } = &parsed else {
            panic!("expected Deposited variant");
        };
        // Typed fields match what the legacy extract_deposit_fields would return.
        // term_id is a hex string (keccak256 hash format).
        assert_eq!(
            data.term_id,
            "0x000000000000000000000000000000000000000000000000000000000000002a"
        );
        assert_eq!(data.curve_id.to_string(), "1");
        assert_eq!(data.receiver, "0xReceiver");
        assert_eq!(data.shares, BigDecimal::from_str("950000").unwrap());
        assert_eq!(
            data.assets_after_fees,
            BigDecimal::from_str("980000").unwrap()
        );
    }
}
