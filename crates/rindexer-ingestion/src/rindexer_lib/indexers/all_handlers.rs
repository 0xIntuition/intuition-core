use super::be_v_3_indexer::multi_vault::multi_vault_handlers;
use rindexer::event::callback_registry::EventCallbackRegistry;
use std::path::PathBuf;

pub async fn register_all_handlers(manifest_path: &PathBuf) -> EventCallbackRegistry {
    let mut registry = EventCallbackRegistry::new();
    multi_vault_handlers(manifest_path, &mut registry).await;
    registry
}
