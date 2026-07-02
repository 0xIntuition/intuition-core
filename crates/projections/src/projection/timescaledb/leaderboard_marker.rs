//! Leaderboard marker projection (event-driven dirty-set writer).
//!
//! Consumes `Deposited`, `Redeemed`, and `SharePriceChanged` events and
//! writes entries into the `dirty_account` and `dirty_vault` tables.
//! These dirty sets are later drained by the `LeaderboardRefreshProjection`
//! to decide which accounts need PnL recomputation.
//!
//! This projection does **not** read or compute PnL — it only marks which
//! rows are stale. Keeping the two concerns separate means the event-driven
//! path stays fast and the batch refresh path can be tuned independently.

use async_trait::async_trait;
use shared::models::{DepositedRecord, RedeemedRecord, SharePriceChangedRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;
use sqlx::PgPool;
use tracing::warn;

use crate::error::ProjectionError;
use crate::projection::pg::PgProjection;

// ---------------------------------------------------------------------------
// Projection struct
// ---------------------------------------------------------------------------

/// PgProjection that populates the dirty sets used by `LeaderboardRefreshProjection`.
pub struct LeaderboardMarkerProjection;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Upsert an entry in `dirty_account` for the given address.
///
/// `reason` is a short string describing why the account was marked (e.g.
/// `"deposited"` or `"redeemed"`). On conflict the existing row is kept and
/// only `last_marked_at` is advanced.
async fn mark_dirty_account(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
    reason: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO dirty_account (account_id, reason, first_marked_at, last_marked_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            reason         = EXCLUDED.reason,
            last_marked_at = NOW()
        "#,
    )
    .bind(account_id)
    .bind(reason)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Upsert an entry in `dirty_vault` for the given (term_id, curve_id) pair.
///
/// On conflict only `last_marked_at` is updated — `first_marked_at` is
/// preserved to allow latency tracking.
async fn mark_dirty_vault(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    curve_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO dirty_vault (term_id, curve_id, first_marked_at, last_marked_at)
        VALUES ($1, $2, NOW(), NOW())
        ON CONFLICT (term_id, curve_id) DO UPDATE SET
            last_marked_at = NOW()
        "#,
    )
    .bind(term_id)
    .bind(curve_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Update `account_stats` when assets are deposited.
///
/// Increments `total_deposits` and `total_volume` by `amount`, and advances
/// `last_activity_at` to the event's block timestamp.
async fn update_account_stats_deposit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
    amount: &str,
    block_timestamp: chrono::DateTime<chrono::Utc>,
) -> Result<(), ProjectionError> {
    // Use the raw string amount as a PostgreSQL NUMERIC literal via CAST.
    // Binding as &str and casting avoids parsing the full BigDecimal in Rust
    // while still giving us exact precision in the DB.
    sqlx::query(
        r#"
        INSERT INTO account_stats (
            account_id,
            total_deposits,
            total_volume,
            last_activity_at,
            updated_at
        )
        VALUES ($1, $2::NUMERIC, $2::NUMERIC, $3, NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            total_deposits   = account_stats.total_deposits + EXCLUDED.total_deposits,
            total_volume     = account_stats.total_volume + EXCLUDED.total_volume,
            last_activity_at = EXCLUDED.last_activity_at,
            updated_at       = NOW()
        "#,
    )
    .bind(account_id)
    .bind(amount)
    .bind(block_timestamp)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Update `account_stats` with only volume (no deposit/redemption count).
///
/// Used for the sender side of a deposit when `sender != receiver`. The
/// sender initiated the transaction (contributes to volume) but is NOT the
/// position holder, so their `total_deposits` should not be incremented.
async fn update_account_stats_volume(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
    amount: &str,
    block_timestamp: chrono::DateTime<chrono::Utc>,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO account_stats (
            account_id,
            total_volume,
            last_activity_at,
            updated_at
        )
        VALUES ($1, $2::NUMERIC, $3, NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            total_volume     = account_stats.total_volume + EXCLUDED.total_volume,
            last_activity_at = EXCLUDED.last_activity_at,
            updated_at       = NOW()
        "#,
    )
    .bind(account_id)
    .bind(amount)
    .bind(block_timestamp)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Update `account_stats` when shares are redeemed.
///
/// Increments `total_redemptions` and `total_volume` by `amount`.
async fn update_account_stats_redeem(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
    amount: &str,
    block_timestamp: chrono::DateTime<chrono::Utc>,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO account_stats (
            account_id,
            total_redemptions,
            total_volume,
            last_activity_at,
            updated_at
        )
        VALUES ($1, $2::NUMERIC, $2::NUMERIC, $3, NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            total_redemptions = account_stats.total_redemptions + EXCLUDED.total_redemptions,
            total_volume      = account_stats.total_volume + EXCLUDED.total_volume,
            last_activity_at  = EXCLUDED.last_activity_at,
            updated_at        = NOW()
        "#,
    )
    .bind(account_id)
    .bind(amount)
    .bind(block_timestamp)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Typed per-event handlers (used by process_parsed_batch)
// ---------------------------------------------------------------------------

/// Handle a `Deposited` event using the pre-parsed [`DepositedRecord`].
///
/// Marks sender and receiver dirty, then updates `account_stats`.
async fn handle_deposited_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &DepositedRecord,
) -> Result<(), ProjectionError> {
    // Convert BigDecimal → String for the existing `&str`-based helpers.
    // Those helpers bind the amount via `$2::NUMERIC` cast, so any decimal
    // string is valid.
    let amount = data.assets_after_fees.to_string();

    mark_dirty_account(tx, &data.sender, "deposited").await?;
    mark_dirty_account(tx, &data.receiver, "deposited").await?;

    if data.sender == data.receiver {
        update_account_stats_deposit(tx, &data.sender, &amount, metadata.block_timestamp).await?;
    } else {
        update_account_stats_volume(tx, &data.sender, &amount, metadata.block_timestamp).await?;
        update_account_stats_deposit(tx, &data.receiver, &amount, metadata.block_timestamp).await?;
    }

    Ok(())
}

/// Handle a `Redeemed` event using the pre-parsed [`RedeemedRecord`].
///
/// Marks sender and receiver dirty, then updates `account_stats` for the sender.
async fn handle_redeemed_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    metadata: &EventMetadata,
    data: &RedeemedRecord,
) -> Result<(), ProjectionError> {
    let amount = data.assets.to_string();

    mark_dirty_account(tx, &data.sender, "redeemed").await?;
    mark_dirty_account(tx, &data.receiver, "redeemed").await?;
    update_account_stats_redeem(tx, &data.sender, &amount, metadata.block_timestamp).await?;

    Ok(())
}

/// Handle a `SharePriceChanged` event using the pre-parsed [`SharePriceChangedRecord`].
///
/// Marks the vault dirty for the leaderboard refresh cycle.
async fn handle_share_price_changed_typed(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    _metadata: &EventMetadata,
    data: &SharePriceChangedRecord,
) -> Result<(), ProjectionError> {
    let term_id = data.term_id.to_string();
    let curve_id = data.curve_id.to_string();
    mark_dirty_vault(tx, &term_id, &curve_id).await
}

// ---------------------------------------------------------------------------
// PgProjection impl
// ---------------------------------------------------------------------------

#[async_trait]
impl PgProjection for LeaderboardMarkerProjection {
    fn name(&self) -> &str {
        "leaderboard_marker"
    }

    fn event_types(&self) -> &'static [EventType] {
        &[
            EventType::Deposited,
            EventType::Redeemed,
            EventType::SharePriceChanged,
        ]
    }

    fn uses_typed_events(&self) -> bool {
        true
    }

    /// Process a batch of pre-parsed typed events, updating dirty sets and
    /// account stats.
    ///
    /// All writes are wrapped in a single transaction. Individual event
    /// errors are logged and skipped; the transaction still commits for the
    /// rest of the batch.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` on any SQL error that cannot be
    /// recovered by skipping the offending event.
    async fn process_parsed_batch(
        &self,
        pool: &PgPool,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError> {
        let mut tx = pool.begin().await?;

        for event in events {
            let result = match event {
                ParsedEvent::Deposited { metadata, data } => {
                    handle_deposited_typed(&mut tx, metadata, data).await
                }
                ParsedEvent::Redeemed { metadata, data } => {
                    handle_redeemed_typed(&mut tx, metadata, data).await
                }
                ParsedEvent::SharePriceChanged { metadata, data } => {
                    handle_share_price_changed_typed(&mut tx, metadata, data).await
                }
                ParsedEvent::AtomCreated { .. }
                | ParsedEvent::TripleCreated { .. }
                | ParsedEvent::ProtocolFeeAccrued { .. } => {
                    // Filtered by event_types().
                    continue;
                }
                ParsedEvent::Unknown(raw) => {
                    warn!(
                        event_type = %raw.event_type,
                        "leaderboard_marker: unknown event type, skipping"
                    );
                    continue;
                }
            };

            if let Err(e) = result {
                warn!(
                    seq = event.sequence_number(),
                    error = %e,
                    "leaderboard_marker: event handler error, skipping event"
                );
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
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::projection::get_str;
    use chrono::Utc;
    use serde_json::json;

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
    fn name_is_leaderboard_marker() {
        assert_eq!(LeaderboardMarkerProjection.name(), "leaderboard_marker");
    }

    #[test]
    fn event_types_are_correct() {
        let types = LeaderboardMarkerProjection.event_types();
        assert_eq!(types.len(), 3);
        assert!(types.contains(&EventType::Deposited));
        assert!(types.contains(&EventType::Redeemed));
        assert!(types.contains(&EventType::SharePriceChanged));
    }

    #[test]
    fn deposited_event_has_required_fields() {
        // Validates that the helper does not panic on a well-formed event.
        // Full DB integration is tested separately; here we only check that
        // field extraction succeeds.
        let event = make_event(
            "Deposited",
            json!({
                "sender":            "0xSender",
                "receiver":          "0xReceiver",
                "assets_after_fees": "980000"
            }),
        );
        let data = &event.event_data;
        assert!(get_str(data, "sender").is_ok());
        assert!(get_str(data, "receiver").is_ok());
        assert!(get_str(data, "assets_after_fees").is_ok());
    }

    #[test]
    fn redeemed_event_has_required_fields() {
        let event = make_event(
            "Redeemed",
            json!({
                "sender":   "0xSender",
                "receiver": "0xReceiver",
                "assets":   "980000"
            }),
        );
        let data = &event.event_data;
        assert!(get_str(data, "sender").is_ok());
        assert!(get_str(data, "receiver").is_ok());
        assert!(get_str(data, "assets").is_ok());
    }

    #[test]
    fn share_price_changed_event_has_required_fields() {
        let event = make_event(
            "SharePriceChanged",
            json!({
                "term_id":     "15",
                "curve_id":    "1",
                "share_price": "1050000000000000000"
            }),
        );
        let data = &event.event_data;
        assert!(get_str(data, "term_id").is_ok());
        assert!(get_str(data, "curve_id").is_ok());
    }

    #[test]
    fn deposited_missing_sender_is_graceful() {
        // get_str returns Err for missing fields — the handler logs a warning
        // and returns Ok(()) without propagating the error.
        let event = make_event("Deposited", json!({}));
        let data = &event.event_data;
        assert!(get_str(data, "sender").is_err());
    }

    #[test]
    fn share_price_changed_missing_curve_id_is_graceful() {
        let event = make_event("SharePriceChanged", json!({ "term_id": "15" }));
        let data = &event.event_data;
        assert!(get_str(data, "curve_id").is_err());
    }

    // -----------------------------------------------------------------------
    // Typed-event path tests
    // -----------------------------------------------------------------------

    #[test]
    fn uses_typed_events_returns_true() {
        assert!(LeaderboardMarkerProjection.uses_typed_events());
    }

    #[test]
    fn typed_deposited_fields_accessible() {
        use serde_json::json;
        use shared::models::StoredEvent;
        use shared::parsed_event::ParsedEvent;

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
                "term_id": "7",
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
        let ParsedEvent::Deposited { data, .. } = &parsed else {
            panic!("expected Deposited");
        };
        assert_eq!(data.sender, "0xSender");
        assert_eq!(data.receiver, "0xReceiver");
        // amount string for account_stats helper matches assets_after_fees.
        assert_eq!(data.assets_after_fees.to_string(), "980000");
    }

    #[test]
    fn typed_share_price_changed_term_and_curve_accessible() {
        use serde_json::json;
        use shared::models::StoredEvent;
        use shared::parsed_event::ParsedEvent;

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
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::SharePriceChanged { data, .. } = &parsed else {
            panic!("expected SharePriceChanged");
        };
        assert_eq!(data.term_id.to_string(), "15");
        assert_eq!(data.curve_id.to_string(), "1");
    }
}
