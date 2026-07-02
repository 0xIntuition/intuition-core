//! rindexer-based ingestion service
//!
//! This service uses rindexer as a Rust library to index blockchain events
//! and writes them directly to the existing event_store TimescaleDB table.

use std::path::PathBuf;
use std::sync::Arc;

use tracing::{info, warn};
use tracing_subscriber::EnvFilter;

mod handlers;
mod metrics;
mod rindexer_lib;
mod storage;

/// Fetch the latest block number from the RPC
async fn fetch_latest_block(rpc_url: &str) -> Option<u64> {
    let client = reqwest::Client::new();
    let response = client
        .post(rpc_url)
        .json(&serde_json::json!({
            "jsonrpc": "2.0",
            "method": "eth_blockNumber",
            "params": [],
            "id": 1
        }))
        .send()
        .await
        .ok()?;

    let json: serde_json::Value = response.json().await.ok()?;
    let hex_str = json.get("result")?.as_str()?;
    u64::from_str_radix(hex_str.trim_start_matches("0x"), 16).ok()
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Initialize logging
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env().add_directive("info".parse()?))
        .init();

    info!("Starting rindexer-ingestion service");

    // Load environment variables
    dotenvy::dotenv().ok();

    // Get database URL
    let database_url = std::env::var("DATABASE_URL")
        .map_err(|_| "DATABASE_URL environment variable must be set")?;

    // Initialize database connection pool
    let pool = sqlx::PgPool::connect(&database_url).await?;
    info!("Connected to database");

    // Get manifest path (rindexer.yaml)
    let manifest_path = PathBuf::from(
        std::env::var("RINDEXER_MANIFEST_PATH").unwrap_or_else(|_| "./rindexer.yaml".to_string()),
    );

    info!("Using manifest: {:?}", manifest_path);

    // Create shared storage handler
    let storage = Arc::new(storage::EventStoreStorage::new(pool));

    // Get metrics port
    let metrics_port: u16 = std::env::var("METRICS_PORT")
        .unwrap_or_else(|_| "9091".to_string())
        .parse()
        .map_err(|_| "METRICS_PORT must be a valid port number")?;

    // Fetch latest block to initialize progress tracking. No baked-in fallback:
    // the RPC endpoint is deployment configuration, not a code default.
    let rpc_url = std::env::var("INTUITION_RPC_URL")
        .map_err(|_| "INTUITION_RPC_URL environment variable must be set")?;
    if let Some(latest_block) = fetch_latest_block(&rpc_url).await {
        info!("Latest block on chain: {}", latest_block);
        // Set the latest block for all event types
        for event_type in &[
            "AtomCreated",
            "TripleCreated",
            "Deposited",
            "Redeemed",
            "SharePriceChanged",
        ] {
            metrics::set_latest_block(event_type, latest_block);
        }
    } else {
        warn!("Could not fetch latest block from RPC, progress tracking may be inaccurate");
    }

    // Start metrics server in background
    tokio::spawn(async move {
        if let Err(e) = metrics::start_metrics_server(metrics_port).await {
            tracing::error!("Metrics server error: {}", e);
        }
    });

    // Start rindexer with custom handlers
    handlers::start_indexer(manifest_path, storage).await?;

    Ok(())
}
