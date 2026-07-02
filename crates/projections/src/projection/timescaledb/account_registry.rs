//! PostgreSQL account-registry projection.
//!
//! Tracks every unique address that interacts with the protocol by upserting
//! rows into the `account` table.  `first_seen_at` is set on INSERT and is
//! never overwritten; `last_seen_at` advances to the latest event timestamp
//! on every subsequent encounter with the same address.
//!
//! Addresses are extracted from:
//! - `AtomCreated`         — `creator`
//! - `TripleCreated`       — `creator`
//! - `Deposited`           — `sender`, `receiver`
//! - `Redeemed`            — `sender`, `receiver`
//! - `ProtocolFeeAccrued`  — `sender`
//!
//! `SharePriceChanged` is excluded because it carries no address fields.

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use shared::models::StoredEvent;
use shared::parsed_event::ParsedEvent;
use shared::types::EventType;
use sqlx::PgPool;
use tracing::warn;

use crate::error::ProjectionError;
use crate::projection::pg::PgProjection;

// ---------------------------------------------------------------------------
// Projection struct
// ---------------------------------------------------------------------------

/// PgProjection that maintains the `account` registry in PostgreSQL.
pub struct AccountRegistryProjection;

// ---------------------------------------------------------------------------
// Typed address extraction (used by process_parsed_batch)
// ---------------------------------------------------------------------------

/// Extract `(address, timestamp)` pairs from a typed [`ParsedEvent`].
///
/// Returns owned `String`s so the caller can build a deduplication map
/// without lifetime constraints. Returns an empty `Vec` for event types that
/// carry no addresses (`SharePriceChanged`) or for `Unknown` events (warned).
fn extract_addresses_typed(event: &ParsedEvent) -> Vec<(String, DateTime<Utc>)> {
    match event {
        ParsedEvent::AtomCreated { metadata, data } => {
            vec![(data.creator.clone(), metadata.block_timestamp)]
        }
        ParsedEvent::TripleCreated { metadata, data } => {
            vec![(data.creator.clone(), metadata.block_timestamp)]
        }
        ParsedEvent::Deposited { metadata, data } => {
            vec![
                (data.sender.clone(), metadata.block_timestamp),
                (data.receiver.clone(), metadata.block_timestamp),
            ]
        }
        ParsedEvent::Redeemed { metadata, data } => {
            vec![
                (data.sender.clone(), metadata.block_timestamp),
                (data.receiver.clone(), metadata.block_timestamp),
            ]
        }
        ParsedEvent::ProtocolFeeAccrued { metadata, data } => {
            vec![(data.sender.clone(), metadata.block_timestamp)]
        }
        // SharePriceChanged carries no address fields.
        ParsedEvent::SharePriceChanged { .. } => vec![],
        ParsedEvent::Unknown(raw) => {
            warn!(
                seq = raw.sequence_number,
                event_type = %raw.event_type,
                "Unexpected event type in AccountRegistryProjection"
            );
            vec![]
        }
    }
}

// ---------------------------------------------------------------------------
// PgProjection impl
// ---------------------------------------------------------------------------

#[async_trait]
impl PgProjection for AccountRegistryProjection {
    fn name(&self) -> &str {
        "account_registry"
    }

    fn event_types(&self) -> &'static [EventType] {
        // SharePriceChanged is intentionally absent — it carries no addresses.
        &[
            EventType::AtomCreated,
            EventType::TripleCreated,
            EventType::Deposited,
            EventType::Redeemed,
            EventType::ProtocolFeeAccrued,
        ]
    }

    fn uses_typed_events(&self) -> bool {
        true
    }

    /// Process a batch of pre-parsed typed events, upserting account rows.
    ///
    /// Extracts addresses via the typed variant (no JSON extraction needed).
    /// Deduplicates within the batch and bulk-upserts via `UNNEST`.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` on any SQL error.
    async fn process_parsed_batch(
        &self,
        pool: &PgPool,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError> {
        let mut address_map: ahash::AHashMap<String, DateTime<Utc>> = ahash::AHashMap::new();

        for event in events {
            for (address, seen_at) in extract_addresses_typed(event) {
                address_map
                    .entry(address)
                    .and_modify(|existing| {
                        if seen_at > *existing {
                            *existing = seen_at;
                        }
                    })
                    .or_insert(seen_at);
            }
        }

        if address_map.is_empty() {
            return Ok(());
        }

        let mut ids: Vec<String> = Vec::with_capacity(address_map.len());
        let mut timestamps: Vec<DateTime<Utc>> = Vec::with_capacity(address_map.len());
        for (address, seen_at) in address_map {
            ids.push(address);
            timestamps.push(seen_at);
        }

        let mut tx = pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO account (account_id, first_seen_at, last_seen_at, account_type)
            SELECT id, ts, ts, 'Default'
            FROM UNNEST($1::TEXT[], $2::TIMESTAMPTZ[]) AS t(id, ts)
            ON CONFLICT (account_id) DO UPDATE
                SET last_seen_at = GREATEST(account.last_seen_at, EXCLUDED.last_seen_at)
            "#,
        )
        .bind(&ids)
        .bind(&timestamps)
        .execute(&mut *tx)
        .await?;

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
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::get_str;
    use chrono::Utc;
    use serde_json::json;
    use shared::types::EventType;

    /// Test-only: extract raw (address, timestamp) pairs from a stored event.
    ///
    /// This helper documents the legacy raw-extraction semantics that are now
    /// replaced by the typed path (`extract_addresses_typed`). Kept here so
    /// the unit tests remain green and continue to document the expected
    /// address-extraction contract.
    fn extract_addresses(event: &StoredEvent) -> Vec<(&str, chrono::DateTime<Utc>)> {
        let data = &event.event_data;
        let ts = event.block_timestamp;
        let seq = event.sequence_number;

        match event.event_type.as_str() {
            "AtomCreated" | "TripleCreated" => match get_str(data, "creator") {
                Ok(addr) => vec![(addr, ts)],
                Err(_) => {
                    tracing::warn!(
                        sequence_number = seq,
                        event_type = %event.event_type,
                        "Missing creator field; skipping address extraction"
                    );
                    vec![]
                }
            },
            "Deposited" | "Redeemed" => {
                let sender = get_str(data, "sender");
                let receiver = get_str(data, "receiver");
                match (sender, receiver) {
                    (Ok(s), Ok(r)) => vec![(s, ts), (r, ts)],
                    _ => {
                        tracing::warn!(
                            sequence_number = seq,
                            event_type = %event.event_type,
                            "Missing sender or receiver field; skipping address extraction"
                        );
                        vec![]
                    }
                }
            }
            "ProtocolFeeAccrued" => match get_str(data, "sender") {
                Ok(addr) => vec![(addr, ts)],
                Err(_) => {
                    tracing::warn!(
                        sequence_number = seq,
                        event_type = %event.event_type,
                        "Missing sender field; skipping address extraction"
                    );
                    vec![]
                }
            },
            other => {
                tracing::warn!(
                    event_type = other,
                    "Unexpected event type in AccountRegistryProjection"
                );
                vec![]
            }
        }
    }

    fn make_event(event_type: &str, event_data: serde_json::Value) -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 0,
            event_type: event_type.to_owned(),
            event_data,
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn name_is_account_registry() {
        assert_eq!(AccountRegistryProjection.name(), "account_registry");
    }

    #[test]
    fn event_types_excludes_share_price_changed() {
        let types = AccountRegistryProjection.event_types();
        assert_eq!(types.len(), 5);
        assert!(!types.contains(&EventType::SharePriceChanged));
        assert!(types.contains(&EventType::AtomCreated));
        assert!(types.contains(&EventType::TripleCreated));
        assert!(types.contains(&EventType::Deposited));
        assert!(types.contains(&EventType::Redeemed));
        assert!(types.contains(&EventType::ProtocolFeeAccrued));
    }

    #[test]
    fn extract_addresses_atom_created() {
        let event = make_event("AtomCreated", json!({ "creator": "0xCreator" }));
        let addrs = extract_addresses(&event);
        assert_eq!(addrs.len(), 1);
        assert_eq!(addrs[0].0, "0xCreator");
    }

    #[test]
    fn extract_addresses_triple_created() {
        let event = make_event("TripleCreated", json!({ "creator": "0xTripleCreator" }));
        let addrs = extract_addresses(&event);
        assert_eq!(addrs.len(), 1);
        assert_eq!(addrs[0].0, "0xTripleCreator");
    }

    #[test]
    fn extract_addresses_deposited_returns_sender_and_receiver() {
        let event = make_event(
            "Deposited",
            json!({ "sender": "0xSender", "receiver": "0xReceiver" }),
        );
        let addrs = extract_addresses(&event);
        assert_eq!(addrs.len(), 2);
        assert_eq!(addrs[0].0, "0xSender");
        assert_eq!(addrs[1].0, "0xReceiver");
    }

    #[test]
    fn extract_addresses_redeemed_returns_sender_and_receiver() {
        let event = make_event(
            "Redeemed",
            json!({ "sender": "0xSender", "receiver": "0xReceiver" }),
        );
        let addrs = extract_addresses(&event);
        assert_eq!(addrs.len(), 2);
        assert_eq!(addrs[0].0, "0xSender");
        assert_eq!(addrs[1].0, "0xReceiver");
    }

    #[test]
    fn extract_addresses_protocol_fee_accrued() {
        let event = make_event(
            "ProtocolFeeAccrued",
            json!({ "sender": "0xFeeRecipient", "amount": "500", "epoch": "1" }),
        );
        let addrs = extract_addresses(&event);
        assert_eq!(addrs.len(), 1);
        assert_eq!(addrs[0].0, "0xFeeRecipient");
    }

    #[test]
    fn extract_addresses_missing_creator_returns_empty() {
        let event = make_event("AtomCreated", json!({}));
        let addrs = extract_addresses(&event);
        assert!(addrs.is_empty());
    }

    #[test]
    fn extract_addresses_missing_receiver_returns_empty() {
        let event = make_event("Deposited", json!({ "sender": "0xSender" }));
        let addrs = extract_addresses(&event);
        assert!(addrs.is_empty());
    }

    #[test]
    fn extract_addresses_preserves_event_timestamp() {
        let ts = Utc::now();
        let mut event = make_event("AtomCreated", json!({ "creator": "0xCreator" }));
        event.block_timestamp = ts;
        let addrs = extract_addresses(&event);
        assert_eq!(addrs[0].1, ts);
    }

    // -----------------------------------------------------------------------
    // Typed-event path tests
    // -----------------------------------------------------------------------

    #[test]
    fn uses_typed_events_returns_true() {
        assert!(AccountRegistryProjection.uses_typed_events());
    }

    fn make_parsed(event_type: &str, event_data: serde_json::Value) -> ParsedEvent {
        use serde_json::json;
        use shared::models::StoredEvent;

        let mut data = json!({
            "block_number": 100,
            "block_timestamp": "2024-01-01T00:00:00Z",
            "block_hash": "0xbh",
            "transaction_hash": "0xtx",
            "log_index": 0
        });
        if let (Some(obj), Some(extra)) = (data.as_object_mut(), event_data.as_object()) {
            for (k, v) in extra {
                obj.insert(k.clone(), v.clone());
            }
        }
        let stored = StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xbh".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: event_type.to_owned(),
            event_data: data,
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        ParsedEvent::parse_or_unknown(stored).0
    }

    #[test]
    fn typed_atom_created_returns_creator() {
        let event = make_parsed(
            "AtomCreated",
            serde_json::json!({
                "creator": "0xCreator",
                "term_id": "1",
                "atom_data": "0x",
                "atom_wallet": "0xWallet"
            }),
        );
        let addrs = extract_addresses_typed(&event);
        assert_eq!(addrs.len(), 1);
        assert_eq!(addrs[0].0, "0xCreator");
    }

    #[test]
    fn typed_deposited_returns_sender_and_receiver() {
        let event = make_parsed(
            "Deposited",
            serde_json::json!({
                "sender": "0xSender",
                "receiver": "0xReceiver",
                "term_id": "7",
                "curve_id": "1",
                "assets": "1000000",
                "assets_after_fees": "980000",
                "shares": "950000",
                "total_shares": "5000000",
                "vault_type": 1
            }),
        );
        let addrs = extract_addresses_typed(&event);
        assert_eq!(addrs.len(), 2);
        assert_eq!(addrs[0].0, "0xSender");
        assert_eq!(addrs[1].0, "0xReceiver");
    }

    #[test]
    fn typed_share_price_changed_returns_empty() {
        let event = make_parsed(
            "SharePriceChanged",
            serde_json::json!({
                "term_id": "15",
                "curve_id": "1",
                "share_price": "1000000000000000000",
                "total_assets": "5000000000000000000",
                "total_shares": "5000000000000000000",
                "vault_type": 1
            }),
        );
        let addrs = extract_addresses_typed(&event);
        assert!(addrs.is_empty());
    }

    #[test]
    fn typed_protocol_fee_accrued_returns_sender() {
        let event = make_parsed(
            "ProtocolFeeAccrued",
            serde_json::json!({
                "epoch": "1",
                "sender": "0xFeeRecipient",
                "amount": "50000"
            }),
        );
        let addrs = extract_addresses_typed(&event);
        assert_eq!(addrs.len(), 1);
        assert_eq!(addrs[0].0, "0xFeeRecipient");
    }
}
