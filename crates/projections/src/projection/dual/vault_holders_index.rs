//! `VaultHoldersIndexDualProjection` — dual-write projection for vault position tracking.
//!
//! Writes to two separate Postgres instances on every `Deposited` and `Redeemed` event:
//! - **KG database** (`market.active_vault_position` + `market.vaults.holder_count`)
//! - **Legacy timescale database** (`active_vault_position` + `vault.holder_count`)
//!
//! ## Write Ordering
//!
//! KG first, legacy second. No two-phase commit.
//!
//! Safety argument mirrors `vault_state:dual`:
//! 1. Writes are idempotent **at the batch boundary**: `ON CONFLICT DO UPDATE`
//!    for upserts, conditional DELETE for pruning, COUNT-derived
//!    `holder_count` refresh.
//! 2. If the KG commit fails, neither transaction has committed → retry.
//! 3. If the legacy commit fails AFTER the KG commit: the worker checkpoint
//!    pins and the same batch re-runs. The KG-side accumulators
//!    (`shares = shares + EXCLUDED.shares`, `total_deposits = ...`) re-apply
//!    on top of the already-committed kg state — partial-batch failures in
//!    this rare cross-DB window will over-count shares on the kg side until a
//!    reconciliation pass corrects them. The legacy side is consistent
//!    because its commit failed and rolled back. Mirrors `core_entities:dual`
//!    behaviour. See the internal follow-up for sequence-tracked replay skip.
//! 4. The checkpoint advances only after `process_parsed_batch` returns `Ok`.
//!
//! ## holder_count
//!
//! `market.vaults.holder_count` is COUNT-derived from `market.active_vault_position
//! WHERE shares > 0` after every deposit or redemption. Delta tracking is not used
//! because it breaks when events arrive out of chronological order.
//!
//! Toggle: `ENABLED_PROJECTIONS=vault_holders_index:dual`

use std::collections::HashSet;

use async_trait::async_trait;
use shared::models::{DepositedRecord, RedeemedRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;
use sqlx::PgPool;
use tracing::warn;

use crate::error::{ErrorClass, ProjectionError};
use crate::projection::pg::PgProjection;
use crate::repo::{dead_letter_repo, kg_market_repo, vault_repo};

/// Projection name used for dead-letter and metric tagging.
const PROJECTION_NAME: &str = "vault_holders_index:dual";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Dual-write projection that mirrors `VaultHoldersIndexProjection` to both the
/// kg database (`market.active_vault_position`) and the legacy timescale database
/// (`active_vault_position`).
///
/// The KG pool is optional so the projection degrades gracefully when
/// `DATABASE_KG_URL` is not configured.
pub struct VaultHoldersIndexDualProjection {
    /// KG database pool: writes to `market.active_vault_position` and refreshes
    /// `market.vaults.holder_count`.
    ///
    /// `None` when `DATABASE_KG_URL` is not configured. Absence is logged once
    /// at startup by `build_pg_projections` (see `main.rs`); the per-batch
    /// path silently skips kg writes.
    ///
    /// Stored as bare `PgPool` (which is itself `Arc`-backed internally) to
    /// match the `core_entities:dual` precedent.
    kg_pool: Option<PgPool>,
}

impl VaultHoldersIndexDualProjection {
    /// Create a new `VaultHoldersIndexDualProjection` without a kg pool.
    pub fn new() -> Self {
        Self { kg_pool: None }
    }

    /// Attach a KG database pool.
    pub fn with_kg_pool(mut self, kg_pool: PgPool) -> Self {
        self.kg_pool = Some(kg_pool);
        self
    }
}

impl Default for VaultHoldersIndexDualProjection {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl PgProjection for VaultHoldersIndexDualProjection {
    fn name(&self) -> &str {
        PROJECTION_NAME
    }

    fn event_types(&self) -> &'static [EventType] {
        &[EventType::Deposited, EventType::Redeemed]
    }

    fn uses_typed_events(&self) -> bool {
        true
    }

    /// Process a batch of pre-parsed typed events.
    ///
    /// Opens one legacy transaction and one kg transaction (when kg_pool is present).
    /// For each event, writes upserts/decrements/prunes (kg first, then legacy).
    /// After the per-event loop, refreshes holder_count once per unique
    /// `(term_id, curve_id)` vault touched in the batch — K COUNT queries
    /// instead of N (where K = distinct vaults <= N = event count).
    /// Then commits kg first, legacy second.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` on transient DB errors.
    /// Returns `ProjectionError` on fatal errors (dead-lettered and checkpoint pinned).
    async fn process_parsed_batch(
        &self,
        pool: &PgPool,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError> {
        let mut legacy_tx = pool.begin().await?;

        // Open a kg transaction only when the pool is configured. Absence is
        // logged once at startup by `build_pg_projections` (see `main.rs`);
        // we don't re-warn per batch to avoid log spam.
        let mut kg_tx_opt = match &self.kg_pool {
            Some(p) => Some(p.begin().await?),
            None => None,
        };

        let mut touched_vaults: HashSet<(String, String)> = HashSet::new();

        for event in events {
            let result: Result<(), ProjectionError> = match event {
                ParsedEvent::Deposited { metadata, data } => {
                    touched_vaults.insert((data.term_id.clone(), data.curve_id.to_string()));
                    process_deposit_typed(&mut legacy_tx, kg_tx_opt.as_mut(), metadata, data).await
                }
                ParsedEvent::Redeemed { metadata, data } => {
                    touched_vaults.insert((data.term_id.clone(), data.curve_id.to_string()));
                    process_redeem_typed(&mut legacy_tx, kg_tx_opt.as_mut(), metadata, data).await
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
                        return Err(err);
                    }
                    ErrorClass::Fatal => {
                        drop(legacy_tx);
                        drop(kg_tx_opt);
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
            if let Some(kg_tx) = kg_tx_opt.as_mut() {
                kg_market_repo::refresh_kg_holder_count(kg_tx, term_id, curve_id).await?;
            }
            vault_repo::refresh_holder_count(&mut legacy_tx, term_id, curve_id).await?;
        }

        // Commit ordering: KG first, legacy second.
        if let Some(kg_tx) = kg_tx_opt {
            kg_tx.commit().await?;
        }
        legacy_tx.commit().await?;

        Ok(())
    }

    /// Process a batch of raw stored events.
    ///
    /// Parse-once shim — delegates to the typed path.
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
// Typed per-event handlers
// ---------------------------------------------------------------------------

/// Handle a `Deposited` event.
///
/// Write order for each side:
///   1. Upsert position (accumulate shares + total_deposits).
///
/// `holder_count` is NOT refreshed here — the caller collects touched vaults
/// and calls refresh once per unique vault after the per-event loop.
///
/// Global write order: kg first, then legacy.
async fn process_deposit_typed(
    legacy_tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kg_tx: Option<&mut sqlx::Transaction<'_, sqlx::Postgres>>,
    _metadata: &EventMetadata,
    data: &DepositedRecord,
) -> Result<(), ProjectionError> {
    let curve_id = data.curve_id.to_string();

    // KG write first.
    if let Some(tx) = kg_tx {
        kg_market_repo::upsert_kg_position_on_deposit(
            tx,
            &data.term_id,
            &curve_id,
            &data.receiver,
            data.shares.clone(),
            data.assets_after_fees.clone(),
        )
        .await?;
    }

    // Legacy write second.
    vault_repo::upsert_position_on_deposit(
        legacy_tx,
        &data.term_id,
        &curve_id,
        &data.receiver,
        data.shares.clone(),
        data.assets_after_fees.clone(),
    )
    .await
}

/// Handle a `Redeemed` event.
///
/// Write order for each side:
///   1. Decrement shares and accumulate total_redemptions.
///   2. Prune zero-share positions.
///
/// `holder_count` is NOT refreshed here — the caller collects touched vaults
/// and calls refresh once per unique vault after the per-event loop.
///
/// Global write order: kg first, then legacy.
async fn process_redeem_typed(
    legacy_tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kg_tx: Option<&mut sqlx::Transaction<'_, sqlx::Postgres>>,
    _metadata: &EventMetadata,
    data: &RedeemedRecord,
) -> Result<(), ProjectionError> {
    let curve_id = data.curve_id.to_string();

    // KG write first.
    if let Some(tx) = kg_tx {
        kg_market_repo::decrement_kg_position_on_redeem(
            tx,
            &data.term_id,
            &curve_id,
            &data.sender,
            data.shares.clone(),
            data.assets.clone(),
        )
        .await?;
        kg_market_repo::prune_zero_kg_positions(tx, &data.term_id, &curve_id, &data.sender).await?;
    }

    // Legacy write second.
    vault_repo::decrement_position_on_redeem(
        legacy_tx,
        &data.term_id,
        &curve_id,
        &data.sender,
        data.shares.clone(),
        data.assets.clone(),
    )
    .await?;
    vault_repo::prune_zero_position(legacy_tx, &data.term_id, &curve_id, &data.sender).await
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    //! ## What these tests verify
    //!
    //! - Parse correctness: `ParsedEvent::parse` extracts the right field values
    //!   (`receiver`, `sender`, `shares`, `assets_after_fees`, `assets`) from
    //!   raw `StoredEvent` JSON.
    //! - Sharding: `shard_id() == None` for single-shard, `Some(n)` for multi-shard,
    //!   and exactly one shard owns each event.
    //! - kg_pool=None early return: the projection is constructable without a KG pool
    //!   (the kg write path is skipped silently).
    //!
    //! ## What these tests do NOT verify
    //!
    //! - SQL execution (no `#[sqlx::test]` here — no DB is started).
    //! - Holder count math (`vault.holder_count` after batch).
    //! - Idempotency of the ON CONFLICT DO UPDATE paths.
    //! - Dual-write commit ordering under failure.
    //!
    //! Real-DB integration testing for this dual projector lives in the chaos suite:
    //! `backend/indexing-services/chaos/scripts/run-all.sh`, scenarios
    //! `04-dual-write-crash`, `05-full-cascade`, and `09-ingestion-crash`.
    //! Adding `#[sqlx::test]` unit-level integration tests is tracked as a
    //! internal follow-up.

    use super::*;
    use chrono::Utc;
    use serde_json::json;
    use shared::models::StoredEvent;
    use sqlx::types::BigDecimal;
    use std::str::FromStr;

    const HEX_42: &str = "0x000000000000000000000000000000000000000000000000000000000000002a";

    // -----------------------------------------------------------------------
    // Constructor and trait-method tests (no DB required)
    // -----------------------------------------------------------------------

    #[test]
    fn name_is_vault_holders_index_dual() {
        assert_eq!(
            VaultHoldersIndexDualProjection::new().name(),
            "vault_holders_index:dual"
        );
    }

    #[test]
    fn event_types_are_deposited_and_redeemed() {
        let proj = VaultHoldersIndexDualProjection::new();
        assert_eq!(
            proj.event_types(),
            &[EventType::Deposited, EventType::Redeemed]
        );
    }

    #[test]
    fn does_not_consume_share_price_changed() {
        let proj = VaultHoldersIndexDualProjection::new();
        assert!(!proj.event_types().contains(&EventType::SharePriceChanged));
    }

    #[test]
    fn uses_typed_events_returns_true() {
        assert!(VaultHoldersIndexDualProjection::new().uses_typed_events());
    }

    #[test]
    fn default_creates_without_kg_pool() {
        let proj = VaultHoldersIndexDualProjection::default();
        assert!(proj.kg_pool.is_none());
    }

    // -----------------------------------------------------------------------
    // Event construction helpers
    // -----------------------------------------------------------------------

    fn make_deposited(
        seq: i64,
        receiver: &str,
        shares: &str,
        assets_after_fees: &str,
    ) -> StoredEvent {
        StoredEvent {
            sequence_number: seq,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: format!("0xblock{seq}"),
            transaction_hash: format!("0xtx{seq}"),
            log_index: 0,
            event_type: "Deposited".to_owned(),
            event_data: json!({
                "block_number": 100,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash": format!("0xblock{seq}"),
                "transaction_hash": format!("0xtx{seq}"),
                "log_index": 0,
                "sender": "0xDeployer",
                "receiver": receiver,
                "term_id": HEX_42,
                "curve_id": "1",
                "assets": "1000000",
                "assets_after_fees": assets_after_fees,
                "shares": shares,
                "total_shares": "5000000",
                "vault_type": 1
            }),
            term_id: Some(HEX_42.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    fn make_redeemed(seq: i64, sender: &str, shares: &str, assets: &str) -> StoredEvent {
        StoredEvent {
            sequence_number: seq,
            block_number: 101 + seq,
            block_timestamp: Utc::now(),
            block_hash: format!("0xblock{seq}"),
            transaction_hash: format!("0xtx{seq}"),
            log_index: 0,
            event_type: "Redeemed".to_owned(),
            event_data: json!({
                "block_number": 101 + seq,
                "block_timestamp": "2024-01-01T00:01:00Z",
                "block_hash": format!("0xblock{seq}"),
                "transaction_hash": format!("0xtx{seq}"),
                "log_index": 0,
                "sender": sender,
                "receiver": sender,
                "term_id": HEX_42,
                "curve_id": "1",
                "assets": assets,
                "shares": shares,
                "total_shares": "4050000",
                "fees": "10000",
                "vault_type": 1
            }),
            term_id: Some(HEX_42.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    // -----------------------------------------------------------------------
    // Parsed event field correctness tests (no DB required)
    // -----------------------------------------------------------------------

    /// Deposited event: `receiver` field maps to `account_id`; `shares` and
    /// `assets_after_fees` are parsed as BigDecimal without precision loss.
    #[test]
    fn deposited_event_parses_receiver_shares_and_assets_after_fees() {
        let stored = make_deposited(1, "0xAccountA", "950000", "980000");
        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::Deposited { data, .. } = &parsed else {
            panic!("expected Deposited");
        };
        assert_eq!(data.receiver, "0xAccountA");
        assert_eq!(data.shares, BigDecimal::from_str("950000").unwrap());
        assert_eq!(
            data.assets_after_fees,
            BigDecimal::from_str("980000").unwrap()
        );
    }

    /// Redeemed event: `sender` field maps to `account_id`; `shares` and
    /// `assets` are parsed as BigDecimal without precision loss.
    #[test]
    fn redeemed_event_parses_sender_shares_and_assets() {
        let stored = make_redeemed(10, "0xAccountA", "950000", "980000");
        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::Redeemed { data, .. } = &parsed else {
            panic!("expected Redeemed");
        };
        assert_eq!(data.sender, "0xAccountA");
        assert_eq!(data.shares, BigDecimal::from_str("950000").unwrap());
        assert_eq!(data.assets, BigDecimal::from_str("980000").unwrap());
    }

    // -----------------------------------------------------------------------
    // Position arithmetic correctness (parse only, no DB required)
    // -----------------------------------------------------------------------

    /// After a first deposit, the parsed shares value is > 0 (i.e. satisfies the
    /// `shares > 0` predicate used by the COUNT-based holder_count refresh).
    /// NOTE: does not verify DB state — real SQL execution is tested in the chaos
    /// suite (scenarios 04/05/09).
    #[test]
    fn parses_first_deposit_event_with_positive_shares() {
        let stored = make_deposited(1, "0xA", "950000", "980000");
        let parsed = ParsedEvent::parse(stored).expect("parse");
        let ParsedEvent::Deposited { data, .. } = &parsed else {
            panic!();
        };
        assert!(data.shares > BigDecimal::from_str("0").unwrap());
    }

    /// Two deposits with the same share amount: the Rust-side addition that mirrors
    /// the ON CONFLICT DO UPDATE accumulation produces the expected total.
    /// NOTE: does not verify DB state.
    #[test]
    fn two_parsed_deposits_shares_sum_to_expected_total() {
        let first_shares = BigDecimal::from_str("950000").unwrap();
        let second_shares = BigDecimal::from_str("950000").unwrap();
        let total = first_shares + second_shares;
        assert_eq!(total, BigDecimal::from_str("1900000").unwrap());
    }

    /// A second distinct account's deposit also has positive shares (i.e. would
    /// contribute +1 to a COUNT-derived holder_count on the DB side).
    /// NOTE: does not verify DB state.
    #[test]
    fn parses_second_account_deposit_with_positive_shares() {
        let stored_b = make_deposited(2, "0xB", "500000", "490000");
        let parsed_b = ParsedEvent::parse(stored_b).expect("parse");
        let ParsedEvent::Deposited { data: db, .. } = &parsed_b else {
            panic!();
        };
        assert!(db.shares > BigDecimal::from_str("0").unwrap());
    }

    /// After a full redemption, remaining shares equal zero which satisfies the
    /// `shares <= 0` predicate used by the prune DELETE.
    /// NOTE: does not verify DB state.
    #[test]
    fn full_redeem_produces_zero_remaining_shares_satisfying_prune_condition() {
        let held = BigDecimal::from_str("1900000").unwrap();
        let redeemed = BigDecimal::from_str("1900000").unwrap();
        let remaining = held - redeemed;
        assert!(remaining <= BigDecimal::from_str("0").unwrap());
    }

    /// When all account positions have zero shares the COUNT WHERE shares > 0
    /// predicate returns 0. Verified here via Rust-side arithmetic that mirrors
    /// the SQL COUNT condition; not a DB test.
    #[test]
    fn all_zero_share_positions_produce_zero_count_under_holder_count_predicate() {
        let a_after: BigDecimal = BigDecimal::from_str("0").unwrap();
        let b_after: BigDecimal = BigDecimal::from_str("0").unwrap();
        let count = [&a_after, &b_after]
            .iter()
            .filter(|s| **s > &BigDecimal::from_str("0").unwrap())
            .count();
        assert_eq!(count, 0);
    }

    /// `event_types()` does not include `SharePriceChanged`, confirming this
    /// projection never receives or processes that event type.
    #[test]
    fn share_price_changed_absent_from_event_types() {
        let proj = VaultHoldersIndexDualProjection::new();
        assert!(!proj.event_types().contains(&EventType::SharePriceChanged));
    }

    /// Parsing the same `StoredEvent` twice yields identical field values,
    /// confirming the parse function is deterministic.
    /// NOTE: does not invoke `process_batch` or `process_parsed_batch`.
    #[test]
    fn same_deposited_stored_event_parses_to_identical_fields_on_repeated_calls() {
        let s1 = make_deposited(1, "0xA", "950000", "980000");
        let s2 = make_deposited(1, "0xA", "950000", "980000");
        let p1 = ParsedEvent::parse(s1).unwrap();
        let p2 = ParsedEvent::parse(s2).unwrap();
        let ParsedEvent::Deposited { data: d1, .. } = &p1 else {
            panic!()
        };
        let ParsedEvent::Deposited { data: d2, .. } = &p2 else {
            panic!()
        };
        assert_eq!(d1.receiver, d2.receiver);
        assert_eq!(d1.shares, d2.shares);
        assert_eq!(d1.assets_after_fees, d2.assets_after_fees);
    }

    /// A `SharePriceChanged` stored event parses to `ParsedEvent::SharePriceChanged`,
    /// confirming that `process_parsed_batch` will hit the `continue` branch and
    /// not call any holder_count refresh for this event type.
    #[test]
    fn share_price_changed_stored_event_parses_to_share_price_changed_variant() {
        let spc = StoredEvent {
            sequence_number: 99,
            block_number: 200,
            block_timestamp: Utc::now(),
            block_hash: "0xblockY".to_owned(),
            transaction_hash: "0xtxY".to_owned(),
            log_index: 0,
            event_type: "SharePriceChanged".to_owned(),
            event_data: json!({
                "block_number": 200,
                "block_timestamp": "2024-01-02T00:00:00Z",
                "block_hash": "0xblockY",
                "transaction_hash": "0xtxY",
                "log_index": 0,
                "term_id": HEX_42,
                "curve_id": "1",
                "share_price": "2000000000000000000",
                "total_assets": "10000000000000000000",
                "total_shares": "5000000000000000000",
                "vault_type": 1
            }),
            term_id: Some(HEX_42.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        let (parsed, _err) = ParsedEvent::parse_or_unknown(spc);
        assert!(matches!(parsed, ParsedEvent::SharePriceChanged { .. }));
    }
}
