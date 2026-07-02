/// Network provider configuration.
///
/// Originally scaffolded by rindexer codegen, now manually maintained so that
/// RPC URL and chain ID are read from environment variables at runtime.
/// This allows a single binary to be deployed across multiple environments.
///
/// Re-run `cargo make codegen` only when the contract ABI changes;
/// this file will NOT be overwritten (it is excluded from codegen output).
use alloy::{primitives::U64, transports::http::reqwest::header::HeaderMap};
use rindexer::{
    lazy_static,
    manifest::network::{AddressFiltering, BlockPollFrequency},
    notifications::ChainStateNotification,
    provider::{create_client, JsonRpcCachedProvider, RetryClientError, RindexerProvider},
    public_read_env_value,
};
use std::sync::Arc;
use tokio::sync::broadcast::Sender;
use tokio::sync::OnceCell;

#[allow(dead_code)]
async fn create_shadow_client(
    rpc_url: &str,
    chain_id: u64,
    compute_units_per_second: Option<u64>,
    block_poll_frequency: Option<BlockPollFrequency>,
    max_block_range: Option<U64>,
    address_filtering: Option<AddressFiltering>,
    chain_state_notification: Option<Sender<ChainStateNotification>>,
) -> Result<Arc<JsonRpcCachedProvider>, RetryClientError> {
    let mut header = HeaderMap::new();
    header.insert(
        "X-SHADOW-API-KEY",
        public_read_env_value("RINDEXER_PHANTOM_API_KEY")
            .unwrap()
            .parse()
            .unwrap(),
    );
    create_client(
        rpc_url,
        chain_id,
        compute_units_per_second,
        max_block_range,
        block_poll_frequency,
        header,
        address_filtering,
        chain_state_notification,
    )
    .await
}

static INTUITION_PROVIDER: OnceCell<Arc<JsonRpcCachedProvider>> = OnceCell::const_new();

pub async fn get_intuition_provider_cache() -> Arc<JsonRpcCachedProvider> {
    INTUITION_PROVIDER
        .get_or_init(|| async {
            let chain_state_notification = None;

            let rpc_url = std::env::var("INTUITION_RPC_URL")
                .expect("INTUITION_RPC_URL environment variable must be set");

            let chain_id: u64 = std::env::var("CHAIN_ID")
                .expect("CHAIN_ID environment variable must be set")
                .parse()
                .expect("CHAIN_ID must be a valid u64");

            create_client(
                &rpc_url,
                chain_id,
                None,
                None,
                None,
                HeaderMap::new(),
                None,
                chain_state_notification,
            )
            .await
            .expect("Error creating provider")
        })
        .await
        .clone()
}

pub async fn get_intuition_provider() -> Arc<RindexerProvider> {
    get_intuition_provider_cache().await.get_inner_provider()
}

pub async fn get_provider_cache_for_network(network: &str) -> Arc<JsonRpcCachedProvider> {
    if network == "intuition" {
        return get_intuition_provider_cache().await;
    }
    panic!("Network not supported")
}
