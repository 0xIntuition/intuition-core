//! PostgreSQL projection that maintains term-level aggregate tables.
//!
//! Handles two event types:
//! - `TripleCreated`: upserts `term_summary` and increments
//!   `predicate_object_summary` / `subject_predicate_summary` counters.
//! - `SharePriceChanged`: updates `term_summary` market-cap fields and appends
//!   a row to `term_market_cap_history` for time-series queries.

use async_trait::async_trait;
use shared::models::{SharePriceChangedRecord, StoredEvent, TripleCreatedRecord};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;
use sqlx::PgPool;
use tracing::warn;

use crate::error::{ErrorClass, ProjectionError};
use crate::projection::compute_market_cap;
use crate::projection::pg::PgProjection;
use crate::repo::dead_letter_repo;

/// Projection name used for dead-letter and metric tagging.
const PROJECTION_NAME: &str = "term_aggregates";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Maintains `term_summary`, `predicate_object_summary`,
/// `subject_predicate_summary`, and `term_market_cap_history`.
pub struct TermAggregatesProjection;

#[async_trait]
impl PgProjection for TermAggregatesProjection {
    fn name(&self) -> &str {
        "term_aggregates"
    }

    fn event_types(&self) -> &'static [EventType] {
        &[EventType::TripleCreated, EventType::SharePriceChanged]
    }

    fn uses_typed_events(&self) -> bool {
        true
    }

    /// Process a batch of pre-parsed typed events inside a single database
    /// transaction.
    ///
    /// Dispatches `TripleCreated` → upsert `term_summary` + counters.
    /// Dispatches `SharePriceChanged` → update market-cap fields + history row.
    /// All other variants are skipped (filtered by `event_types()`).
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` on any SQL failure.
    /// Per-event `Fatal`/`Transient` errors are propagated immediately;
    /// `InvalidEventData` errors are warned and skipped.
    async fn process_parsed_batch(
        &self,
        pool: &PgPool,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError> {
        let mut tx = pool.begin().await?;

        for event in events {
            let result = match event {
                ParsedEvent::TripleCreated { data, .. } => {
                    process_triple_created_typed(data, &mut tx).await
                }
                ParsedEvent::SharePriceChanged { metadata, data } => {
                    process_share_price_changed_typed(metadata, data, &mut tx).await
                }
                ParsedEvent::AtomCreated { .. }
                | ParsedEvent::Deposited { .. }
                | ParsedEvent::Redeemed { .. }
                | ParsedEvent::ProtocolFeeAccrued { .. } => {
                    // Filtered by event_types() — not expected here.
                    continue;
                }
                ParsedEvent::Unknown(raw) => {
                    warn!(
                        projection = "term_aggregates",
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
                        return Err(err);
                    }
                    ErrorClass::Fatal => {
                        // Fatal error — dead-letter and halt the checkpoint.
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

    /// Process a batch of `TripleCreated` / `SharePriceChanged` events inside
    /// a single database transaction.
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
// Typed per-event handlers (used by process_parsed_batch)
// ---------------------------------------------------------------------------

/// Handle a `TripleCreated` event using the pre-parsed [`TripleCreatedRecord`].
///
/// Fields are already typed `BigDecimal` — no JSON extraction required.
async fn process_triple_created_typed(
    data: &TripleCreatedRecord,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), ProjectionError> {
    let term_id = data.term_id.to_string();
    let predicate_id = data.predicate_id.to_string();
    let object_id = data.object_id.to_string();
    let subject_id = data.subject_id.to_string();

    sqlx::query(
        r#"
        INSERT INTO term_summary (term_id, term_type, updated_at)
        VALUES ($1, 'triple', NOW())
        ON CONFLICT (term_id) DO UPDATE SET updated_at = NOW()
        "#,
    )
    .bind(&term_id)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO predicate_object_summary (predicate_id, object_id, triple_count, updated_at)
        VALUES ($1, $2, 1, NOW())
        ON CONFLICT (predicate_id, object_id) DO UPDATE SET
            triple_count = predicate_object_summary.triple_count + 1,
            updated_at   = NOW()
        "#,
    )
    .bind(&predicate_id)
    .bind(&object_id)
    .execute(&mut **tx)
    .await?;

    sqlx::query(
        r#"
        INSERT INTO subject_predicate_summary (subject_id, predicate_id, triple_count, updated_at)
        VALUES ($1, $2, 1, NOW())
        ON CONFLICT (subject_id, predicate_id) DO UPDATE SET
            triple_count = subject_predicate_summary.triple_count + 1,
            updated_at   = NOW()
        "#,
    )
    .bind(&subject_id)
    .bind(&predicate_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Handle a `SharePriceChanged` event using the pre-parsed [`SharePriceChangedRecord`].
///
/// Computes `market_cap` from the already-parsed `BigDecimal` fields and
/// upserts `term_summary` + appends a `term_market_cap_history` row.
async fn process_share_price_changed_typed(
    metadata: &EventMetadata,
    data: &SharePriceChangedRecord,
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<(), ProjectionError> {
    let term_id = data.term_id.to_string();

    // compute_market_cap expects string slices (it parses internally via U256).
    let market_cap = compute_market_cap(
        &data.total_shares.to_string(),
        &data.share_price.to_string(),
    )?;

    sqlx::query(
        r#"
        INSERT INTO term_summary (term_id, term_type, total_assets, total_market_cap, updated_at)
        VALUES ($1, 'atom', $2, $3, NOW())
        ON CONFLICT (term_id) DO UPDATE SET
            total_assets      = EXCLUDED.total_assets,
            total_market_cap  = EXCLUDED.total_market_cap,
            updated_at        = NOW()
        "#,
    )
    .bind(&term_id)
    .bind(&data.total_assets)
    .bind(&market_cap)
    .execute(&mut **tx)
    .await?;

    let event_id = format!(
        "{}-{}-{}",
        metadata.transaction_hash, metadata.log_index, metadata.event_type
    );

    sqlx::query(
        r#"
        INSERT INTO term_market_cap_history (event_id, term_id, total_assets, total_market_cap, ts)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (event_id, ts) DO NOTHING
        "#,
    )
    .bind(&event_id)
    .bind(&term_id)
    .bind(&data.total_assets)
    .bind(&market_cap)
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

    fn make_triple_created() -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xhash".to_owned(),
            transaction_hash: "0xtx1".to_owned(),
            log_index: 0,
            event_type: "TripleCreated".to_owned(),
            event_data: json!({
                "creator":      "0xCreator",
                "term_id":      "99",
                "subject_id":   "1",
                "predicate_id": "2",
                "object_id":    "3"
            }),
            term_id: Some("99".to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    fn make_share_price_changed() -> StoredEvent {
        StoredEvent {
            sequence_number: 2,
            block_number: 101,
            block_timestamp: Utc::now(),
            block_hash: "0xhash2".to_owned(),
            transaction_hash: "0xtx2".to_owned(),
            log_index: 0,
            event_type: "SharePriceChanged".to_owned(),
            event_data: json!({
                "term_id":      "15",
                "curve_id":     "1",
                "share_price":  "1050000000000000000",
                "total_assets": "5000000000000000000",
                "total_shares": "4761904761904761904"
            }),
            term_id: Some("15".to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn name_is_correct() {
        assert_eq!(TermAggregatesProjection.name(), "term_aggregates");
    }

    #[test]
    fn event_types_are_triple_and_price() {
        assert_eq!(
            TermAggregatesProjection.event_types(),
            &[EventType::TripleCreated, EventType::SharePriceChanged]
        );
    }

    #[test]
    fn triple_created_all_fields_present() {
        let event = make_triple_created();
        let data = &event.event_data;
        assert!(get_str(data, "term_id").is_ok());
        assert!(get_str(data, "subject_id").is_ok());
        assert!(get_str(data, "predicate_id").is_ok());
        assert!(get_str(data, "object_id").is_ok());
    }

    #[test]
    fn share_price_changed_market_cap_computed_correctly() {
        let event = make_share_price_changed();
        let data = &event.event_data;
        let market_cap = compute_market_cap(
            get_str(data, "total_shares").unwrap(),
            get_str(data, "share_price").unwrap(),
        )
        .unwrap();
        // Should be close to total_assets (5e18) but truncated by integer division
        let total_assets = BigDecimal::from_str(get_str(data, "total_assets").unwrap()).unwrap();
        let diff = &total_assets - &market_cap;
        // Rounding diff should be tiny (< 1000 wei)
        assert!(diff >= 0);
        assert!(diff < 1000);
    }

    #[test]
    fn share_price_changed_missing_total_shares_errors() {
        let mut event = make_share_price_changed();
        event
            .event_data
            .as_object_mut()
            .unwrap()
            .remove("total_shares");
        let data = &event.event_data;
        let result = get_str(data, "total_shares");
        assert!(result.is_err());
    }

    #[test]
    fn share_price_changed_non_numeric_share_price_errors() {
        let data = json!({ "share_price": "not-a-number" });
        let raw = get_str(&data, "share_price").unwrap();
        let result = BigDecimal::from_str(raw);
        assert!(result.is_err());
    }

    // -----------------------------------------------------------------------
    // Typed-event path tests
    // -----------------------------------------------------------------------

    #[test]
    fn uses_typed_events_returns_true() {
        assert!(TermAggregatesProjection.uses_typed_events());
    }

    #[test]
    fn typed_triple_created_fields_parsed() {
        use serde_json::json;
        use shared::models::StoredEvent;

        let stored = StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xbh".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "TripleCreated".to_owned(),
            event_data: json!({
                "block_number": 100,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": "0xbh",
                "transaction_hash": "0xtx",
                "log_index": 0,
                "creator": "0xCreator",
                "term_id": "99",
                "subject_id": "1",
                "predicate_id": "2",
                "object_id": "3"
            }),
            term_id: Some("99".to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };

        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::TripleCreated { data, .. } = &parsed else {
            panic!("expected TripleCreated variant");
        };
        assert_eq!(data.term_id.to_string(), "99");
        assert_eq!(data.subject_id.to_string(), "1");
        assert_eq!(data.predicate_id.to_string(), "2");
        assert_eq!(data.object_id.to_string(), "3");
    }

    #[test]
    fn typed_share_price_changed_market_cap_computed() {
        use serde_json::json;
        use shared::models::StoredEvent;

        let stored = StoredEvent {
            sequence_number: 2,
            block_number: 101,
            block_timestamp: Utc::now(),
            block_hash: "0xbh2".to_owned(),
            transaction_hash: "0xtx2".to_owned(),
            log_index: 0,
            event_type: "SharePriceChanged".to_owned(),
            event_data: json!({
                "block_number": 101,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": "0xbh2",
                "transaction_hash": "0xtx2",
                "log_index": 0,
                "term_id": "15",
                "curve_id": "1",
                "share_price": "1050000000000000000",
                "total_assets": "5000000000000000000",
                "total_shares": "4761904761904761904",
                "vault_type": 1
            }),
            term_id: Some("15".to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };

        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::SharePriceChanged { data, .. } = &parsed else {
            panic!("expected SharePriceChanged variant");
        };
        let market_cap = compute_market_cap(
            &data.total_shares.to_string(),
            &data.share_price.to_string(),
        )
        .unwrap();
        let total_assets = BigDecimal::from_str("5000000000000000000").unwrap();
        let diff = &total_assets - &market_cap;
        assert!(diff >= 0);
        assert!(diff < 1000);
    }
}
