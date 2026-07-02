#![allow(non_snake_case)]
use super::super::super::typings::be_v_3_indexer::events::multi_vault::{
    no_extensions, AtomCreatedEvent, DepositedEvent, MultiVaultEventType, RedeemedEvent,
    SharePriceChangedEvent, TripleCreatedEvent,
};
use alloy::primitives::{I256, U256, U64};
use rindexer::{
    event::callback_registry::EventCallbackRegistry, rindexer_error, rindexer_info,
    EthereumSqlTypeWrapper, PgType, RindexerColorize,
};
use std::path::PathBuf;
use std::sync::Arc;

async fn atom_created_handler(manifest_path: &PathBuf, registry: &mut EventCallbackRegistry) {
    let handler = AtomCreatedEvent::handler(
        |results, context| async move {
            if results.is_empty() {
                return Ok(());
            }

            rindexer_info!(
                "MultiVault::AtomCreated - {} - {} events",
                "INDEXED".green(),
                results.len(),
            );

            Ok(())
        },
        no_extensions(),
    )
    .await;

    MultiVaultEventType::AtomCreated(handler)
        .register(manifest_path, registry)
        .await;
}

async fn deposited_handler(manifest_path: &PathBuf, registry: &mut EventCallbackRegistry) {
    let handler = DepositedEvent::handler(
        |results, context| async move {
            if results.is_empty() {
                return Ok(());
            }

            rindexer_info!(
                "MultiVault::Deposited - {} - {} events",
                "INDEXED".green(),
                results.len(),
            );

            Ok(())
        },
        no_extensions(),
    )
    .await;

    MultiVaultEventType::Deposited(handler)
        .register(manifest_path, registry)
        .await;
}

async fn redeemed_handler(manifest_path: &PathBuf, registry: &mut EventCallbackRegistry) {
    let handler = RedeemedEvent::handler(
        |results, context| async move {
            if results.is_empty() {
                return Ok(());
            }

            rindexer_info!(
                "MultiVault::Redeemed - {} - {} events",
                "INDEXED".green(),
                results.len(),
            );

            Ok(())
        },
        no_extensions(),
    )
    .await;

    MultiVaultEventType::Redeemed(handler)
        .register(manifest_path, registry)
        .await;
}

async fn share_price_changed_handler(
    manifest_path: &PathBuf,
    registry: &mut EventCallbackRegistry,
) {
    let handler = SharePriceChangedEvent::handler(
        |results, context| async move {
            if results.is_empty() {
                return Ok(());
            }

            rindexer_info!(
                "MultiVault::SharePriceChanged - {} - {} events",
                "INDEXED".green(),
                results.len(),
            );

            Ok(())
        },
        no_extensions(),
    )
    .await;

    MultiVaultEventType::SharePriceChanged(handler)
        .register(manifest_path, registry)
        .await;
}

async fn triple_created_handler(manifest_path: &PathBuf, registry: &mut EventCallbackRegistry) {
    let handler = TripleCreatedEvent::handler(
        |results, context| async move {
            if results.is_empty() {
                return Ok(());
            }

            rindexer_info!(
                "MultiVault::TripleCreated - {} - {} events",
                "INDEXED".green(),
                results.len(),
            );

            Ok(())
        },
        no_extensions(),
    )
    .await;

    MultiVaultEventType::TripleCreated(handler)
        .register(manifest_path, registry)
        .await;
}
pub async fn multi_vault_handlers(manifest_path: &PathBuf, registry: &mut EventCallbackRegistry) {
    atom_created_handler(manifest_path, registry).await;

    deposited_handler(manifest_path, registry).await;

    redeemed_handler(manifest_path, registry).await;

    share_price_changed_handler(manifest_path, registry).await;

    triple_created_handler(manifest_path, registry).await;
}
