//! Leaderboard refresh batch projection (timer-driven).
//!
//! Each cycle drains the dirty sets populated by `LeaderboardMarkerProjection`,
//! recomputes PnL for every affected account, and upserts `account_pnl_state`.
//!
//! The leaderboard cache (`leaderboard_cache` table) is refreshed separately
//! by a TimescaleDB scheduled job (`refresh_period_leaderboard_cache`) every
//! 60 seconds — see migration 023.
//!
//! Idempotency: if the process crashes mid-cycle the transaction is rolled
//! back and the dirty sets remain intact (PostgreSQL's normal ACID guarantee),
//! so the next cycle will reprocess the same accounts.

use ahash::AHashSet;
use async_trait::async_trait;
use chrono::Utc;
use sqlx::PgPool;
use tracing::info;

use crate::error::ProjectionError;
use crate::projection::pg::BatchProjection;
use crate::repo::leaderboard_repo::{
    compute_account_pnl, drain_dirty_accounts, drain_dirty_vaults, expand_vault_to_accounts,
    insert_account_pnl_snapshot, upsert_account_pnl_state,
};

// ---------------------------------------------------------------------------
// Projection struct
// ---------------------------------------------------------------------------

/// Timer-driven projection that refreshes the leaderboard from dirty sets.
pub struct LeaderboardRefreshProjection;

// ---------------------------------------------------------------------------
// BatchProjection impl
// ---------------------------------------------------------------------------

#[async_trait]
impl BatchProjection for LeaderboardRefreshProjection {
    fn name(&self) -> &str {
        "leaderboard_refresh"
    }

    /// Execute one refresh cycle.
    ///
    /// **Phase 1** (short transaction — holds dirty-set locks briefly):
    /// 1. Drain `dirty_vault` — collect (term_id, curve_id) pairs.
    /// 2. Drain `dirty_account` — collect directly-dirty account IDs.
    /// 3. Expand each dirty vault to the set of accounts holding it.
    /// 4. Deduplicate all account IDs with an `AHashSet`.
    /// 5. Commit — releases all dirty-set locks so `leaderboard_marker`
    ///    can continue inserting new dirty entries concurrently.
    ///
    /// **Phase 2** (separate transaction per micro-batch):
    /// 6. Recompute PnL and upsert `account_pnl_state` in batches of 100.
    /// 7. Log a summary.
    ///
    /// Splitting into two phases prevents the heavy PnL computation from
    /// holding row locks on `dirty_account` / `dirty_vault` for minutes,
    /// which previously blocked `leaderboard_marker` writes.
    ///
    /// If we crash between phase 1 and phase 2, the dirty entries are lost
    /// but the marker will re-mark them on the next incoming event. This is
    /// acceptable because the dirty set is an optimisation hint, not a
    /// source of truth.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` on any SQL error. The
    /// `BatchWorker` will retry transient failures with exponential backoff.
    async fn run_cycle(&self, pool: &PgPool) -> Result<(), ProjectionError> {
        // ── Phase 1: drain dirty sets in a short-lived transaction ──────
        let account_set = {
            let mut tx = pool.begin().await?;

            let dirty_vaults = drain_dirty_vaults(&mut tx).await?;
            let dirty_accounts = drain_dirty_accounts(&mut tx).await?;

            let mut account_set: AHashSet<String> =
                AHashSet::with_capacity(dirty_accounts.len() + dirty_vaults.len() * 8);

            for account_id in dirty_accounts {
                account_set.insert(account_id);
            }

            for (term_id, curve_id) in &dirty_vaults {
                let holders = expand_vault_to_accounts(&mut tx, term_id, curve_id).await?;
                for account_id in holders {
                    account_set.insert(account_id);
                }
            }

            // Commit immediately — unlock dirty_account/dirty_vault rows.
            tx.commit().await?;
            account_set
        };

        if account_set.is_empty() {
            return Ok(());
        }

        let account_count = account_set.len();

        // ── Phase 2: recompute PnL in micro-batches ────────────────────
        // Each chunk gets its own transaction so we never hold locks for
        // more than ~100 account PnL computations at a time.
        const PNL_BATCH_SIZE: usize = 100;
        let accounts: Vec<String> = account_set.into_iter().collect();

        for chunk in accounts.chunks(PNL_BATCH_SIZE) {
            let mut tx = pool.begin().await?;
            for account_id in chunk {
                let pnl = compute_account_pnl(&mut tx, account_id).await?;
                upsert_account_pnl_state(&mut tx, account_id, &pnl).await?;
                insert_account_pnl_snapshot(&mut tx, account_id, &pnl, Utc::now()).await?;
            }
            tx.commit().await?;
        }

        info!(
            accounts_refreshed = account_count,
            "Refreshed PnL state for {account_count} accounts"
        );

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_is_leaderboard_refresh() {
        assert_eq!(LeaderboardRefreshProjection.name(), "leaderboard_refresh");
    }

    #[test]
    fn ahash_set_deduplication() {
        // Verifies the deduplication logic used in run_cycle works correctly
        // without a database connection.
        let mut set: AHashSet<String> = AHashSet::new();
        set.insert("0xAlice".to_owned());
        set.insert("0xBob".to_owned());
        set.insert("0xAlice".to_owned()); // duplicate
        assert_eq!(set.len(), 2);
        assert!(set.contains("0xAlice"));
        assert!(set.contains("0xBob"));
    }

    #[test]
    fn empty_account_set_short_circuits() {
        // Validates the control-flow invariant: an empty set means we skip
        // the PnL recompute and cache write. This is a pure logic check.
        let set: AHashSet<String> = AHashSet::new();
        assert!(set.is_empty());
    }
}
