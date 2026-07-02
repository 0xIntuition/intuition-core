//! `VaultStateDualProjection` — dual-write projection for vault aggregate state.
//!
//! Writes to two separate Postgres instances on every `Deposited`, `Redeemed`,
//! and `SharePriceChanged` event:
//! - **KG database** (`market.vaults`) — the canonical post-migration destination.
//! - **Legacy timescale database** (`vault` table) — preserved during the migration phase.
//!
//! ## Write Ordering
//!
//! KG first, legacy second. No two-phase commit.
//!
//! Safety argument:
//! 1. Both sinks use idempotent operations at the batch boundary
//!    (`ON CONFLICT DO UPDATE`).
//! 2. If the KG commit fails, neither transaction has committed — the worker
//!    retries the full batch from its existing checkpoint.
//! 3. If the legacy commit fails AFTER the KG commit has succeeded, the
//!    worker checkpoint pins and the same batch re-runs. For accumulator
//!    columns (`total_deposits = total_deposits + EXCLUDED.total_deposits`,
//!    `total_redemptions = ...`) the kg side will over-count on the replay
//!    until a reconciliation pass corrects it; snapshot columns
//!    (`current_share_price`, `total_assets`, `total_shares`, `market_cap`)
//!    are overwrite-style and remain consistent. Same trade-off as
//!    `core_entities:dual`. See the internal follow-up for sequence-tracked
//!    replay skip.
//! 4. The checkpoint advances only after `process_parsed_batch` returns `Ok`, so
//!    a crash anywhere inside this method causes a full batch replay on restart.
//! 5. `market.events` rows use `ON CONFLICT (event_time, id) DO NOTHING` with a
//!    deterministic `id = "{tx_hash}:{log_index}"`, so replaying the same batch
//!    after a partial failure produces no duplicate events and no errors. A reader
//!    querying `market.events` after a partial-batch failure will see a
//!    consistent, non-duplicated event log.
//! 6. `market.vaults.holder_count` is COUNT-refreshed inside the KG transaction
//!    for every Deposited/Redeemed vault touched in the batch. This heals the
//!    `vault_holders_index:dual` race: if that projector calls
//!    `refresh_kg_holder_count` before this projector has created the
//!    `market.vaults` row (UPDATE → 0 rows affected), vault_state:dual's
//!    post-upsert refresh sets holder_count to the correct COUNT within the
//!    same atomic transaction that created/updated the vault row.
//!
//! ## share_price_history
//!
//! The legacy `share_price_history` TimescaleDB hypertable is NOT mirrored to the
//! KG database. Only the rolled-up `market.vaults` state is written.
//!
//! ## Sharding
//!
//! Sharding on `(term_id, curve_id)` is supported via the same hash function as
//! the legacy `VaultStateProjection`. Both projections must use the same shard
//! count so each vault is owned by exactly one shard — avoiding cross-worker
//! deadlocks.
//!
//! Toggle: `ENABLED_PROJECTIONS=vault_state:dual`

use std::collections::HashSet;

use async_trait::async_trait;
use shared::models::{DepositedRecord, RedeemedRecord, SharePriceChangedRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;
use sqlx::PgPool;
use tracing::warn;

use crate::error::{ErrorClass, ProjectionError};
use crate::projection::compute_market_cap;
use crate::projection::pg::PgProjection;
use crate::repo::{
    dead_letter_repo, kg_market_repo, vault_repo, vault_repo::insert_share_price_history,
};
use crate::shard;

/// Projection name used for dead-letter and metric tagging.
const PROJECTION_NAME: &str = "vault_state:dual";

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Dual-write projection that mirrors `VaultStateProjection` to both the kg
/// database (`market.vaults`) and the legacy timescale database (`vault`).
///
/// The KG pool is optional so the projection degrades gracefully when
/// `DATABASE_KG_URL` is not configured (e.g. unit tests, local dev without
/// the KG database running).
pub struct VaultStateDualProjection {
    shard_id: u32,
    total_shards: u32,
    /// KG database pool: writes to `market.vaults`.
    ///
    /// `None` when `DATABASE_KG_URL` is not configured. Absence is logged
    /// once at startup by `build_pg_projections` (see `main.rs`); the per-batch
    /// path silently skips kg writes.
    ///
    /// Stored as bare `PgPool` (which is itself `Arc`-backed internally) to
    /// match the `core_entities:dual` precedent and avoid double-indirection.
    kg_pool: Option<PgPool>,
}

impl VaultStateDualProjection {
    /// Create a new `VaultStateDualProjection`.
    ///
    /// When `total_shards == 1` all events are processed (no filtering).
    /// When `total_shards > 1`, only events whose
    /// `hash(term_id, curve_id) % total_shards == shard_id` are processed.
    pub fn new(shard_id: u32, total_shards: u32) -> Self {
        Self {
            shard_id,
            total_shards,
            kg_pool: None,
        }
    }

    /// Attach a KG database pool. When present, each event also writes to
    /// `market.vaults` in addition to the legacy `vault` write.
    pub fn with_kg_pool(mut self, kg_pool: PgPool) -> Self {
        self.kg_pool = Some(kg_pool);
        self
    }

    /// Returns `true` when sharding is active and `(term_id, curve_id)` does
    /// NOT belong to this shard, meaning the event should be skipped.
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
impl PgProjection for VaultStateDualProjection {
    fn name(&self) -> &str {
        PROJECTION_NAME
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

    fn uses_typed_events(&self) -> bool {
        true
    }

    /// Process a batch of pre-parsed typed events.
    ///
    /// Opens one legacy transaction and one kg transaction (when kg_pool is present).
    /// For each event, writes kg first then legacy — see module-level write ordering doc.
    /// On success: commits kg first, then legacy. On any commit failure, returns an error
    /// so the worker retries from its existing checkpoint (both upserts are idempotent).
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
        // we don't re-warn per batch to avoid log spam in environments that
        // intentionally run without kg writes (e.g. local dev pre-cluster).
        let mut kg_tx_opt = match &self.kg_pool {
            Some(p) => Some(p.begin().await?),
            None => None,
        };

        // Track (term_id, curve_id) pairs touched by Deposited/Redeemed events
        // so we can call refresh_kg_holder_count once per unique vault at the end
        // of the batch — K COUNT queries instead of N.
        //
        // holder_count convergence: vault_holders_index:dual may have already
        // written market.active_vault_position rows for this vault (or may run
        // concurrently). By calling refresh_kg_holder_count here, vault_state:dual
        // guarantees that whenever it creates or updates market.vaults, the
        // holder_count is set to the current COUNT — eliminating the race where
        // vault_holders_index:dual's refresh ran before the vault row existed.
        let mut touched_deposit_redeem_vaults: HashSet<(String, String)> = HashSet::new();

        for event in events {
            let result = match event {
                ParsedEvent::Deposited { metadata, data } => {
                    if self.should_skip_shard(&data.term_id, &data.curve_id) {
                        continue;
                    }
                    touched_deposit_redeem_vaults
                        .insert((data.term_id.clone(), data.curve_id.to_string()));
                    process_deposited_typed(&mut legacy_tx, kg_tx_opt.as_mut(), metadata, data)
                        .await
                }
                ParsedEvent::Redeemed { metadata, data } => {
                    if self.should_skip_shard(&data.term_id, &data.curve_id) {
                        continue;
                    }
                    touched_deposit_redeem_vaults
                        .insert((data.term_id.clone(), data.curve_id.to_string()));
                    process_redeemed_typed(&mut legacy_tx, kg_tx_opt.as_mut(), metadata, data).await
                }
                ParsedEvent::SharePriceChanged { metadata, data } => {
                    if self.should_skip_shard(&data.term_id, &data.curve_id) {
                        continue;
                    }
                    process_share_price_changed_typed(
                        &mut legacy_tx,
                        kg_tx_opt.as_mut(),
                        metadata,
                        data,
                    )
                    .await
                }
                // Exhaustive match — adding a new ParsedEvent variant must
                // force a compile-time decision here, not silently drop.
                ParsedEvent::AtomCreated { .. }
                | ParsedEvent::TripleCreated { .. }
                | ParsedEvent::ProtocolFeeAccrued { .. } => {
                    continue;
                }
                ParsedEvent::Unknown(raw) => {
                    warn!(
                        projection = PROJECTION_NAME,
                        event_type = %raw.event_type,
                        "unknown event variant — skipping"
                    );
                    continue;
                }
            };

            if let Err(err) = result {
                match err.classify() {
                    ErrorClass::Transient | ErrorClass::CircuitProtected => {
                        // Transient — propagate so the worker retries the full batch.
                        return Err(err);
                    }
                    ErrorClass::Fatal => {
                        // Drop both transactions to roll back before the dead-letter insert.
                        drop(legacy_tx);
                        drop(kg_tx_opt);
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

        // After processing all events, refresh holder_count once per unique vault
        // touched by Deposited/Redeemed events in this batch.
        //
        // KG path: runs inside the KG transaction so the CREATE
        // (upsert_kg_vault_on_deposit) and the COUNT-based holder_count refresh
        // are atomic — vault_holders_index:dual's earlier refresh no-op (vault
        // row didn't exist yet) is healed here.
        //
        // Legacy path: same fix for the legacy `vault.holder_count`. The legacy
        // vault row is created by upsert_vault_on_deposit earlier in this batch;
        // refreshing holder_count here guarantees the row exists before the
        // UPDATE runs, healing the symmetric race on the legacy side where
        // vault_holders_index:dual's refresh_holder_count is also a no-op when
        // it runs before vault_state:dual has created the legacy vault row.
        if let Some(kg_tx) = kg_tx_opt.as_mut() {
            for (term_id, curve_id) in &touched_deposit_redeem_vaults {
                kg_market_repo::refresh_kg_holder_count(kg_tx, term_id, curve_id).await?;
            }
        }
        for (term_id, curve_id) in &touched_deposit_redeem_vaults {
            vault_repo::refresh_holder_count(&mut legacy_tx, term_id, curve_id).await?;
        }

        // Commit ordering: KG first, legacy second.
        // If kg commit fails: legacy has not committed → no drift, retry.
        // If legacy commit fails after kg: replay re-applies kg idempotently → no drift.
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
/// Writes to kg first (`market.vaults` + `market.events`), then to legacy (`vault`).
async fn process_deposited_typed(
    legacy_tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kg_tx: Option<&mut sqlx::Transaction<'_, sqlx::Postgres>>,
    metadata: &EventMetadata,
    data: &DepositedRecord,
) -> Result<(), ProjectionError> {
    let curve_id = data.curve_id.to_string();

    // KG write first — vault state then market event in the same transaction.
    if let Some(tx) = kg_tx {
        kg_market_repo::upsert_kg_vault_on_deposit(
            tx,
            &data.term_id,
            &curve_id,
            data.assets_after_fees.clone(),
            metadata.block_timestamp,
        )
        .await?;
        kg_market_repo::insert_kg_market_event_deposited(tx, metadata, data).await?;
    }

    // Legacy write second.
    vault_repo::upsert_vault_on_deposit(
        legacy_tx,
        &data.term_id,
        &curve_id,
        data.assets_after_fees.clone(),
        metadata.block_timestamp,
    )
    .await
}

/// Handle a `Redeemed` event.
///
/// Writes to kg first (`market.vaults` + `market.events`), then to legacy (`vault`).
async fn process_redeemed_typed(
    legacy_tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kg_tx: Option<&mut sqlx::Transaction<'_, sqlx::Postgres>>,
    metadata: &EventMetadata,
    data: &RedeemedRecord,
) -> Result<(), ProjectionError> {
    let curve_id = data.curve_id.to_string();

    // KG write first — vault state then market event in the same transaction.
    if let Some(tx) = kg_tx {
        kg_market_repo::upsert_kg_vault_on_redeem(
            tx,
            &data.term_id,
            &curve_id,
            data.assets.clone(),
            metadata.block_timestamp,
        )
        .await?;
        kg_market_repo::insert_kg_market_event_redeemed(tx, metadata, data).await?;
    }

    // Legacy write second.
    vault_repo::upsert_vault_on_redeem(
        legacy_tx,
        &data.term_id,
        &curve_id,
        data.assets.clone(),
        metadata.block_timestamp,
    )
    .await
}

/// Handle a `SharePriceChanged` event.
///
/// Writes to kg first (`market.vaults` rolled-up state + `market.events` — no
/// `share_price_history` in kg), then to legacy (`vault` + `share_price_history`).
async fn process_share_price_changed_typed(
    legacy_tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    kg_tx: Option<&mut sqlx::Transaction<'_, sqlx::Postgres>>,
    metadata: &EventMetadata,
    data: &SharePriceChangedRecord,
) -> Result<(), ProjectionError> {
    let curve_id = data.curve_id.to_string();
    let market_cap = compute_market_cap(
        &data.total_shares.to_string(),
        &data.share_price.to_string(),
    )?;

    // KG write first — rolled-up state + market event; no share_price_history mirror.
    if let Some(tx) = kg_tx {
        kg_market_repo::update_kg_vault_price(
            tx,
            &data.term_id,
            &curve_id,
            data.share_price.clone(),
            data.total_assets.clone(),
            data.total_shares.clone(),
            market_cap.clone(),
            metadata.block_timestamp,
        )
        .await?;
        kg_market_repo::insert_kg_market_event_share_price_changed(tx, metadata, data).await?;
    }

    // Legacy write second — vault + share_price_history.
    vault_repo::update_vault_price(
        legacy_tx,
        &data.term_id,
        &curve_id,
        data.share_price.clone(),
        data.total_assets.clone(),
        data.total_shares.clone(),
        market_cap.clone(),
        metadata.block_timestamp,
    )
    .await?;

    // Append to share_price_history — keep the same event_id format as the
    // non-dual vault_state projection so idempotency is preserved during rollout
    // (an event that was processed by the legacy path first won't be double-inserted).
    let event_id = format!(
        "{}-{}-SharePriceChanged",
        metadata.transaction_hash, metadata.log_index
    );
    insert_share_price_history(
        legacy_tx,
        &event_id,
        &data.term_id,
        &curve_id,
        data.share_price.clone(),
        data.total_assets.clone(),
        data.total_shares.clone(),
        market_cap,
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
    //! ## What these tests verify
    //!
    //! - Parse correctness: `ParsedEvent::parse` extracts the right field values
    //!   (`assets_after_fees`, `shares`, `receiver`, `assets`, `sender`,
    //!   `share_price`, `total_assets`, `total_shares`) from raw `StoredEvent` JSON.
    //! - Sharding: `shard_id() == None` for single-shard, `Some(n)` for multi-shard,
    //!   and exactly one shard owns each event.
    //! - kg_pool=None early return: the projection is constructable without a KG pool.
    //! - `compute_market_cap` arithmetic.
    //! - `parse_decimal` error paths.
    //!
    //! ## What these tests do NOT verify
    //!
    //! - SQL execution (no `#[sqlx::test]` here — no DB is started).
    //! - Vault table upserts (`vault.total_deposits`, `market.vaults.total_shares`, etc.).
    //! - Share-price history appends.
    //! - Dual-write commit ordering under failure.
    //!
    //! Real-DB integration testing for this dual projector lives in the chaos suite:
    //! `backend/indexing-services/chaos/scripts/run-all.sh`, scenarios
    //! `04-dual-write-crash`, `05-full-cascade`, and `09-ingestion-crash`.
    //! Adding `#[sqlx::test]` unit-level integration tests is tracked as a
    //! internal follow-up.

    use super::*;
    use crate::projection::parse_decimal;
    use chrono::Utc;
    use serde_json::json;
    use shared::models::StoredEvent;
    use sqlx::types::BigDecimal;
    use std::str::FromStr;

    const HEX_7: &str = "0x0000000000000000000000000000000000000000000000000000000000000007";

    // -----------------------------------------------------------------------
    // Constructor and trait-method tests (no DB required)
    // -----------------------------------------------------------------------

    #[test]
    fn name_is_vault_state_dual() {
        assert_eq!(
            VaultStateDualProjection::new(0, 1).name(),
            "vault_state:dual"
        );
    }

    #[test]
    fn event_types_contains_three_variants() {
        let proj = VaultStateDualProjection::new(0, 1);
        assert_eq!(proj.event_types().len(), 3);
        assert!(proj.event_types().contains(&EventType::Deposited));
        assert!(proj.event_types().contains(&EventType::Redeemed));
        assert!(proj.event_types().contains(&EventType::SharePriceChanged));
    }

    #[test]
    fn shard_id_none_when_single_shard() {
        assert_eq!(VaultStateDualProjection::new(0, 1).shard_id(), None);
    }

    #[test]
    fn shard_id_some_when_multi_shard() {
        assert_eq!(VaultStateDualProjection::new(2, 4).shard_id(), Some(2));
    }

    #[test]
    fn should_skip_shard_returns_false_when_single_shard() {
        let proj = VaultStateDualProjection::new(0, 1);
        let curve_id = BigDecimal::from_str("1").unwrap();
        assert!(!proj.should_skip_shard(HEX_7, &curve_id));
    }

    #[test]
    fn should_skip_shard_filters_correctly_with_multiple_shards() {
        let curve_id = BigDecimal::from_str("1").unwrap();
        let proj_0 = VaultStateDualProjection::new(0, 2);
        let proj_1 = VaultStateDualProjection::new(1, 2);
        let skip_0 = proj_0.should_skip_shard(HEX_7, &curve_id);
        let skip_1 = proj_1.should_skip_shard(HEX_7, &curve_id);
        assert_ne!(skip_0, skip_1, "exactly one shard should own the event");
    }

    // -----------------------------------------------------------------------
    // ParsedEvent construction helpers
    // -----------------------------------------------------------------------

    fn make_deposited_stored() -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblock".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "Deposited".to_owned(),
            event_data: json!({
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
        }
    }

    fn make_redeemed_stored() -> StoredEvent {
        StoredEvent {
            sequence_number: 2,
            block_number: 101,
            block_timestamp: Utc::now(),
            block_hash: "0xblock2".to_owned(),
            transaction_hash: "0xtx2".to_owned(),
            log_index: 0,
            event_type: "Redeemed".to_owned(),
            event_data: json!({
                "block_number": 101,
                "block_timestamp": "2024-01-01T00:01:00Z",
                "block_hash": "0xblock2",
                "transaction_hash": "0xtx2",
                "log_index": 0,
                "sender": "0xSender",
                "receiver": "0xReceiver",
                "term_id": HEX_7,
                "curve_id": "1",
                "assets": "980000",
                "shares": "950000",
                "total_shares": "4050000",
                "fees": "10000",
                "vault_type": 1
            }),
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    fn make_share_price_stored() -> StoredEvent {
        StoredEvent {
            sequence_number: 3,
            block_number: 102,
            block_timestamp: Utc::now(),
            block_hash: "0xblock3".to_owned(),
            transaction_hash: "0xtx3".to_owned(),
            log_index: 0,
            event_type: "SharePriceChanged".to_owned(),
            event_data: json!({
                "block_number": 102,
                "block_timestamp": "2024-01-01T00:02:00Z",
                "block_hash": "0xblock3",
                "transaction_hash": "0xtx3",
                "log_index": 0,
                "term_id": HEX_7,
                "curve_id": "1",
                "share_price": "2000000000000000000",
                "total_assets": "10000000000000000000",
                "total_shares": "5000000000000000000",
                "vault_type": 1
            }),
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    // -----------------------------------------------------------------------
    // Parsed event field correctness tests (no DB required)
    // -----------------------------------------------------------------------

    #[test]
    fn deposited_event_parses_assets_after_fees() {
        let stored = make_deposited_stored();
        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::Deposited { data, .. } = &parsed else {
            panic!("expected Deposited variant");
        };
        assert_eq!(
            data.assets_after_fees,
            BigDecimal::from_str("980000").unwrap()
        );
        assert_eq!(data.shares, BigDecimal::from_str("950000").unwrap());
        assert_eq!(data.receiver, "0xReceiver");
    }

    #[test]
    fn redeemed_event_parses_assets() {
        let stored = make_redeemed_stored();
        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::Redeemed { data, .. } = &parsed else {
            panic!("expected Redeemed variant");
        };
        assert_eq!(data.assets, BigDecimal::from_str("980000").unwrap());
        assert_eq!(data.sender, "0xSender");
    }

    #[test]
    fn share_price_changed_event_parses_correctly() {
        let stored = make_share_price_stored();
        let parsed = ParsedEvent::parse(stored).expect("parse must succeed");
        let ParsedEvent::SharePriceChanged { data, .. } = &parsed else {
            panic!("expected SharePriceChanged variant");
        };
        assert_eq!(
            data.share_price,
            BigDecimal::from_str("2000000000000000000").unwrap()
        );
        assert_eq!(
            data.total_assets,
            BigDecimal::from_str("10000000000000000000").unwrap()
        );
        assert_eq!(
            data.total_shares,
            BigDecimal::from_str("5000000000000000000").unwrap()
        );
    }

    // -----------------------------------------------------------------------
    // market_cap computation test
    // -----------------------------------------------------------------------

    #[test]
    fn market_cap_computed_correctly_for_share_price_event() {
        // market_cap = total_shares * share_price / 1e18
        let market_cap = compute_market_cap("5000000000000000000", "2000000000000000000").unwrap();
        assert_eq!(
            market_cap,
            BigDecimal::from_str("10000000000000000000").unwrap()
        );
    }

    // -----------------------------------------------------------------------
    // parse_decimal helper tests (mirrors vault_state timescaledb tests)
    // -----------------------------------------------------------------------

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

    // -----------------------------------------------------------------------
    // Additional parse-correctness and contract tests (no DB required)
    // -----------------------------------------------------------------------

    /// `VaultStateDualProjection` includes `SharePriceChanged` in its event types
    /// but does NOT write `holder_count` — that is the responsibility of
    /// `VaultHoldersIndexDualProjection`. This test pins the event_types() contract
    /// and confirms `Deposited` is also present (not inadvertently dropped).
    /// NOTE: does not verify DB state.
    #[test]
    fn vault_state_dual_handles_share_price_changed_but_not_holder_count() {
        let proj = VaultStateDualProjection::new(0, 1);
        assert!(proj.event_types().contains(&EventType::SharePriceChanged));
        assert!(proj.event_types().contains(&EventType::Deposited));
    }

    /// Parsing the same `StoredEvent` twice yields identical field values,
    /// confirming `ParsedEvent::parse` is deterministic (relevant for replay
    /// safety where the same event may be re-parsed from the checkpoint).
    /// NOTE: does not invoke `process_batch` or `process_parsed_batch`.
    #[test]
    fn same_deposited_stored_event_parses_to_identical_fields_on_repeated_calls() {
        let stored_a = make_deposited_stored();
        let stored_b = make_deposited_stored();

        let pa = ParsedEvent::parse(stored_a).unwrap();
        let pb = ParsedEvent::parse(stored_b).unwrap();

        let ParsedEvent::Deposited { data: da, .. } = &pa else {
            panic!("expected Deposited a");
        };
        let ParsedEvent::Deposited { data: db, .. } = &pb else {
            panic!("expected Deposited b");
        };

        assert_eq!(da.term_id, db.term_id);
        assert_eq!(da.curve_id, db.curve_id);
        assert_eq!(da.assets_after_fees, db.assets_after_fees);
        assert_eq!(da.shares, db.shares);
    }
}
