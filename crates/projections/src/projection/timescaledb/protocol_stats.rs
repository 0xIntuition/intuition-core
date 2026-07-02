//! PostgreSQL projection that maintains the `stats` singleton row.
//!
//! Accumulates per-event counter deltas across the batch and applies them in
//! a single `UPDATE` statement, minimising row-level lock contention on the
//! singleton.  Every supported event type is tallied; unknown types are
//! silently ignored (the batch is not aborted).

use async_trait::async_trait;
use chrono::{DateTime, Utc};
use shared::models::StoredEvent;
use shared::parsed_event::ParsedEvent;
use shared::types::EventType;
use sqlx::types::BigDecimal;
use sqlx::PgPool;
use tracing::warn;

use crate::error::ProjectionError;
use crate::projection::pg::PgProjection;

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Maintains the `stats` singleton (id = 1) from all six event types.
///
/// Deltas are accumulated in-memory across the batch and flushed as a single
/// SQL statement, so the singleton row is locked only once per batch rather
/// than once per event.
pub struct ProtocolStatsProjection;

/// Accumulated deltas for one batch of events.
///
/// All numeric deltas are `BigDecimal` to preserve full precision for
/// wei-scale on-chain values.
#[derive(Debug, Default)]
struct Deltas {
    atoms: i64,
    triples: i64,
    deposits_count: i64,
    redemptions_count: i64,
    deposit_volume: BigDecimal,
    redemption_volume: BigDecimal,
    fees: BigDecimal,
}

#[async_trait]
impl PgProjection for ProtocolStatsProjection {
    fn name(&self) -> &str {
        "protocol_stats"
    }

    fn event_types(&self) -> &'static [EventType] {
        &[
            EventType::AtomCreated,
            EventType::TripleCreated,
            EventType::Deposited,
            EventType::Redeemed,
            EventType::ProtocolFeeAccrued,
            EventType::SharePriceChanged,
        ]
    }

    fn uses_typed_events(&self) -> bool {
        true
    }

    /// Accumulate deltas from the typed batch, then apply them to `stats` in
    /// one transaction.
    ///
    /// All six event types are handled exhaustively — `SharePriceChanged` has
    /// no stats impact and `Unknown` events are warned and skipped. The delta
    /// accumulation is done in-memory for the whole batch before the single
    /// SQL upsert, minimising lock contention on the singleton row.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` on any SQL failure.
    async fn process_parsed_batch(
        &self,
        pool: &PgPool,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError> {
        let mut d = Deltas::default();

        for event in events {
            accumulate_typed(&mut d, event);
        }

        // Capture the latest block timestamp across the batch.
        // `metadata().block_timestamp()` works for both typed and Unknown variants.
        let max_ts: DateTime<Utc> = events
            .iter()
            .map(|e| e.metadata().block_timestamp())
            .max()
            .unwrap_or_else(Utc::now);

        if d.atoms == 0
            && d.triples == 0
            && d.deposits_count == 0
            && d.redemptions_count == 0
            && d.deposit_volume == 0
            && d.redemption_volume == 0
            && d.fees == 0
        {
            return Ok(());
        }

        let mut tx = pool.begin().await?;

        sqlx::query(
            r#"
            INSERT INTO stats (
                id,
                total_atoms, total_triples,
                total_deposits_count, total_redemptions_count,
                total_deposit_volume, total_redemption_volume,
                total_fees, updated_at
            )
            VALUES (1, $1, $2, $3, $4, $5, $6, $7, NOW())
            ON CONFLICT (id) DO UPDATE SET
                total_atoms              = stats.total_atoms + EXCLUDED.total_atoms,
                total_triples            = stats.total_triples + EXCLUDED.total_triples,
                total_deposits_count     = stats.total_deposits_count + EXCLUDED.total_deposits_count,
                total_redemptions_count  = stats.total_redemptions_count + EXCLUDED.total_redemptions_count,
                total_deposit_volume     = stats.total_deposit_volume + EXCLUDED.total_deposit_volume,
                total_redemption_volume  = stats.total_redemption_volume + EXCLUDED.total_redemption_volume,
                total_fees               = stats.total_fees + EXCLUDED.total_fees,
                updated_at               = NOW()
            "#,
        )
        .bind(d.atoms)
        .bind(d.triples)
        .bind(d.deposits_count)
        .bind(d.redemptions_count)
        .bind(&d.deposit_volume)
        .bind(&d.redemption_volume)
        .bind(&d.fees)
        .execute(&mut *tx)
        .await?;

        sqlx::query(
            r#"
            INSERT INTO stats_history (
                total_atoms, total_triples, total_accounts,
                total_deposits_count, total_redemptions_count,
                total_deposit_volume, total_redemption_volume,
                total_fees, ts
            )
            SELECT
                total_atoms, total_triples, total_accounts,
                total_deposits_count, total_redemptions_count,
                total_deposit_volume, total_redemption_volume,
                total_fees, $1
            FROM stats WHERE id = 1
            "#,
        )
        .bind(max_ts)
        .execute(&mut *tx)
        .await?;

        tx.commit().await?;
        Ok(())
    }

    /// Accumulate deltas from the batch, then apply them to `stats` in one
    /// transaction.
    ///
    /// # Errors
    ///
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
// Typed accumulation helper (used by process_parsed_batch)
// ---------------------------------------------------------------------------

/// Tally one typed event's contribution into `d`.
///
/// Uses an exhaustive match so the compiler forces a decision when new
/// [`ParsedEvent`] variants are added. `SharePriceChanged` has no stats
/// impact (no-op). `Unknown` events are warned and skipped.
fn accumulate_typed(d: &mut Deltas, event: &ParsedEvent) {
    match event {
        ParsedEvent::AtomCreated { .. } => {
            d.atoms += 1;
        }
        ParsedEvent::TripleCreated { .. } => {
            d.triples += 1;
        }
        ParsedEvent::Deposited { data, .. } => {
            d.deposits_count += 1;
            // `assets_after_fees` is already `BigDecimal` — no parse needed.
            d.deposit_volume += &data.assets_after_fees;
        }
        ParsedEvent::Redeemed { data, .. } => {
            d.redemptions_count += 1;
            // `assets` is already `BigDecimal` — no parse needed.
            d.redemption_volume += &data.assets;
        }
        ParsedEvent::ProtocolFeeAccrued { data, .. } => {
            // `amount` is already `BigDecimal` — no parse needed.
            d.fees += &data.amount;
        }
        ParsedEvent::SharePriceChanged { .. } => {
            // SharePriceChanged has no stats impact.
        }
        ParsedEvent::Unknown(raw) => {
            warn!(
                projection = "protocol_stats",
                seq = raw.sequence_number,
                event_type = %raw.event_type,
                "Unknown event type; skipping"
            );
        }
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
    use std::str::FromStr;

    /// Tally one raw `StoredEvent`'s contribution into `d`.
    ///
    /// Test-only helper — documents the legacy raw-accumulation contract that
    /// the typed path (`accumulate_typed`) now replaces. Numeric parse failures
    /// are warned but do not abort the batch; the contribution defaults to zero.
    fn accumulate(d: &mut Deltas, event: &StoredEvent) {
        match event.event_type.as_str() {
            "AtomCreated" => {
                d.atoms += 1;
            }

            "TripleCreated" => {
                d.triples += 1;
            }

            "Deposited" => {
                d.deposits_count += 1;
                let data = &event.event_data;
                match get_str(data, "assets_after_fees").and_then(|raw| {
                    BigDecimal::from_str(raw).map_err(|_| {
                        ProjectionError::InvalidEventData(format!(
                            "assets_after_fees is not numeric: {raw}"
                        ))
                    })
                }) {
                    Ok(v) => d.deposit_volume += v,
                    Err(e) => warn!(
                        projection = "protocol_stats",
                        seq = event.sequence_number,
                        error = %e,
                        "Could not parse deposit volume; counting 0"
                    ),
                }
            }

            "Redeemed" => {
                d.redemptions_count += 1;
                let data = &event.event_data;
                match get_str(data, "assets").and_then(|raw| {
                    BigDecimal::from_str(raw).map_err(|_| {
                        ProjectionError::InvalidEventData(format!("assets is not numeric: {raw}"))
                    })
                }) {
                    Ok(v) => d.redemption_volume += v,
                    Err(e) => warn!(
                        projection = "protocol_stats",
                        seq = event.sequence_number,
                        error = %e,
                        "Could not parse redemption volume; counting 0"
                    ),
                }
            }

            "ProtocolFeeAccrued" => {
                let data = &event.event_data;
                match get_str(data, "amount").and_then(|raw| {
                    BigDecimal::from_str(raw).map_err(|_| {
                        ProjectionError::InvalidEventData(format!("amount is not numeric: {raw}"))
                    })
                }) {
                    Ok(v) => d.fees += v,
                    Err(e) => warn!(
                        projection = "protocol_stats",
                        seq = event.sequence_number,
                        error = %e,
                        "Could not parse fee amount; counting 0"
                    ),
                }
            }

            // SharePriceChanged has no stats impact.
            "SharePriceChanged" => {}

            other => {
                warn!(
                    projection = "protocol_stats",
                    event_type = other,
                    "Unexpected event type; skipping"
                );
            }
        }
    }

    fn make_event(event_type: &str, event_data: serde_json::Value) -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xhash".to_owned(),
            transaction_hash: "0xtx".to_owned(),
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
    fn name_is_correct() {
        assert_eq!(ProtocolStatsProjection.name(), "protocol_stats");
    }

    #[test]
    fn event_types_contains_all_six() {
        let types = ProtocolStatsProjection.event_types();
        assert_eq!(types.len(), 6);
        assert!(types.contains(&EventType::AtomCreated));
        assert!(types.contains(&EventType::TripleCreated));
        assert!(types.contains(&EventType::Deposited));
        assert!(types.contains(&EventType::Redeemed));
        assert!(types.contains(&EventType::ProtocolFeeAccrued));
        assert!(types.contains(&EventType::SharePriceChanged));
    }

    #[test]
    fn atom_created_increments_atoms() {
        let mut d = Deltas::default();
        let event = make_event("AtomCreated", json!({ "term_id": "1" }));
        accumulate(&mut d, &event);
        assert_eq!(d.atoms, 1);
        assert_eq!(d.triples, 0);
    }

    #[test]
    fn triple_created_increments_triples() {
        let mut d = Deltas::default();
        let event = make_event("TripleCreated", json!({ "term_id": "2" }));
        accumulate(&mut d, &event);
        assert_eq!(d.triples, 1);
        assert_eq!(d.atoms, 0);
    }

    #[test]
    fn deposited_increments_count_and_volume() {
        let mut d = Deltas::default();
        let event = make_event(
            "Deposited",
            json!({ "assets_after_fees": "980000", "shares": "950000" }),
        );
        accumulate(&mut d, &event);
        assert_eq!(d.deposits_count, 1);
        assert_eq!(d.deposit_volume, BigDecimal::from_str("980000").unwrap());
    }

    #[test]
    fn redeemed_increments_count_and_volume() {
        let mut d = Deltas::default();
        let event = make_event(
            "Redeemed",
            json!({ "assets": "980000", "shares": "950000" }),
        );
        accumulate(&mut d, &event);
        assert_eq!(d.redemptions_count, 1);
        assert_eq!(d.redemption_volume, BigDecimal::from_str("980000").unwrap());
    }

    #[test]
    fn protocol_fee_accrued_increments_fees() {
        let mut d = Deltas::default();
        let event = make_event(
            "ProtocolFeeAccrued",
            json!({ "sender": "0xFeeRecipient", "amount": "50000", "epoch": "1" }),
        );
        accumulate(&mut d, &event);
        assert_eq!(d.fees, BigDecimal::from_str("50000").unwrap());
    }

    #[test]
    fn share_price_changed_has_no_stats_impact() {
        let mut d = Deltas::default();
        let event = make_event(
            "SharePriceChanged",
            json!({
                "term_id":      "15",
                "share_price":  "1050000000000000000",
                "total_assets": "5000000000000000000",
                "total_shares": "4761904761904761904"
            }),
        );
        accumulate(&mut d, &event);
        // Nothing should change.
        assert_eq!(d.atoms, 0);
        assert_eq!(d.triples, 0);
        assert_eq!(d.deposits_count, 0);
        assert_eq!(d.redemptions_count, 0);
        assert_eq!(d.deposit_volume, BigDecimal::from(0));
        assert_eq!(d.redemption_volume, BigDecimal::from(0));
        assert_eq!(d.fees, BigDecimal::from(0));
    }

    #[test]
    fn deposited_with_bad_volume_defaults_to_zero() {
        let mut d = Deltas::default();
        let event = make_event("Deposited", json!({ "assets_after_fees": "not-a-number" }));
        accumulate(&mut d, &event);
        // Count still increments; volume stays at zero.
        assert_eq!(d.deposits_count, 1);
        assert_eq!(d.deposit_volume, BigDecimal::from(0));
    }

    #[test]
    fn multiple_events_accumulate_correctly() {
        let mut d = Deltas::default();
        accumulate(&mut d, &make_event("AtomCreated", json!({})));
        accumulate(&mut d, &make_event("AtomCreated", json!({})));
        accumulate(&mut d, &make_event("TripleCreated", json!({})));
        accumulate(
            &mut d,
            &make_event("Deposited", json!({ "assets_after_fees": "100" })),
        );
        accumulate(
            &mut d,
            &make_event("Deposited", json!({ "assets_after_fees": "200" })),
        );
        accumulate(&mut d, &make_event("Redeemed", json!({ "assets": "50" })));
        accumulate(
            &mut d,
            &make_event(
                "ProtocolFeeAccrued",
                json!({ "amount": "10", "sender": "0x0", "epoch": "1" }),
            ),
        );

        assert_eq!(d.atoms, 2);
        assert_eq!(d.triples, 1);
        assert_eq!(d.deposits_count, 2);
        assert_eq!(d.redemptions_count, 1);
        assert_eq!(d.deposit_volume, BigDecimal::from_str("300").unwrap());
        assert_eq!(d.redemption_volume, BigDecimal::from_str("50").unwrap());
        assert_eq!(d.fees, BigDecimal::from_str("10").unwrap());
    }

    // -----------------------------------------------------------------------
    // Typed accumulation tests
    // -----------------------------------------------------------------------

    fn make_parsed_event(event_type: &str, extra: serde_json::Value) -> ParsedEvent {
        use chrono::Utc;
        use serde_json::json;
        use shared::models::StoredEvent;

        // Build the full event_data by merging required envelope fields with
        // the caller-supplied extra fields.
        let mut data = json!({
            "block_number": 100,
            "block_timestamp": "2024-01-01T00:00:00Z",
            "block_hash": "0xbh",
            "transaction_hash": "0xtx",
            "log_index": 0
        });
        if let (Some(obj), Some(extra_obj)) = (data.as_object_mut(), extra.as_object()) {
            for (k, v) in extra_obj {
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
    fn uses_typed_events_returns_true() {
        assert!(ProtocolStatsProjection.uses_typed_events());
    }

    #[test]
    fn accumulate_typed_atom_created() {
        let mut d = Deltas::default();
        let event = make_parsed_event(
            "AtomCreated",
            json!({
                "creator": "0xCreator",
                "term_id": "1",
                "atom_data": "0x",
                "atom_wallet": "0xWallet"
            }),
        );
        accumulate_typed(&mut d, &event);
        assert_eq!(d.atoms, 1);
        assert_eq!(d.triples, 0);
    }

    #[test]
    fn accumulate_typed_deposited_increments_count_and_volume() {
        let mut d = Deltas::default();
        let event = make_parsed_event(
            "Deposited",
            json!({
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
        accumulate_typed(&mut d, &event);
        assert_eq!(d.deposits_count, 1);
        assert_eq!(d.deposit_volume, BigDecimal::from_str("980000").unwrap());
    }

    #[test]
    fn accumulate_typed_redeemed_increments_count_and_volume() {
        let mut d = Deltas::default();
        let event = make_parsed_event(
            "Redeemed",
            json!({
                "sender": "0xSender",
                "receiver": "0xReceiver",
                "term_id": "7",
                "curve_id": "1",
                "shares": "950000",
                "total_shares": "5000000",
                "assets": "980000",
                "fees": "20000",
                "vault_type": 1
            }),
        );
        accumulate_typed(&mut d, &event);
        assert_eq!(d.redemptions_count, 1);
        assert_eq!(d.redemption_volume, BigDecimal::from_str("980000").unwrap());
    }

    #[test]
    fn accumulate_typed_protocol_fee_accrued() {
        let mut d = Deltas::default();
        let event = make_parsed_event(
            "ProtocolFeeAccrued",
            json!({
                "epoch": "1",
                "sender": "0xFee",
                "amount": "50000"
            }),
        );
        accumulate_typed(&mut d, &event);
        assert_eq!(d.fees, BigDecimal::from_str("50000").unwrap());
    }

    #[test]
    fn accumulate_typed_share_price_changed_has_no_impact() {
        let mut d = Deltas::default();
        let event = make_parsed_event(
            "SharePriceChanged",
            json!({
                "term_id": "15",
                "curve_id": "1",
                "share_price": "1050000000000000000",
                "total_assets": "5000000000000000000",
                "total_shares": "4761904761904761904",
                "vault_type": 1
            }),
        );
        accumulate_typed(&mut d, &event);
        assert_eq!(d.atoms, 0);
        assert_eq!(d.triples, 0);
        assert_eq!(d.deposits_count, 0);
        assert_eq!(d.redemptions_count, 0);
        assert_eq!(d.deposit_volume, BigDecimal::from(0));
        assert_eq!(d.redemption_volume, BigDecimal::from(0));
        assert_eq!(d.fees, BigDecimal::from(0));
    }
}
