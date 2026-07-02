//! Prometheus metrics for rindexer-ingestion
//!
//! Tracks indexing progress per event type

use ahash::AHashMap;
use axum::{routing::get, Router};
use prometheus::{
    register_gauge_vec, register_int_counter_vec, Encoder, GaugeVec, IntCounterVec, TextEncoder,
};
use std::net::SocketAddr;
use std::sync::{OnceLock, RwLock};
use tokio::net::TcpListener;
use tracing::info;

/// Start block read from MULTIVAULT_START_BLOCK env var at runtime
pub fn start_block() -> u64 {
    static BLOCK: std::sync::OnceLock<u64> = std::sync::OnceLock::new();
    *BLOCK.get_or_init(|| {
        std::env::var("MULTIVAULT_START_BLOCK")
            .ok()
            .and_then(|v| v.parse().ok())
            .expect("MULTIVAULT_START_BLOCK environment variable must be set to a valid u64")
    })
}

// Global metrics - initialized once
static METRICS: OnceLock<Metrics> = OnceLock::new();

// Track the latest block per event type for progress calculation
// Uses AHashMap for faster lookups during high-frequency block tracking
static LATEST_BLOCKS: OnceLock<RwLock<AHashMap<String, u64>>> = OnceLock::new();

fn latest_blocks() -> &'static RwLock<AHashMap<String, u64>> {
    LATEST_BLOCKS.get_or_init(|| RwLock::new(AHashMap::new()))
}

pub struct Metrics {
    /// Events indexed counter per event type
    pub events_indexed: IntCounterVec,

    /// Sync progress percentage per event type (0-100)
    pub sync_progress_percent: GaugeVec,

    /// Current block being processed per event type
    pub current_block: GaugeVec,

    /// Latest block on chain
    pub latest_block: GaugeVec,

    /// Blocks behind per event type
    pub blocks_behind: GaugeVec,

    /// Indexing status: 0=pending, 1=syncing, 2=completed
    pub indexing_status: GaugeVec,
}

impl Metrics {
    fn new() -> Self {
        // Note: These metrics are registered once via OnceLock. If registration fails,
        // it indicates a fundamental setup issue that should be visible at startup.
        // We use unwrap_or_else to log and create fallback metrics if possible.
        Self {
            events_indexed: register_int_counter_vec!(
                "intuition_events_indexed_total",
                "Total events indexed per event type",
                &["event_type"]
            )
            .unwrap_or_else(|e| {
                tracing::error!("Failed to create events_indexed counter: {}", e);
                IntCounterVec::new(
                    prometheus::opts!(
                        "intuition_events_indexed_total_fallback",
                        "Fallback counter"
                    ),
                    &["event_type"],
                )
                .unwrap()
            }),

            sync_progress_percent: register_gauge_vec!(
                "intuition_sync_progress_percent",
                "Sync progress percentage per event type (0-100)",
                &["event_type"]
            )
            .unwrap_or_else(|e| {
                tracing::error!("Failed to create sync_progress_percent gauge: {}", e);
                GaugeVec::new(
                    prometheus::opts!("intuition_sync_progress_percent_fallback", "Fallback gauge"),
                    &["event_type"],
                )
                .unwrap()
            }),

            current_block: register_gauge_vec!(
                "intuition_current_block",
                "Current block number per event type",
                &["event_type"]
            )
            .unwrap_or_else(|e| {
                tracing::error!("Failed to create current_block gauge: {}", e);
                GaugeVec::new(
                    prometheus::opts!("intuition_current_block_fallback", "Fallback gauge"),
                    &["event_type"],
                )
                .unwrap()
            }),

            latest_block: register_gauge_vec!(
                "intuition_latest_block",
                "Latest block on chain per event type",
                &["event_type"]
            )
            .unwrap_or_else(|e| {
                tracing::error!("Failed to create latest_block gauge: {}", e);
                GaugeVec::new(
                    prometheus::opts!("intuition_latest_block_fallback", "Fallback gauge"),
                    &["event_type"],
                )
                .unwrap()
            }),

            blocks_behind: register_gauge_vec!(
                "intuition_blocks_behind",
                "Blocks behind chain tip per event type",
                &["event_type"]
            )
            .unwrap_or_else(|e| {
                tracing::error!("Failed to create blocks_behind gauge: {}", e);
                GaugeVec::new(
                    prometheus::opts!("intuition_blocks_behind_fallback", "Fallback gauge"),
                    &["event_type"],
                )
                .unwrap()
            }),

            indexing_status: register_gauge_vec!(
                "intuition_indexing_status",
                "Indexing status per event type: 0=pending, 1=syncing, 2=completed",
                &["event_type"]
            )
            .unwrap_or_else(|e| {
                tracing::error!("Failed to create indexing_status gauge: {}", e);
                GaugeVec::new(
                    prometheus::opts!("intuition_indexing_status_fallback", "Fallback gauge"),
                    &["event_type"],
                )
                .unwrap()
            }),
        }
    }
}

/// Get or initialize the global metrics instance
pub fn metrics() -> &'static Metrics {
    METRICS.get_or_init(Metrics::new)
}

/// Record events indexed and update progress based on block number
pub fn record_events_with_block(
    event_type: &str,
    count: u64,
    block_number: u64,
    latest_block: Option<u64>,
) {
    // Update event counter
    metrics()
        .events_indexed
        .with_label_values(&[event_type])
        .inc_by(count);

    // Update or get the latest known block for this event type
    let effective_latest = {
        let mut blocks = match latest_blocks().write() {
            Ok(guard) => guard,
            Err(poisoned) => {
                tracing::warn!("RwLock poisoned in record_events_with_block, recovering");
                poisoned.into_inner()
            }
        };
        if let Some(latest) = latest_block {
            blocks.insert(event_type.to_string(), latest);
            latest
        } else {
            // Use the block_number as a lower bound if we don't have latest
            *blocks.entry(event_type.to_string()).or_insert(block_number)
        }
    };

    // Calculate progress
    let total_blocks = effective_latest.saturating_sub(start_block());
    let processed_blocks = block_number.saturating_sub(start_block());

    let progress = if total_blocks > 0 {
        ((processed_blocks as f64 / total_blocks as f64) * 100.0).min(100.0)
    } else {
        100.0
    };

    // Update progress metrics
    update_progress(event_type, block_number, effective_latest, progress);
}

/// Set the latest known block for progress calculation
pub fn set_latest_block(event_type: &str, latest_block: u64) {
    let mut blocks = match latest_blocks().write() {
        Ok(guard) => guard,
        Err(poisoned) => {
            tracing::warn!("RwLock poisoned in set_latest_block, recovering");
            poisoned.into_inner()
        }
    };
    blocks.insert(event_type.to_string(), latest_block);
}

/// Update sync progress for an event type
pub fn update_progress(event_type: &str, current_block: u64, latest_block: u64, progress: f64) {
    let m = metrics();

    m.current_block
        .with_label_values(&[event_type])
        .set(current_block as f64);

    m.latest_block
        .with_label_values(&[event_type])
        .set(latest_block as f64);

    let behind = latest_block.saturating_sub(current_block);
    m.blocks_behind
        .with_label_values(&[event_type])
        .set(behind as f64);

    m.sync_progress_percent
        .with_label_values(&[event_type])
        .set(progress);

    // Status: 1=syncing, 2=completed
    let status = if progress >= 100.0 { 2.0 } else { 1.0 };
    m.indexing_status
        .with_label_values(&[event_type])
        .set(status);
}

/// Handler for /metrics endpoint
async fn metrics_handler() -> String {
    let encoder = TextEncoder::new();
    let metric_families = prometheus::gather();
    let mut buffer = Vec::new();
    if let Err(e) = encoder.encode(&metric_families, &mut buffer) {
        tracing::error!("Failed to encode metrics: {}", e);
        return "# Error encoding metrics".to_string();
    }
    String::from_utf8(buffer).unwrap_or_else(|e| {
        tracing::error!("Metrics buffer contains invalid UTF-8: {}", e);
        "# Error: invalid UTF-8 in metrics".to_string()
    })
}

/// Handler for /health endpoint
async fn health_handler() -> &'static str {
    "OK"
}

/// Start the metrics HTTP server
pub async fn start_metrics_server(
    port: u16,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Initialize metrics with default values for all event types
    let event_types = [
        "AtomCreated",
        "TripleCreated",
        "Deposited",
        "Redeemed",
        "SharePriceChanged",
        "ProtocolFeeAccrued",
    ];
    for event_type in &event_types {
        metrics()
            .sync_progress_percent
            .with_label_values(&[event_type])
            .set(0.0);
        metrics()
            .indexing_status
            .with_label_values(&[event_type])
            .set(0.0); // pending
    }

    let app = Router::new()
        .route("/metrics", get(metrics_handler))
        .route("/health", get(health_handler));

    let addr = SocketAddr::from(([0, 0, 0, 0], port));
    let listener = TcpListener::bind(addr).await?;

    info!(
        "📊 Metrics server started on http://0.0.0.0:{}/metrics",
        port
    );

    axum::serve(listener, app).await?;
    Ok(())
}
