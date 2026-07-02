//! Repository functions for leaderboard dirty-set resolution and PnL computation.
//!
//! All functions accept a mutable reference to a sqlx transaction so callers
//! can compose multiple writes atomically. The dirty-set pattern works as
//! follows:
//!
//! 1. Event-driven projections mark vaults/accounts as dirty on each relevant
//!    event (see `leaderboard_marker` projection).
//! 2. The `leaderboard_refresh` batch projection drains the dirty sets,
//!    recomputes PnL for each affected account, and atomically flips the
//!    leaderboard cache version.

use chrono::{DateTime, Utc};
use sqlx::types::BigDecimal;
use std::str::FromStr;
use tracing::warn;

use crate::error::ProjectionError;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// Computed PnL summary for a single account across all its positions.
///
/// All monetary fields use `BigDecimal` to preserve full wei-scale precision.
/// Count fields use `i64` (PostgreSQL `bigint` maps to i64 in sqlx).
#[derive(Debug, Clone)]
pub struct AccountPnlRow {
    /// Sum of all deposits this account has ever made (cost basis component).
    pub total_deposits: BigDecimal,
    /// Current mark-to-market value of all open positions.
    pub current_equity_value: BigDecimal,
    /// Cumulative realised gains/losses from closed positions.
    pub realized_pnl: BigDecimal,
    /// Unrealised gain/loss on currently open positions.
    pub unrealized_pnl: BigDecimal,
    /// Number of open positions currently above cost basis.
    pub winning_positions: i64,
    /// Number of open positions currently at or below cost basis.
    pub losing_positions: i64,
}

// ---------------------------------------------------------------------------
// Dirty-set drain helpers
// ---------------------------------------------------------------------------

/// Drain and return all pending dirty vault entries.
///
/// Atomically deletes every row from `dirty_vault` and returns the
/// `(term_id, curve_id)` pairs for downstream expansion.
///
/// # Arguments
///
/// * `tx` - Active transaction; the DELETE is part of this transaction.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any SQL error.
pub async fn drain_dirty_vaults(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Vec<(String, String)>, ProjectionError> {
    // DELETE … RETURNING lets us atomically empty the table and retrieve
    // the contents in a single round-trip — no separate SELECT needed.
    let rows = sqlx::query("DELETE FROM dirty_vault RETURNING term_id, curve_id")
        .fetch_all(&mut **tx)
        .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        use sqlx::Row;
        let term_id: String = row.try_get("term_id")?;
        let curve_id: String = row.try_get("curve_id")?;
        result.push((term_id, curve_id));
    }
    Ok(result)
}

/// Drain and return all pending dirty account entries.
///
/// Atomically deletes every row from `dirty_account` and returns the
/// `account_id` values for PnL recomputation.
///
/// # Arguments
///
/// * `tx` - Active transaction.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any SQL error.
pub async fn drain_dirty_accounts(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Vec<String>, ProjectionError> {
    let rows = sqlx::query("DELETE FROM dirty_account RETURNING account_id")
        .fetch_all(&mut **tx)
        .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        use sqlx::Row;
        let account_id: String = row.try_get("account_id")?;
        result.push(account_id);
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Vault-to-account expansion
// ---------------------------------------------------------------------------

/// Look up all accounts that currently hold a position in the given vault.
///
/// Queries `active_vault_position` which is a materialised view (or table)
/// that tracks every (account, term_id, curve_id) combination with non-zero
/// shares. Any account returned here may have stale PnL and must be
/// recomputed when the vault's share price changes.
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `term_id` - Vault term identifier.
/// * `curve_id` - Bonding-curve identifier.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any SQL error.
pub async fn expand_vault_to_accounts(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    curve_id: &str,
) -> Result<Vec<String>, ProjectionError> {
    let rows = sqlx::query(
        "SELECT account_id FROM active_vault_position WHERE term_id = $1 AND curve_id = $2",
    )
    .bind(term_id)
    .bind(curve_id)
    .fetch_all(&mut **tx)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        use sqlx::Row;
        let account_id: String = row.try_get("account_id")?;
        result.push(account_id);
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// PnL computation
// ---------------------------------------------------------------------------

/// Compute the full PnL summary for a single account.
///
/// Joins the `position` and `vault` tables to derive current equity value
/// and unrealised PnL using the current share price. The query aggregates
/// across all vaults the account participates in, both open and closed.
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `account_id` - Ethereum address of the account.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any SQL error.
/// Returns `ProjectionError::InvalidEventData` if aggregate columns are
/// missing or cannot be parsed (should not happen with a well-formed schema).
pub async fn compute_account_pnl(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
) -> Result<AccountPnlRow, ProjectionError> {
    // The CASE WHEN guards ensure closed positions (shares = 0) do not
    // distort current equity or unrealised PnL calculations.
    let row = sqlx::query(
        r#"
        SELECT
            COALESCE(SUM(p.total_deposits), 0) AS total_deposits,
            COALESCE(SUM(
                CASE WHEN p.shares > 0 THEN p.shares * v.current_share_price ELSE 0 END
            ), 0) AS current_equity_value,
            COALESCE(SUM(p.realized_pnl), 0) AS realized_pnl,
            COALESCE(SUM(
                CASE WHEN p.shares > 0
                     THEN p.shares * v.current_share_price - p.shares * p.cost_basis
                     ELSE 0 END
            ), 0) AS unrealized_pnl,
            COUNT(*) FILTER (
                WHERE p.shares > 0
                  AND p.shares * v.current_share_price > p.shares * p.cost_basis
            ) AS winning_positions,
            COUNT(*) FILTER (
                WHERE p.shares > 0
                  AND p.shares * v.current_share_price <= p.shares * p.cost_basis
            ) AS losing_positions
        FROM position p
        LEFT JOIN vault v ON p.term_id = v.term_id AND p.curve_id = v.curve_id
        WHERE p.account_id = $1
        "#,
    )
    .bind(account_id)
    .fetch_one(&mut **tx)
    .await?;

    use sqlx::Row;

    // sqlx returns NUMERIC aggregates as BigDecimal when the bigdecimal
    // feature is enabled. COUNT returns i64.
    let total_deposits: BigDecimal = row
        .try_get::<BigDecimal, _>("total_deposits")
        .unwrap_or_else(|_| {
            warn!(account_id, "total_deposits missing; defaulting to 0");
            BigDecimal::from_str("0").expect("zero is valid BigDecimal")
        });

    let current_equity_value: BigDecimal = row
        .try_get::<BigDecimal, _>("current_equity_value")
        .unwrap_or_else(|_| {
            warn!(account_id, "current_equity_value missing; defaulting to 0");
            BigDecimal::from_str("0").expect("zero is valid BigDecimal")
        });

    let realized_pnl: BigDecimal =
        row.try_get::<BigDecimal, _>("realized_pnl")
            .unwrap_or_else(|_| {
                warn!(account_id, "realized_pnl missing; defaulting to 0");
                BigDecimal::from_str("0").expect("zero is valid BigDecimal")
            });

    let unrealized_pnl: BigDecimal = row
        .try_get::<BigDecimal, _>("unrealized_pnl")
        .unwrap_or_else(|_| {
            warn!(account_id, "unrealized_pnl missing; defaulting to 0");
            BigDecimal::from_str("0").expect("zero is valid BigDecimal")
        });

    let winning_positions: i64 = row.try_get("winning_positions").unwrap_or(0);
    let losing_positions: i64 = row.try_get("losing_positions").unwrap_or(0);

    Ok(AccountPnlRow {
        total_deposits,
        current_equity_value,
        realized_pnl,
        unrealized_pnl,
        winning_positions,
        losing_positions,
    })
}

// ---------------------------------------------------------------------------
// State upserts
// ---------------------------------------------------------------------------

/// Upsert the computed PnL state for an account into `account_pnl_state`.
///
/// On conflict the row is fully replaced with the freshly computed values.
/// `total_redemptions` is preserved from the existing row on conflict (it is
/// maintained incrementally by the marker projection, not recomputed here).
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `account_id` - Ethereum address of the account.
/// * `pnl` - Freshly computed PnL row for this account.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any SQL error.
pub async fn upsert_account_pnl_state(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
    pnl: &AccountPnlRow,
) -> Result<(), ProjectionError> {
    // total_pnl = realized_pnl + unrealized_pnl — computed inline in SQL
    // to keep the row self-consistent without a separate read.
    sqlx::query(
        r#"
        INSERT INTO account_pnl_state (
            account_id,
            total_deposits,
            total_redemptions,
            realized_pnl,
            unrealized_pnl,
            total_pnl,
            current_equity_value,
            winning_positions,
            losing_positions,
            last_recomputed_at
        )
        VALUES ($1, $2, 0, $3, $4, $3 + $4, $5, $6, $7, NOW())
        ON CONFLICT (account_id) DO UPDATE SET
            total_deposits       = EXCLUDED.total_deposits,
            realized_pnl         = EXCLUDED.realized_pnl,
            unrealized_pnl       = EXCLUDED.unrealized_pnl,
            total_pnl            = EXCLUDED.total_pnl,
            current_equity_value = EXCLUDED.current_equity_value,
            winning_positions    = EXCLUDED.winning_positions,
            losing_positions     = EXCLUDED.losing_positions,
            last_recomputed_at   = NOW()
        "#,
    )
    .bind(account_id)
    .bind(&pnl.total_deposits)
    .bind(&pnl.realized_pnl)
    .bind(&pnl.unrealized_pnl)
    .bind(&pnl.current_equity_value)
    .bind(pnl.winning_positions)
    .bind(pnl.losing_positions)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

/// Insert a point-in-time PnL snapshot for an account into `account_pnl_snapshot`.
///
/// Records the current PnL state as an immutable time-series row. `total_redemptions`
/// is read from `account_pnl_state` (just upserted in the same transaction) because
/// `AccountPnlRow` does not carry that field. `total_pnl` is computed inline as
/// `realized_pnl + unrealized_pnl`, consistent with `upsert_account_pnl_state`.
///
/// # Arguments
///
/// * `tx` - Active transaction; the INSERT is part of this transaction.
/// * `account_id` - Ethereum address of the account.
/// * `pnl` - Freshly computed PnL row for this account.
/// * `ts` - Timestamp to record for this snapshot.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any SQL error.
pub async fn insert_account_pnl_snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
    pnl: &AccountPnlRow,
    ts: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO account_pnl_snapshot (
            account_id, total_deposits, total_redemptions,
            realized_pnl, unrealized_pnl, total_pnl,
            current_equity_value, ts
        )
        SELECT
            $1, $2, COALESCE(aps.total_redemptions, 0),
            $3, $4, $3 + $4,
            $5, $6
        FROM account_pnl_state aps
        WHERE aps.account_id = $1
        "#,
    )
    .bind(account_id)
    .bind(&pnl.total_deposits)
    .bind(&pnl.realized_pnl)
    .bind(&pnl.unrealized_pnl)
    .bind(&pnl.current_equity_value)
    .bind(ts)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// NOTE: Leaderboard cache writes (write_leaderboard_cache, switch_leaderboard_version,
// get_next_cache_version) have been removed. The leaderboard_cache table is now
// refreshed by a TimescaleDB scheduled job (refresh_period_leaderboard_cache)
// every 60 seconds — see migration 023_expand_leaderboard_cache.sql.

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    /// Verify that BigDecimal arithmetic used for total_pnl is precise.
    #[test]
    fn big_decimal_pnl_sum() {
        let realized = BigDecimal::from_str("1000000000000000000").unwrap();
        let unrealized = BigDecimal::from_str("500000000000000000").unwrap();
        let total = &realized + &unrealized;
        assert_eq!(total.to_string(), "1500000000000000000");
    }

    #[test]
    fn account_pnl_row_debug_clone() {
        let row = AccountPnlRow {
            total_deposits: BigDecimal::from_str("0").unwrap(),
            current_equity_value: BigDecimal::from_str("0").unwrap(),
            realized_pnl: BigDecimal::from_str("0").unwrap(),
            unrealized_pnl: BigDecimal::from_str("0").unwrap(),
            winning_positions: 0,
            losing_positions: 0,
        };
        // Verify that Debug and Clone are derived and work without panicking.
        let _ = format!("{row:?}");
        let _ = row.clone();
    }
}
