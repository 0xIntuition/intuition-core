//! Event handlers for rindexer
//!
//! These handlers receive decoded events from rindexer and write them
//! to the event_store table AND per-event-type typed tables (dual-write).

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;

use bigdecimal::BigDecimal;
use chrono::{DateTime, Utc};
use rindexer::event::callback_registry::TraceCallbackRegistry;
use rindexer::event::callback_registry::{EventCallbackRegistry, TxInformation};
use rindexer::{start_rindexer, GraphqlOverrideSettings, IndexingDetails, StartDetails};
use serde_json::json;
use tracing::{error, info};

use crate::metrics;
use crate::rindexer_lib::typings::be_v_3_indexer::events::multi_vault::{
    AtomCreatedEvent, AtomCreatedResult, DepositedEvent, DepositedResult, EventContext,
    MultiVaultEventType, ProtocolFeeAccruedEvent, ProtocolFeeAccruedResult, RedeemedEvent,
    RedeemedResult, SharePriceChangedEvent, SharePriceChangedResult, TripleCreatedEvent,
    TripleCreatedResult,
};
use crate::storage::{
    AtomCreatedTyped, DepositedTyped, EventRecord, EventStoreStorage, ProtocolFeeAccruedTyped,
    RedeemedTyped, SharePriceChangedTyped, TripleCreatedTyped,
};

/// Start the rindexer with custom event handlers
pub async fn start_indexer(
    manifest_path: PathBuf,
    storage: Arc<EventStoreStorage>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    info!("Initializing rindexer handlers");
    info!("Manifest path: {:?}", manifest_path);

    // Verify manifest contents for debugging
    if let Ok(manifest) = rindexer::manifest::yaml::read_manifest(&manifest_path) {
        info!(
            "Manifest loaded: name={}, timestamps={:?}",
            manifest.name, manifest.timestamps
        );
        if manifest.timestamps == Some(true) {
            info!("timestamps=true in manifest - blockclock SHOULD be active");
        } else {
            error!("timestamps is NOT true! Value: {:?}", manifest.timestamps);
        }
    } else {
        error!("Failed to read manifest at {:?}", manifest_path);
    }

    // Create the event callback registries
    let mut registry = EventCallbackRegistry::new();
    let trace_registry = TraceCallbackRegistry::new();

    // Register all event handlers
    register_atom_created_handler(&manifest_path, &mut registry, storage.clone()).await;
    register_triple_created_handler(&manifest_path, &mut registry, storage.clone()).await;
    register_deposited_handler(&manifest_path, &mut registry, storage.clone()).await;
    register_redeemed_handler(&manifest_path, &mut registry, storage.clone()).await;
    register_share_price_changed_handler(&manifest_path, &mut registry, storage.clone()).await;
    register_protocol_fee_accrued_handler(&manifest_path, &mut registry, storage.clone()).await;

    info!("All handlers registered, starting rindexer");

    // Create start details with our custom registry
    let start_details = StartDetails {
        manifest_path: &manifest_path,
        indexing_details: Some(IndexingDetails {
            registry,
            trace_registry,
            event_stream: None,
        }),
        graphql_details: GraphqlOverrideSettings {
            enabled: false,
            override_port: None,
        },
        cron_scheduler_handle: None,
        watch: false,
    };

    // Start rindexer with our custom handlers
    start_rindexer(start_details)
        .await
        .map_err(|e| format!("rindexer error: {}", e))?;

    Ok(())
}

/// Helper to convert block timestamp to DateTime<Utc>
///
/// This function attempts to get the block timestamp from TxInformation.
/// If the timestamp is missing (which should NOT happen in production),
/// it logs a warning and falls back to Utc::now().
fn timestamp_to_datetime(tx_info: &TxInformation) -> DateTime<Utc> {
    // ALWAYS log the first few events to see what we're getting
    static LOGGED_COUNT: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
    let count = LOGGED_COUNT.fetch_add(1, std::sync::atomic::Ordering::Relaxed);

    if count < 20 {
        // Log first 20 events at INFO level for visibility
        info!(
            block_number = tx_info.block_number,
            raw_block_timestamp = ?tx_info.block_timestamp,
            "TIMESTAMP DEBUG [{}]: Received from rindexer",
            count
        );
    }

    // First try the built-in method
    if let Some(dt) = tx_info.block_timestamp_to_datetime() {
        return dt;
    }

    // Log detailed warning - this should NOT happen!
    tracing::warn!(
        block_number = tx_info.block_number,
        tx_hash = ?tx_info.transaction_hash,
        raw_block_timestamp = ?tx_info.block_timestamp,
        "TIMESTAMP MISSING! block_timestamp is None from rindexer. \
         Using Utc::now() as fallback. This indicates blockclock is not being called."
    );

    Utc::now()
}

/// Helper to parse a U256 string into BigDecimal.
/// Panics on invalid input (should never happen with U256::to_string()).
fn to_bd(s: &str) -> BigDecimal {
    BigDecimal::from_str(s).expect("U256::to_string() always produces valid decimal")
}

/// Convert a bytes32 (B256) to BigDecimal by interpreting as big-endian U256.
fn b256_to_bd(b: &alloy::primitives::FixedBytes<32>) -> BigDecimal {
    let num = alloy::primitives::U256::from_be_bytes(b.0);
    BigDecimal::from_str(&num.to_string()).expect("U256 always produces valid decimal")
}

/// Maximum results to convert + insert per sub-batch inside a handler callback.
/// Keeps peak memory bounded when rindexer delivers 400k+ events in one call.
/// Override with HANDLER_CHUNK_SIZE env var (default: 50000).
fn handler_chunk_size() -> usize {
    static SIZE: std::sync::OnceLock<usize> = std::sync::OnceLock::new();
    *SIZE.get_or_init(|| {
        std::env::var("HANDLER_CHUNK_SIZE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(50_000)
    })
}

/// Register AtomCreated event handler
async fn register_atom_created_handler(
    manifest_path: &PathBuf,
    registry: &mut EventCallbackRegistry,
    storage: Arc<EventStoreStorage>,
) {
    let handler =
        AtomCreatedEvent::handler(
            |results: Vec<AtomCreatedResult>,
             context: Arc<EventContext<Arc<EventStoreStorage>>>| async move {
                if results.is_empty() {
                    return Ok(());
                }

                let total = results.len();
                let storage = &context.extensions;

                // Process in sub-batches to bound peak memory
                for chunk in results.chunks(handler_chunk_size()) {
                    let mut events: Vec<EventRecord> = Vec::with_capacity(chunk.len());
                    let mut typed: Vec<AtomCreatedTyped> = Vec::with_capacity(chunk.len());

                    for result in chunk {
                        let tx = &result.tx_information;
                        let event = &result.event_data;

                        let creator = format!("{:?}", event.creator);
                        let term_id_bd = b256_to_bd(&event.termId);
                        let term_id_hex = format!("{:?}", event.termId);
                        let atom_data = format!("0x{}", hex::encode(&event.atomData));
                        let atom_wallet = format!("{:?}", event.atomWallet);
                        let block_ts = timestamp_to_datetime(tx);
                        let block_hash = format!("{:?}", tx.block_hash);
                        let transaction_hash = format!("{:?}", tx.transaction_hash);
                        let block_number = tx.block_number as i64;
                        let log_index = tx.log_index.to::<i32>();

                        // event_data uses the hex string so downstream Record
                        // structs (term_id: String) can deserialise it directly.
                        // The hex format matches the term_id_hex column in typed
                        // tables and is what all dimension tables / projections expect.
                        let event_data = json!({
                            "creator": &creator,
                            "term_id": &term_id_hex,
                            "atom_data": &atom_data,
                            "atom_wallet": &atom_wallet,
                        });

                        events.push(EventRecord {
                            block_number,
                            block_timestamp: block_ts,
                            block_hash: block_hash.clone(),
                            transaction_hash: transaction_hash.clone(),
                            log_index,
                            event_type: "AtomCreated".to_string(),
                            event_data,
                        });

                        typed.push(AtomCreatedTyped {
                            block_number,
                            block_timestamp: block_ts,
                            block_hash,
                            transaction_hash,
                            log_index,
                            creator,
                            term_id: term_id_bd,
                            term_id_hex,
                            atom_data,
                            atom_wallet,
                        });
                    }

                    if let Err(e) = storage.insert_atom_created_events(events, typed).await {
                        error!("Failed to insert AtomCreated events: {}", e);
                        return Err(e.to_string());
                    }
                }

                let max_block = results
                    .iter()
                    .map(|r| r.tx_information.block_number)
                    .max()
                    .unwrap_or(0);
                metrics::record_events_with_block("AtomCreated", total as u64, max_block, None);

                info!(
                    "AtomCreated - INDEXED {} events (block {})",
                    total, max_block
                );
                Ok(())
            },
            storage.clone(),
        )
        .await;

    MultiVaultEventType::AtomCreated(handler)
        .register(manifest_path, registry)
        .await;
}

/// Register TripleCreated event handler
async fn register_triple_created_handler(
    manifest_path: &PathBuf,
    registry: &mut EventCallbackRegistry,
    storage: Arc<EventStoreStorage>,
) {
    let handler =
        TripleCreatedEvent::handler(
            |results: Vec<TripleCreatedResult>,
             context: Arc<EventContext<Arc<EventStoreStorage>>>| async move {
                if results.is_empty() {
                    return Ok(());
                }

                let total = results.len();
                let storage = &context.extensions;

                for chunk in results.chunks(handler_chunk_size()) {
                    let mut events: Vec<EventRecord> = Vec::with_capacity(chunk.len());
                    let mut typed: Vec<TripleCreatedTyped> = Vec::with_capacity(chunk.len());

                    for result in chunk {
                        let tx = &result.tx_information;
                        let event = &result.event_data;

                        let creator = format!("{:?}", event.creator);
                        let term_id_bd = b256_to_bd(&event.termId);
                        let term_id_hex = format!("{:?}", event.termId);
                        let subject_id_bd = b256_to_bd(&event.subjectId);
                        let subject_id_hex = format!("{:?}", event.subjectId);
                        let predicate_id_bd = b256_to_bd(&event.predicateId);
                        let predicate_id_hex = format!("{:?}", event.predicateId);
                        let object_id_bd = b256_to_bd(&event.objectId);
                        let object_id_hex = format!("{:?}", event.objectId);
                        let block_ts = timestamp_to_datetime(tx);
                        let block_hash = format!("{:?}", tx.block_hash);
                        let transaction_hash = format!("{:?}", tx.transaction_hash);
                        let block_number = tx.block_number as i64;
                        let log_index = tx.log_index.to::<i32>();

                        // event_data uses hex strings so downstream Record structs
                        // (term_id: String etc.) can deserialise them directly.
                        // The hex format matches the *_hex columns in typed tables
                        // and is what all dimension tables / projections expect.
                        let event_data = json!({
                            "creator": &creator,
                            "term_id": &term_id_hex,
                            "subject_id": &subject_id_hex,
                            "predicate_id": &predicate_id_hex,
                            "object_id": &object_id_hex,
                        });

                        events.push(EventRecord {
                            block_number,
                            block_timestamp: block_ts,
                            block_hash: block_hash.clone(),
                            transaction_hash: transaction_hash.clone(),
                            log_index,
                            event_type: "TripleCreated".to_string(),
                            event_data,
                        });

                        typed.push(TripleCreatedTyped {
                            block_number,
                            block_timestamp: block_ts,
                            block_hash,
                            transaction_hash,
                            log_index,
                            creator,
                            term_id: term_id_bd,
                            term_id_hex,
                            subject_id: subject_id_bd,
                            subject_id_hex,
                            predicate_id: predicate_id_bd,
                            predicate_id_hex,
                            object_id: object_id_bd,
                            object_id_hex,
                        });
                    }

                    if let Err(e) = storage.insert_triple_created_events(events, typed).await {
                        error!("Failed to insert TripleCreated events: {}", e);
                        return Err(e.to_string());
                    }
                }

                let max_block = results
                    .iter()
                    .map(|r| r.tx_information.block_number)
                    .max()
                    .unwrap_or(0);
                metrics::record_events_with_block("TripleCreated", total as u64, max_block, None);

                info!(
                    "TripleCreated - INDEXED {} events (block {})",
                    total, max_block
                );
                Ok(())
            },
            storage.clone(),
        )
        .await;

    MultiVaultEventType::TripleCreated(handler)
        .register(manifest_path, registry)
        .await;
}

/// Register Deposited event handler
async fn register_deposited_handler(
    manifest_path: &PathBuf,
    registry: &mut EventCallbackRegistry,
    storage: Arc<EventStoreStorage>,
) {
    let handler = DepositedEvent::handler(
        |results: Vec<DepositedResult>, context: Arc<EventContext<Arc<EventStoreStorage>>>| async move {
            if results.is_empty() {
                return Ok(());
            }

            let total = results.len();
            let storage = &context.extensions;

            // Process in sub-batches to bound peak memory (rindexer can deliver 400k+ at once)
            for chunk in results.chunks(handler_chunk_size()) {
                let mut events: Vec<EventRecord> = Vec::with_capacity(chunk.len());
                let mut typed: Vec<DepositedTyped> = Vec::with_capacity(chunk.len());

                for result in chunk {
                    let tx = &result.tx_information;
                    let event = &result.event_data;

                    let sender = format!("{:?}", event.sender);
                    let receiver = format!("{:?}", event.receiver);
                    let term_id_bd = b256_to_bd(&event.termId);
                    let term_id_hex = format!("{:?}", event.termId);
                    let curve_id_str = event.curveId.to_string();
                    let assets_str = event.assets.to_string();
                    let assets_after_fees_str = event.assetsAfterFees.to_string();
                    let shares_str = event.shares.to_string();
                    let total_shares_str = event.totalShares.to_string();
                    let vault_type = event.vaultType;
                    let block_ts = timestamp_to_datetime(tx);
                    let block_hash = format!("{:?}", tx.block_hash);
                    let transaction_hash = format!("{:?}", tx.transaction_hash);
                    let block_number = tx.block_number as i64;
                    let log_index = tx.log_index.to::<i32>();

                    // event_data uses the hex string for term_id so downstream
                    // Record structs (term_id: String) can deserialise it directly.
                    // Numeric fields (curve_id, assets, shares) remain decimal strings
                    // so BigDecimal can parse them.
                    let event_data = json!({
                        "sender": &sender,
                        "receiver": &receiver,
                        "term_id": &term_id_hex,
                        "curve_id": &curve_id_str,
                        "assets": &assets_str,
                        "assets_after_fees": &assets_after_fees_str,
                        "shares": &shares_str,
                        "total_shares": &total_shares_str,
                        "vault_type": vault_type,
                    });

                    events.push(EventRecord {
                        block_number,
                        block_timestamp: block_ts,
                        block_hash: block_hash.clone(),
                        transaction_hash: transaction_hash.clone(),
                        log_index,
                        event_type: "Deposited".to_string(),
                        event_data,
                    });

                    typed.push(DepositedTyped {
                        block_number,
                        block_timestamp: block_ts,
                        block_hash,
                        transaction_hash,
                        log_index,
                        sender,
                        receiver,
                        term_id: term_id_bd,
                        term_id_hex,
                        curve_id: to_bd(&curve_id_str),
                        assets: to_bd(&assets_str),
                        assets_after_fees: to_bd(&assets_after_fees_str),
                        shares: to_bd(&shares_str),
                        total_shares: to_bd(&total_shares_str),
                        vault_type: vault_type as i32,
                    });
                }

                if let Err(e) = storage.insert_deposited_events(events, typed).await {
                    error!("Failed to insert Deposited events: {}", e);
                    return Err(e.to_string());
                }
            }

            let max_block = results.iter().map(|r| r.tx_information.block_number).max().unwrap_or(0);
            metrics::record_events_with_block("Deposited", total as u64, max_block, None);

            info!("Deposited - INDEXED {} events (block {})", total, max_block);
            Ok(())
        },
        storage.clone(),
    )
    .await;

    MultiVaultEventType::Deposited(handler)
        .register(manifest_path, registry)
        .await;
}

/// Register Redeemed event handler
async fn register_redeemed_handler(
    manifest_path: &PathBuf,
    registry: &mut EventCallbackRegistry,
    storage: Arc<EventStoreStorage>,
) {
    let handler = RedeemedEvent::handler(
        |results: Vec<RedeemedResult>, context: Arc<EventContext<Arc<EventStoreStorage>>>| async move {
            if results.is_empty() {
                return Ok(());
            }

            let total = results.len();
            let storage = &context.extensions;

            for chunk in results.chunks(handler_chunk_size()) {
                let mut events: Vec<EventRecord> = Vec::with_capacity(chunk.len());
                let mut typed: Vec<RedeemedTyped> = Vec::with_capacity(chunk.len());

                for result in chunk {
                    let tx = &result.tx_information;
                    let event = &result.event_data;

                    let sender = format!("{:?}", event.sender);
                    let receiver = format!("{:?}", event.receiver);
                    let term_id_bd = b256_to_bd(&event.termId);
                    let term_id_hex = format!("{:?}", event.termId);
                    let curve_id_str = event.curveId.to_string();
                    let shares_str = event.shares.to_string();
                    let total_shares_str = event.totalShares.to_string();
                    let assets_str = event.assets.to_string();
                    let fees_str = event.fees.to_string();
                    let vault_type = event.vaultType;
                    let block_ts = timestamp_to_datetime(tx);
                    let block_hash = format!("{:?}", tx.block_hash);
                    let transaction_hash = format!("{:?}", tx.transaction_hash);
                    let block_number = tx.block_number as i64;
                    let log_index = tx.log_index.to::<i32>();

                    // event_data uses the hex string for term_id so downstream
                    // Record structs (term_id: String) can deserialise it directly.
                    // Numeric fields (curve_id, shares, assets, fees) remain decimal
                    // strings so BigDecimal can parse them.
                    let event_data = json!({
                        "sender": &sender,
                        "receiver": &receiver,
                        "term_id": &term_id_hex,
                        "curve_id": &curve_id_str,
                        "shares": &shares_str,
                        "total_shares": &total_shares_str,
                        "assets": &assets_str,
                        "fees": &fees_str,
                        "vault_type": vault_type,
                    });

                    events.push(EventRecord {
                        block_number,
                        block_timestamp: block_ts,
                        block_hash: block_hash.clone(),
                        transaction_hash: transaction_hash.clone(),
                        log_index,
                        event_type: "Redeemed".to_string(),
                        event_data,
                    });

                    typed.push(RedeemedTyped {
                        block_number,
                        block_timestamp: block_ts,
                        block_hash,
                        transaction_hash,
                        log_index,
                        sender,
                        receiver,
                        term_id: term_id_bd,
                        term_id_hex,
                        curve_id: to_bd(&curve_id_str),
                        shares: to_bd(&shares_str),
                        total_shares: to_bd(&total_shares_str),
                        assets: to_bd(&assets_str),
                        fees: to_bd(&fees_str),
                        vault_type: vault_type as i32,
                    });
                }

                if let Err(e) = storage.insert_redeemed_events(events, typed).await {
                    error!("Failed to insert Redeemed events: {}", e);
                    return Err(e.to_string());
                }
            }

            let max_block = results.iter().map(|r| r.tx_information.block_number).max().unwrap_or(0);
            metrics::record_events_with_block("Redeemed", total as u64, max_block, None);

            info!("Redeemed - INDEXED {} events (block {})", total, max_block);
            Ok(())
        },
        storage.clone(),
    )
    .await;

    MultiVaultEventType::Redeemed(handler)
        .register(manifest_path, registry)
        .await;
}

/// Register SharePriceChanged event handler
async fn register_share_price_changed_handler(
    manifest_path: &PathBuf,
    registry: &mut EventCallbackRegistry,
    storage: Arc<EventStoreStorage>,
) {
    let handler = SharePriceChangedEvent::handler(
        |results: Vec<SharePriceChangedResult>,
         context: Arc<EventContext<Arc<EventStoreStorage>>>| async move {
            if results.is_empty() {
                return Ok(());
            }

            let total = results.len();
            let storage = &context.extensions;

            // Process in sub-batches to bound peak memory
            for chunk in results.chunks(handler_chunk_size()) {
                let mut events: Vec<EventRecord> = Vec::with_capacity(chunk.len());
                let mut typed: Vec<SharePriceChangedTyped> = Vec::with_capacity(chunk.len());

                for result in chunk {
                    let tx = &result.tx_information;
                    let event = &result.event_data;

                    let term_id_bd = b256_to_bd(&event.termId);
                    let term_id_hex = format!("{:?}", event.termId);
                    let curve_id_str = event.curveId.to_string();
                    let share_price_str = event.sharePrice.to_string();
                    let total_assets_str = event.totalAssets.to_string();
                    let total_shares_str = event.totalShares.to_string();
                    let vault_type = event.vaultType;
                    let block_ts = timestamp_to_datetime(tx);
                    let block_hash = format!("{:?}", tx.block_hash);
                    let transaction_hash = format!("{:?}", tx.transaction_hash);
                    let block_number = tx.block_number as i64;
                    let log_index = tx.log_index.to::<i32>();

                    // event_data uses the hex string for term_id so downstream
                    // Record structs (term_id: String) can deserialise it directly.
                    // Numeric fields (curve_id, share_price, etc.) remain decimal strings.
                    let event_data = json!({
                        "term_id": &term_id_hex,
                        "curve_id": &curve_id_str,
                        "share_price": &share_price_str,
                        "total_assets": &total_assets_str,
                        "total_shares": &total_shares_str,
                        "vault_type": vault_type,
                    });

                    events.push(EventRecord {
                        block_number,
                        block_timestamp: block_ts,
                        block_hash: block_hash.clone(),
                        transaction_hash: transaction_hash.clone(),
                        log_index,
                        event_type: "SharePriceChanged".to_string(),
                        event_data,
                    });

                    typed.push(SharePriceChangedTyped {
                        block_number,
                        block_timestamp: block_ts,
                        block_hash,
                        transaction_hash,
                        log_index,
                        term_id: term_id_bd,
                        term_id_hex,
                        curve_id: to_bd(&curve_id_str),
                        share_price: to_bd(&share_price_str),
                        total_assets: to_bd(&total_assets_str),
                        total_shares: to_bd(&total_shares_str),
                        vault_type: vault_type as i32,
                    });
                }

                if let Err(e) = storage
                    .insert_share_price_changed_events(events, typed)
                    .await
                {
                    error!("Failed to insert SharePriceChanged events: {}", e);
                    return Err(e.to_string());
                }
            }

            let max_block = results
                .iter()
                .map(|r| r.tx_information.block_number)
                .max()
                .unwrap_or(0);
            metrics::record_events_with_block("SharePriceChanged", total as u64, max_block, None);

            info!(
                "SharePriceChanged - INDEXED {} events (block {})",
                total, max_block
            );
            Ok(())
        },
        storage.clone(),
    )
    .await;

    MultiVaultEventType::SharePriceChanged(handler)
        .register(manifest_path, registry)
        .await;
}

/// Register ProtocolFeeAccrued event handler
async fn register_protocol_fee_accrued_handler(
    manifest_path: &PathBuf,
    registry: &mut EventCallbackRegistry,
    storage: Arc<EventStoreStorage>,
) {
    let handler = ProtocolFeeAccruedEvent::handler(
        |results: Vec<ProtocolFeeAccruedResult>,
         context: Arc<EventContext<Arc<EventStoreStorage>>>| async move {
            if results.is_empty() {
                return Ok(());
            }

            let total = results.len();
            let storage = &context.extensions;

            for chunk in results.chunks(handler_chunk_size()) {
                let mut events: Vec<EventRecord> = Vec::with_capacity(chunk.len());
                let mut typed: Vec<ProtocolFeeAccruedTyped> = Vec::with_capacity(chunk.len());

                for result in chunk {
                    let tx = &result.tx_information;
                    let event = &result.event_data;

                    let epoch_str = event.epoch.to_string();
                    let sender = format!("{:?}", event.sender);
                    let amount_str = event.amount.to_string();
                    let block_ts = timestamp_to_datetime(tx);
                    let block_hash = format!("{:?}", tx.block_hash);
                    let transaction_hash = format!("{:?}", tx.transaction_hash);
                    let block_number = tx.block_number as i64;
                    let log_index = tx.log_index.to::<i32>();

                    let event_data = json!({
                        "epoch": &epoch_str,
                        "sender": &sender,
                        "amount": &amount_str,
                    });

                    events.push(EventRecord {
                        block_number,
                        block_timestamp: block_ts,
                        block_hash: block_hash.clone(),
                        transaction_hash: transaction_hash.clone(),
                        log_index,
                        event_type: "ProtocolFeeAccrued".to_string(),
                        event_data,
                    });

                    typed.push(ProtocolFeeAccruedTyped {
                        block_number,
                        block_timestamp: block_ts,
                        block_hash,
                        transaction_hash,
                        log_index,
                        epoch: to_bd(&epoch_str),
                        sender,
                        amount: to_bd(&amount_str),
                    });
                }

                if let Err(e) = storage
                    .insert_protocol_fee_accrued_events(events, typed)
                    .await
                {
                    error!("Failed to insert ProtocolFeeAccrued events: {}", e);
                    return Err(e.to_string());
                }
            }

            let max_block = results
                .iter()
                .map(|r| r.tx_information.block_number)
                .max()
                .unwrap_or(0);
            metrics::record_events_with_block("ProtocolFeeAccrued", total as u64, max_block, None);

            info!(
                "ProtocolFeeAccrued - INDEXED {} events (block {})",
                total, max_block
            );
            Ok(())
        },
        storage.clone(),
    )
    .await;

    MultiVaultEventType::ProtocolFeeAccrued(handler)
        .register(manifest_path, registry)
        .await;
}
