//! Custom storage handler that writes events to the event_store table
//! and per-event-type typed tables (dual-write).
//!
//! Uses PostgreSQL UNNEST-based bulk inserts for performance.
//! Instead of one INSERT per row, each column is collected into a Vec
//! and expanded server-side via UNNEST, reducing SQL roundtrips by ~10,000x.

use anyhow::Result;
use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use sqlx::PgPool;
use tracing::{debug, info};

/// Maximum rows per UNNEST chunk to stay within PostgreSQL parameter limits.
/// Override with BULK_CHUNK_SIZE env var (default: 10000).
fn bulk_chunk_size() -> usize {
    static SIZE: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    *SIZE.get_or_init(|| {
        std::env::var("BULK_CHUNK_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(10_000)
    })
}

/// Storage handler that writes events to the event_store TimescaleDB table
/// and per-event-type typed tables.
pub struct EventStoreStorage {
    pool: PgPool,
}

// ---------------------------------------------------------------------------
// Write-side typed record structs (local DTOs — one per event type)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone)]
pub struct AtomCreatedTyped {
    pub block_number: i64,
    pub block_timestamp: DateTime<Utc>,
    pub block_hash: String,
    pub transaction_hash: String,
    pub log_index: i32,
    pub creator: String,
    pub term_id: BigDecimal,
    pub term_id_hex: String,
    pub atom_data: String,
    pub atom_wallet: String,
}

#[derive(Debug, Clone)]
pub struct TripleCreatedTyped {
    pub block_number: i64,
    pub block_timestamp: DateTime<Utc>,
    pub block_hash: String,
    pub transaction_hash: String,
    pub log_index: i32,
    pub creator: String,
    pub term_id: BigDecimal,
    pub term_id_hex: String,
    pub subject_id: BigDecimal,
    pub subject_id_hex: String,
    pub predicate_id: BigDecimal,
    pub predicate_id_hex: String,
    pub object_id: BigDecimal,
    pub object_id_hex: String,
}

#[derive(Debug, Clone)]
pub struct DepositedTyped {
    pub block_number: i64,
    pub block_timestamp: DateTime<Utc>,
    pub block_hash: String,
    pub transaction_hash: String,
    pub log_index: i32,
    pub sender: String,
    pub receiver: String,
    pub term_id: BigDecimal,
    pub term_id_hex: String,
    pub curve_id: BigDecimal,
    pub assets: BigDecimal,
    pub assets_after_fees: BigDecimal,
    pub shares: BigDecimal,
    pub total_shares: BigDecimal,
    pub vault_type: i32,
}

#[derive(Debug, Clone)]
pub struct RedeemedTyped {
    pub block_number: i64,
    pub block_timestamp: DateTime<Utc>,
    pub block_hash: String,
    pub transaction_hash: String,
    pub log_index: i32,
    pub sender: String,
    pub receiver: String,
    pub term_id: BigDecimal,
    pub term_id_hex: String,
    pub curve_id: BigDecimal,
    pub shares: BigDecimal,
    pub total_shares: BigDecimal,
    pub assets: BigDecimal,
    pub fees: BigDecimal,
    pub vault_type: i32,
}

#[derive(Debug, Clone)]
pub struct SharePriceChangedTyped {
    pub block_number: i64,
    pub block_timestamp: DateTime<Utc>,
    pub block_hash: String,
    pub transaction_hash: String,
    pub log_index: i32,
    pub term_id: BigDecimal,
    pub term_id_hex: String,
    pub curve_id: BigDecimal,
    pub share_price: BigDecimal,
    pub total_assets: BigDecimal,
    pub total_shares: BigDecimal,
    pub vault_type: i32,
}

#[derive(Debug, Clone)]
pub struct ProtocolFeeAccruedTyped {
    pub block_number: i64,
    pub block_timestamp: DateTime<Utc>,
    pub block_hash: String,
    pub transaction_hash: String,
    pub log_index: i32,
    pub epoch: BigDecimal,
    pub sender: String,
    pub amount: BigDecimal,
}

impl EventStoreStorage {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Insert a single event into event_store (kept for backward compat).
    #[allow(dead_code)]
    #[allow(clippy::too_many_arguments)]
    pub async fn insert_event(
        &self,
        block_number: i64,
        block_timestamp: DateTime<Utc>,
        block_hash: &str,
        transaction_hash: &str,
        log_index: i32,
        event_type: &str,
        event_data: serde_json::Value,
    ) -> Result<()> {
        debug!(
            "Inserting event: type={}, block={}, tx={}, log_index={}",
            event_type, block_number, transaction_hash, log_index
        );

        sqlx::query(
            r#"
            INSERT INTO event_store (
                block_number,
                block_timestamp,
                block_hash,
                transaction_hash,
                log_index,
                event_type,
                event_data,
                is_canonical
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, true)
            ON CONFLICT (transaction_hash, log_index, block_timestamp)
            DO NOTHING
            "#,
        )
        .bind(block_number)
        .bind(block_timestamp)
        .bind(block_hash)
        .bind(transaction_hash)
        .bind(log_index)
        .bind(event_type)
        .bind(event_data)
        .execute(&self.pool)
        .await?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Shared bulk helper: UNNEST insert into event_store
    // -----------------------------------------------------------------------

    async fn bulk_insert_event_store(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        events: &[EventRecord],
    ) -> Result<()> {
        for chunk in events.chunks(bulk_chunk_size()) {
            let block_numbers: Vec<i64> = chunk.iter().map(|e| e.block_number).collect();
            let block_timestamps: Vec<DateTime<Utc>> =
                chunk.iter().map(|e| e.block_timestamp).collect();
            let block_hashes: Vec<String> = chunk.iter().map(|e| e.block_hash.clone()).collect();
            let tx_hashes: Vec<String> = chunk.iter().map(|e| e.transaction_hash.clone()).collect();
            let log_indices: Vec<i32> = chunk.iter().map(|e| e.log_index).collect();
            let event_types: Vec<String> = chunk.iter().map(|e| e.event_type.clone()).collect();
            let event_datas: Vec<serde_json::Value> =
                chunk.iter().map(|e| e.event_data.clone()).collect();

            sqlx::query(
                r#"
                INSERT INTO event_store (
                    block_number, block_timestamp, block_hash,
                    transaction_hash, log_index, event_type, event_data, is_canonical
                )
                SELECT *, true FROM UNNEST(
                    $1::BIGINT[], $2::TIMESTAMPTZ[], $3::TEXT[],
                    $4::TEXT[], $5::INT[], $6::TEXT[], $7::JSONB[]
                )
                ON CONFLICT (transaction_hash, log_index, block_timestamp) DO NOTHING
                "#,
            )
            .bind(&block_numbers)
            .bind(&block_timestamps)
            .bind(&block_hashes)
            .bind(&tx_hashes)
            .bind(&log_indices)
            .bind(&event_types)
            .bind(&event_datas)
            .execute(&mut **tx)
            .await?;
        }
        Ok(())
    }

    // -----------------------------------------------------------------------
    // Fetch sequence numbers after event_store insert
    // -----------------------------------------------------------------------

    /// After inserting into event_store, fetch the assigned sequence_number for
    /// each event. Uses UNNEST WITH ORDINALITY to preserve input ordering so
    /// the returned Vec<i64> is positionally aligned with the input slices.
    async fn fetch_sequence_numbers(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        tx_hashes: &[String],
        log_indices: &[i32],
        block_timestamps: &[DateTime<Utc>],
    ) -> Result<Vec<i64>> {
        let mut all_seqs = Vec::with_capacity(tx_hashes.len());

        for chunk_start in (0..tx_hashes.len()).step_by(bulk_chunk_size()) {
            let chunk_end = (chunk_start + bulk_chunk_size()).min(tx_hashes.len());
            let tx_chunk = &tx_hashes[chunk_start..chunk_end];
            let li_chunk = &log_indices[chunk_start..chunk_end];
            let bt_chunk = &block_timestamps[chunk_start..chunk_end];

            let rows = sqlx::query_scalar::<_, i64>(
                r#"
                SELECT es.sequence_number
                FROM UNNEST($1::TEXT[], $2::INT[], $3::TIMESTAMPTZ[])
                    WITH ORDINALITY AS input(tx_hash, log_idx, block_ts, ord)
                JOIN event_store es
                    ON es.transaction_hash = input.tx_hash
                    AND es.log_index = input.log_idx
                    AND es.block_timestamp = input.block_ts
                    AND es.is_canonical = true
                ORDER BY input.ord
                "#,
            )
            .bind(tx_chunk)
            .bind(li_chunk)
            .bind(bt_chunk)
            .fetch_all(&mut **tx)
            .await?;

            all_seqs.extend(rows);
        }

        Ok(all_seqs)
    }

    // -----------------------------------------------------------------------
    // Legacy bulk insert (event_store only)
    // -----------------------------------------------------------------------

    /// Bulk insert events into event_store only (kept for backward compat).
    #[allow(dead_code)]
    pub async fn insert_events_bulk(&self, events: Vec<EventRecord>) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }

        info!("Bulk inserting {} events", events.len());

        let mut tx = self.pool.begin().await?;
        Self::bulk_insert_event_store(&mut tx, &events).await?;
        tx.commit().await?;

        Ok(())
    }

    // -----------------------------------------------------------------------
    // Dual-write methods: event_store + typed table in one transaction
    // -----------------------------------------------------------------------

    /// Insert AtomCreated events into both event_store and atom_created_events.
    pub async fn insert_atom_created_events(
        &self,
        events: Vec<EventRecord>,
        typed: Vec<AtomCreatedTyped>,
    ) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        info!("Dual-write inserting {} AtomCreated events", events.len());

        let mut tx = self.pool.begin().await?;

        Self::bulk_insert_event_store(&mut tx, &events).await?;

        // Fetch sequence numbers assigned by event_store BIGSERIAL
        let all_tx_hashes: Vec<String> = typed.iter().map(|t| t.transaction_hash.clone()).collect();
        let all_log_indices: Vec<i32> = typed.iter().map(|t| t.log_index).collect();
        let all_block_ts: Vec<DateTime<Utc>> = typed.iter().map(|t| t.block_timestamp).collect();
        let seq_numbers =
            Self::fetch_sequence_numbers(&mut tx, &all_tx_hashes, &all_log_indices, &all_block_ts)
                .await?;

        for (chunk_idx, chunk) in typed.chunks(bulk_chunk_size()).enumerate() {
            let offset = chunk_idx * bulk_chunk_size();
            let seq_chunk: Vec<i64> = seq_numbers[offset..offset + chunk.len()].to_vec();
            let block_numbers: Vec<i64> = chunk.iter().map(|t| t.block_number).collect();
            let block_timestamps: Vec<DateTime<Utc>> =
                chunk.iter().map(|t| t.block_timestamp).collect();
            let block_hashes: Vec<String> = chunk.iter().map(|t| t.block_hash.clone()).collect();
            let tx_hashes: Vec<String> = chunk.iter().map(|t| t.transaction_hash.clone()).collect();
            let log_indices: Vec<i32> = chunk.iter().map(|t| t.log_index).collect();
            let creators: Vec<String> = chunk.iter().map(|t| t.creator.clone()).collect();
            let term_ids: Vec<BigDecimal> = chunk.iter().map(|t| t.term_id.clone()).collect();
            let term_id_hexes: Vec<String> = chunk.iter().map(|t| t.term_id_hex.clone()).collect();
            let atom_datas: Vec<String> = chunk.iter().map(|t| t.atom_data.clone()).collect();
            let atom_wallets: Vec<String> = chunk.iter().map(|t| t.atom_wallet.clone()).collect();

            sqlx::query(
                r#"
                INSERT INTO atom_created_events (
                    block_number, block_timestamp, block_hash,
                    transaction_hash, log_index,
                    creator, term_id, term_id_hex, atom_data, atom_wallet,
                    sequence_number
                )
                SELECT * FROM UNNEST(
                    $1::BIGINT[], $2::TIMESTAMPTZ[], $3::TEXT[],
                    $4::TEXT[], $5::INT[],
                    $6::TEXT[], $7::NUMERIC[], $8::TEXT[], $9::TEXT[], $10::TEXT[],
                    $11::BIGINT[]
                )
                ON CONFLICT (transaction_hash, log_index) DO NOTHING
                "#,
            )
            .bind(&block_numbers)
            .bind(&block_timestamps)
            .bind(&block_hashes)
            .bind(&tx_hashes)
            .bind(&log_indices)
            .bind(&creators)
            .bind(&term_ids)
            .bind(&term_id_hexes)
            .bind(&atom_datas)
            .bind(&atom_wallets)
            .bind(&seq_chunk)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Insert TripleCreated events into both event_store and triple_created_events.
    pub async fn insert_triple_created_events(
        &self,
        events: Vec<EventRecord>,
        typed: Vec<TripleCreatedTyped>,
    ) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        info!("Dual-write inserting {} TripleCreated events", events.len());

        let mut tx = self.pool.begin().await?;

        Self::bulk_insert_event_store(&mut tx, &events).await?;

        let all_tx_hashes: Vec<String> = typed.iter().map(|t| t.transaction_hash.clone()).collect();
        let all_log_indices: Vec<i32> = typed.iter().map(|t| t.log_index).collect();
        let all_block_ts: Vec<DateTime<Utc>> = typed.iter().map(|t| t.block_timestamp).collect();
        let seq_numbers =
            Self::fetch_sequence_numbers(&mut tx, &all_tx_hashes, &all_log_indices, &all_block_ts)
                .await?;

        for (chunk_idx, chunk) in typed.chunks(bulk_chunk_size()).enumerate() {
            let offset = chunk_idx * bulk_chunk_size();
            let seq_chunk: Vec<i64> = seq_numbers[offset..offset + chunk.len()].to_vec();
            let block_numbers: Vec<i64> = chunk.iter().map(|t| t.block_number).collect();
            let block_timestamps: Vec<DateTime<Utc>> =
                chunk.iter().map(|t| t.block_timestamp).collect();
            let block_hashes: Vec<String> = chunk.iter().map(|t| t.block_hash.clone()).collect();
            let tx_hashes: Vec<String> = chunk.iter().map(|t| t.transaction_hash.clone()).collect();
            let log_indices: Vec<i32> = chunk.iter().map(|t| t.log_index).collect();
            let creators: Vec<String> = chunk.iter().map(|t| t.creator.clone()).collect();
            let term_ids: Vec<BigDecimal> = chunk.iter().map(|t| t.term_id.clone()).collect();
            let term_id_hexes: Vec<String> = chunk.iter().map(|t| t.term_id_hex.clone()).collect();
            let subject_ids: Vec<BigDecimal> = chunk.iter().map(|t| t.subject_id.clone()).collect();
            let subject_id_hexes: Vec<String> =
                chunk.iter().map(|t| t.subject_id_hex.clone()).collect();
            let predicate_ids: Vec<BigDecimal> =
                chunk.iter().map(|t| t.predicate_id.clone()).collect();
            let predicate_id_hexes: Vec<String> =
                chunk.iter().map(|t| t.predicate_id_hex.clone()).collect();
            let object_ids: Vec<BigDecimal> = chunk.iter().map(|t| t.object_id.clone()).collect();
            let object_id_hexes: Vec<String> =
                chunk.iter().map(|t| t.object_id_hex.clone()).collect();

            sqlx::query(
                r#"
                INSERT INTO triple_created_events (
                    block_number, block_timestamp, block_hash,
                    transaction_hash, log_index,
                    creator, term_id, term_id_hex,
                    subject_id, subject_id_hex,
                    predicate_id, predicate_id_hex,
                    object_id, object_id_hex,
                    sequence_number
                )
                SELECT * FROM UNNEST(
                    $1::BIGINT[], $2::TIMESTAMPTZ[], $3::TEXT[],
                    $4::TEXT[], $5::INT[],
                    $6::TEXT[], $7::NUMERIC[], $8::TEXT[],
                    $9::NUMERIC[], $10::TEXT[],
                    $11::NUMERIC[], $12::TEXT[],
                    $13::NUMERIC[], $14::TEXT[],
                    $15::BIGINT[]
                )
                ON CONFLICT (transaction_hash, log_index) DO NOTHING
                "#,
            )
            .bind(&block_numbers)
            .bind(&block_timestamps)
            .bind(&block_hashes)
            .bind(&tx_hashes)
            .bind(&log_indices)
            .bind(&creators)
            .bind(&term_ids)
            .bind(&term_id_hexes)
            .bind(&subject_ids)
            .bind(&subject_id_hexes)
            .bind(&predicate_ids)
            .bind(&predicate_id_hexes)
            .bind(&object_ids)
            .bind(&object_id_hexes)
            .bind(&seq_chunk)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Insert Deposited events into both event_store and deposited_events.
    pub async fn insert_deposited_events(
        &self,
        events: Vec<EventRecord>,
        typed: Vec<DepositedTyped>,
    ) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        info!("Dual-write inserting {} Deposited events", events.len());

        let mut tx = self.pool.begin().await?;

        Self::bulk_insert_event_store(&mut tx, &events).await?;

        let all_tx_hashes: Vec<String> = typed.iter().map(|t| t.transaction_hash.clone()).collect();
        let all_log_indices: Vec<i32> = typed.iter().map(|t| t.log_index).collect();
        let all_block_ts: Vec<DateTime<Utc>> = typed.iter().map(|t| t.block_timestamp).collect();
        let seq_numbers =
            Self::fetch_sequence_numbers(&mut tx, &all_tx_hashes, &all_log_indices, &all_block_ts)
                .await?;

        for (chunk_idx, chunk) in typed.chunks(bulk_chunk_size()).enumerate() {
            let offset = chunk_idx * bulk_chunk_size();
            let seq_chunk: Vec<i64> = seq_numbers[offset..offset + chunk.len()].to_vec();
            let block_numbers: Vec<i64> = chunk.iter().map(|t| t.block_number).collect();
            let block_timestamps: Vec<DateTime<Utc>> =
                chunk.iter().map(|t| t.block_timestamp).collect();
            let block_hashes: Vec<String> = chunk.iter().map(|t| t.block_hash.clone()).collect();
            let tx_hashes: Vec<String> = chunk.iter().map(|t| t.transaction_hash.clone()).collect();
            let log_indices: Vec<i32> = chunk.iter().map(|t| t.log_index).collect();
            let senders: Vec<String> = chunk.iter().map(|t| t.sender.clone()).collect();
            let receivers: Vec<String> = chunk.iter().map(|t| t.receiver.clone()).collect();
            let term_ids: Vec<BigDecimal> = chunk.iter().map(|t| t.term_id.clone()).collect();
            let term_id_hexes: Vec<String> = chunk.iter().map(|t| t.term_id_hex.clone()).collect();
            let curve_ids: Vec<BigDecimal> = chunk.iter().map(|t| t.curve_id.clone()).collect();
            let assets: Vec<BigDecimal> = chunk.iter().map(|t| t.assets.clone()).collect();
            let assets_after_fees: Vec<BigDecimal> =
                chunk.iter().map(|t| t.assets_after_fees.clone()).collect();
            let shares: Vec<BigDecimal> = chunk.iter().map(|t| t.shares.clone()).collect();
            let total_shares: Vec<BigDecimal> =
                chunk.iter().map(|t| t.total_shares.clone()).collect();
            let vault_types: Vec<i32> = chunk.iter().map(|t| t.vault_type).collect();

            sqlx::query(
                r#"
                INSERT INTO deposited_events (
                    block_number, block_timestamp, block_hash,
                    transaction_hash, log_index,
                    sender, receiver, term_id, term_id_hex, curve_id,
                    assets, assets_after_fees, shares, total_shares, vault_type,
                    sequence_number
                )
                SELECT * FROM UNNEST(
                    $1::BIGINT[], $2::TIMESTAMPTZ[], $3::TEXT[],
                    $4::TEXT[], $5::INT[],
                    $6::TEXT[], $7::TEXT[], $8::NUMERIC[], $9::TEXT[], $10::NUMERIC[],
                    $11::NUMERIC[], $12::NUMERIC[], $13::NUMERIC[], $14::NUMERIC[], $15::INT[],
                    $16::BIGINT[]
                )
                ON CONFLICT (transaction_hash, log_index, block_timestamp) DO NOTHING
                "#,
            )
            .bind(&block_numbers)
            .bind(&block_timestamps)
            .bind(&block_hashes)
            .bind(&tx_hashes)
            .bind(&log_indices)
            .bind(&senders)
            .bind(&receivers)
            .bind(&term_ids)
            .bind(&term_id_hexes)
            .bind(&curve_ids)
            .bind(&assets)
            .bind(&assets_after_fees)
            .bind(&shares)
            .bind(&total_shares)
            .bind(&vault_types)
            .bind(&seq_chunk)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Insert Redeemed events into both event_store and redeemed_events.
    pub async fn insert_redeemed_events(
        &self,
        events: Vec<EventRecord>,
        typed: Vec<RedeemedTyped>,
    ) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        info!("Dual-write inserting {} Redeemed events", events.len());

        let mut tx = self.pool.begin().await?;

        Self::bulk_insert_event_store(&mut tx, &events).await?;

        let all_tx_hashes: Vec<String> = typed.iter().map(|t| t.transaction_hash.clone()).collect();
        let all_log_indices: Vec<i32> = typed.iter().map(|t| t.log_index).collect();
        let all_block_ts: Vec<DateTime<Utc>> = typed.iter().map(|t| t.block_timestamp).collect();
        let seq_numbers =
            Self::fetch_sequence_numbers(&mut tx, &all_tx_hashes, &all_log_indices, &all_block_ts)
                .await?;

        for (chunk_idx, chunk) in typed.chunks(bulk_chunk_size()).enumerate() {
            let offset = chunk_idx * bulk_chunk_size();
            let seq_chunk: Vec<i64> = seq_numbers[offset..offset + chunk.len()].to_vec();
            let block_numbers: Vec<i64> = chunk.iter().map(|t| t.block_number).collect();
            let block_timestamps: Vec<DateTime<Utc>> =
                chunk.iter().map(|t| t.block_timestamp).collect();
            let block_hashes: Vec<String> = chunk.iter().map(|t| t.block_hash.clone()).collect();
            let tx_hashes: Vec<String> = chunk.iter().map(|t| t.transaction_hash.clone()).collect();
            let log_indices: Vec<i32> = chunk.iter().map(|t| t.log_index).collect();
            let senders: Vec<String> = chunk.iter().map(|t| t.sender.clone()).collect();
            let receivers: Vec<String> = chunk.iter().map(|t| t.receiver.clone()).collect();
            let term_ids: Vec<BigDecimal> = chunk.iter().map(|t| t.term_id.clone()).collect();
            let term_id_hexes: Vec<String> = chunk.iter().map(|t| t.term_id_hex.clone()).collect();
            let curve_ids: Vec<BigDecimal> = chunk.iter().map(|t| t.curve_id.clone()).collect();
            let shares: Vec<BigDecimal> = chunk.iter().map(|t| t.shares.clone()).collect();
            let total_shares: Vec<BigDecimal> =
                chunk.iter().map(|t| t.total_shares.clone()).collect();
            let assets: Vec<BigDecimal> = chunk.iter().map(|t| t.assets.clone()).collect();
            let fees: Vec<BigDecimal> = chunk.iter().map(|t| t.fees.clone()).collect();
            let vault_types: Vec<i32> = chunk.iter().map(|t| t.vault_type).collect();

            sqlx::query(
                r#"
                INSERT INTO redeemed_events (
                    block_number, block_timestamp, block_hash,
                    transaction_hash, log_index,
                    sender, receiver, term_id, term_id_hex, curve_id,
                    shares, total_shares, assets, fees, vault_type,
                    sequence_number
                )
                SELECT * FROM UNNEST(
                    $1::BIGINT[], $2::TIMESTAMPTZ[], $3::TEXT[],
                    $4::TEXT[], $5::INT[],
                    $6::TEXT[], $7::TEXT[], $8::NUMERIC[], $9::TEXT[], $10::NUMERIC[],
                    $11::NUMERIC[], $12::NUMERIC[], $13::NUMERIC[], $14::NUMERIC[], $15::INT[],
                    $16::BIGINT[]
                )
                ON CONFLICT (transaction_hash, log_index, block_timestamp) DO NOTHING
                "#,
            )
            .bind(&block_numbers)
            .bind(&block_timestamps)
            .bind(&block_hashes)
            .bind(&tx_hashes)
            .bind(&log_indices)
            .bind(&senders)
            .bind(&receivers)
            .bind(&term_ids)
            .bind(&term_id_hexes)
            .bind(&curve_ids)
            .bind(&shares)
            .bind(&total_shares)
            .bind(&assets)
            .bind(&fees)
            .bind(&vault_types)
            .bind(&seq_chunk)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Insert SharePriceChanged events into both event_store and share_price_changed_events.
    pub async fn insert_share_price_changed_events(
        &self,
        events: Vec<EventRecord>,
        typed: Vec<SharePriceChangedTyped>,
    ) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        info!(
            "Dual-write inserting {} SharePriceChanged events",
            events.len()
        );

        let mut tx = self.pool.begin().await?;

        Self::bulk_insert_event_store(&mut tx, &events).await?;

        let all_tx_hashes: Vec<String> = typed.iter().map(|t| t.transaction_hash.clone()).collect();
        let all_log_indices: Vec<i32> = typed.iter().map(|t| t.log_index).collect();
        let all_block_ts: Vec<DateTime<Utc>> = typed.iter().map(|t| t.block_timestamp).collect();
        let seq_numbers =
            Self::fetch_sequence_numbers(&mut tx, &all_tx_hashes, &all_log_indices, &all_block_ts)
                .await?;

        for (chunk_idx, chunk) in typed.chunks(bulk_chunk_size()).enumerate() {
            let offset = chunk_idx * bulk_chunk_size();
            let seq_chunk: Vec<i64> = seq_numbers[offset..offset + chunk.len()].to_vec();
            let block_numbers: Vec<i64> = chunk.iter().map(|t| t.block_number).collect();
            let block_timestamps: Vec<DateTime<Utc>> =
                chunk.iter().map(|t| t.block_timestamp).collect();
            let block_hashes: Vec<String> = chunk.iter().map(|t| t.block_hash.clone()).collect();
            let tx_hashes: Vec<String> = chunk.iter().map(|t| t.transaction_hash.clone()).collect();
            let log_indices: Vec<i32> = chunk.iter().map(|t| t.log_index).collect();
            let term_ids: Vec<BigDecimal> = chunk.iter().map(|t| t.term_id.clone()).collect();
            let term_id_hexes: Vec<String> = chunk.iter().map(|t| t.term_id_hex.clone()).collect();
            let curve_ids: Vec<BigDecimal> = chunk.iter().map(|t| t.curve_id.clone()).collect();
            let share_prices: Vec<BigDecimal> =
                chunk.iter().map(|t| t.share_price.clone()).collect();
            let total_assets: Vec<BigDecimal> =
                chunk.iter().map(|t| t.total_assets.clone()).collect();
            let total_shares: Vec<BigDecimal> =
                chunk.iter().map(|t| t.total_shares.clone()).collect();
            let vault_types: Vec<i32> = chunk.iter().map(|t| t.vault_type).collect();

            sqlx::query(
                r#"
                INSERT INTO share_price_changed_events (
                    block_number, block_timestamp, block_hash,
                    transaction_hash, log_index,
                    term_id, term_id_hex, curve_id,
                    share_price, total_assets, total_shares, vault_type,
                    sequence_number
                )
                SELECT * FROM UNNEST(
                    $1::BIGINT[], $2::TIMESTAMPTZ[], $3::TEXT[],
                    $4::TEXT[], $5::INT[],
                    $6::NUMERIC[], $7::TEXT[], $8::NUMERIC[],
                    $9::NUMERIC[], $10::NUMERIC[], $11::NUMERIC[], $12::INT[],
                    $13::BIGINT[]
                )
                ON CONFLICT (transaction_hash, log_index, block_timestamp) DO NOTHING
                "#,
            )
            .bind(&block_numbers)
            .bind(&block_timestamps)
            .bind(&block_hashes)
            .bind(&tx_hashes)
            .bind(&log_indices)
            .bind(&term_ids)
            .bind(&term_id_hexes)
            .bind(&curve_ids)
            .bind(&share_prices)
            .bind(&total_assets)
            .bind(&total_shares)
            .bind(&vault_types)
            .bind(&seq_chunk)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }

    /// Insert ProtocolFeeAccrued events into both event_store and protocol_fee_accrued_events.
    pub async fn insert_protocol_fee_accrued_events(
        &self,
        events: Vec<EventRecord>,
        typed: Vec<ProtocolFeeAccruedTyped>,
    ) -> Result<()> {
        if events.is_empty() {
            return Ok(());
        }
        info!(
            "Dual-write inserting {} ProtocolFeeAccrued events",
            events.len()
        );

        let mut tx = self.pool.begin().await?;

        Self::bulk_insert_event_store(&mut tx, &events).await?;

        let all_tx_hashes: Vec<String> = typed.iter().map(|t| t.transaction_hash.clone()).collect();
        let all_log_indices: Vec<i32> = typed.iter().map(|t| t.log_index).collect();
        let all_block_ts: Vec<DateTime<Utc>> = typed.iter().map(|t| t.block_timestamp).collect();
        let seq_numbers =
            Self::fetch_sequence_numbers(&mut tx, &all_tx_hashes, &all_log_indices, &all_block_ts)
                .await?;

        for (chunk_idx, chunk) in typed.chunks(bulk_chunk_size()).enumerate() {
            let offset = chunk_idx * bulk_chunk_size();
            let seq_chunk: Vec<i64> = seq_numbers[offset..offset + chunk.len()].to_vec();
            let block_numbers: Vec<i64> = chunk.iter().map(|t| t.block_number).collect();
            let block_timestamps: Vec<DateTime<Utc>> =
                chunk.iter().map(|t| t.block_timestamp).collect();
            let block_hashes: Vec<String> = chunk.iter().map(|t| t.block_hash.clone()).collect();
            let tx_hashes: Vec<String> = chunk.iter().map(|t| t.transaction_hash.clone()).collect();
            let log_indices: Vec<i32> = chunk.iter().map(|t| t.log_index).collect();
            let epochs: Vec<BigDecimal> = chunk.iter().map(|t| t.epoch.clone()).collect();
            let senders: Vec<String> = chunk.iter().map(|t| t.sender.clone()).collect();
            let amounts: Vec<BigDecimal> = chunk.iter().map(|t| t.amount.clone()).collect();

            sqlx::query(
                r#"
                INSERT INTO protocol_fee_accrued_events (
                    block_number, block_timestamp, block_hash,
                    transaction_hash, log_index,
                    epoch, sender, amount,
                    sequence_number
                )
                SELECT * FROM UNNEST(
                    $1::BIGINT[], $2::TIMESTAMPTZ[], $3::TEXT[],
                    $4::TEXT[], $5::INT[],
                    $6::NUMERIC[], $7::TEXT[], $8::NUMERIC[],
                    $9::BIGINT[]
                )
                ON CONFLICT (transaction_hash, log_index) DO NOTHING
                "#,
            )
            .bind(&block_numbers)
            .bind(&block_timestamps)
            .bind(&block_hashes)
            .bind(&tx_hashes)
            .bind(&log_indices)
            .bind(&epochs)
            .bind(&senders)
            .bind(&amounts)
            .bind(&seq_chunk)
            .execute(&mut *tx)
            .await?;
        }

        tx.commit().await?;
        Ok(())
    }
}

/// Event record for bulk insertion (event_store generic record)
#[derive(Debug, Clone)]
pub struct EventRecord {
    pub block_number: i64,
    pub block_timestamp: DateTime<Utc>,
    pub block_hash: String,
    pub transaction_hash: String,
    pub log_index: i32,
    pub event_type: String,
    pub event_data: serde_json::Value,
}
