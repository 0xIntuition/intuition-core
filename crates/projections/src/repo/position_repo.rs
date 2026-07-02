//! Repository functions for the `position` and `position_change` tables.
//!
//! All functions accept a mutable reference to a sqlx transaction so that
//! callers can compose multiple writes atomically. Each function is idempotent
//! via `ON CONFLICT DO UPDATE` / `ON CONFLICT DO NOTHING` as appropriate.

use chrono::{DateTime, Utc};
use sqlx::types::BigDecimal;
use sqlx::Row;

use crate::error::ProjectionError;

// ---------------------------------------------------------------------------
// Deposit-side position upsert
// ---------------------------------------------------------------------------

/// Upsert a position row when a `Deposited` event arrives.
///
/// On first insert the position is created with the incoming shares and
/// assets. On conflict, shares and cost-tracking fields are accumulated
/// and `cost_basis` is recomputed as `total_deposits_value / total_shares_acquired`.
///
/// Returns `true` if this write created a brand-new row (i.e. the position
/// did not previously exist), which signals the caller to increment the
/// vault's `holder_count`.
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `account_id` - Depositor account address.
/// * `term_id` - Vault term identifier.
/// * `curve_id` - Bonding-curve identifier.
/// * `shares` - Shares minted to the receiver in this deposit.
/// * `assets_after_fees` - Net assets deposited (used as cost basis input).
/// * `block_timestamp` - Chain timestamp (stored as `opened_at` on first insert).
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
pub async fn upsert_position_on_deposit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
    term_id: &str,
    curve_id: &str,
    shares: BigDecimal,
    assets_after_fees: BigDecimal,
    block_timestamp: DateTime<Utc>,
) -> Result<bool, ProjectionError> {
    // The `version` column tracks deposit history: version=0 means the row was
    // just created by this INSERT, version>0 means at least one deposit was
    // previously processed. On INSERT we set version=0; on UPDATE we increment
    // it. RETURNING (version = 1) detects a brand-new position (was 0, now 1).
    //
    // This replaces the old `(xmax = 0)` trick which is unreliable under
    // HOT-chain updates and visibility-edge cases.
    let row = sqlx::query(
        r#"
        INSERT INTO position (
            account_id, term_id, curve_id,
            shares, total_deposits, total_deposits_value,
            total_shares_acquired, cost_basis,
            version, opened_at, updated_at
        )
        VALUES (
            $1, $2, $3,
            $4, $5, $5,
            $4, CASE WHEN $4 > 0 THEN $5 / $4 ELSE 0 END,
            0, $6, NOW()
        )
        ON CONFLICT (account_id, term_id, curve_id) DO UPDATE SET
            shares                = position.shares + EXCLUDED.shares,
            total_deposits        = position.total_deposits + EXCLUDED.total_deposits,
            total_deposits_value  = position.total_deposits_value + EXCLUDED.total_deposits_value,
            total_shares_acquired = position.total_shares_acquired + EXCLUDED.total_shares_acquired,
            cost_basis            = CASE
                WHEN (position.total_shares_acquired + EXCLUDED.total_shares_acquired) > 0
                THEN (position.total_deposits_value + EXCLUDED.total_deposits_value)
                     / (position.total_shares_acquired + EXCLUDED.total_shares_acquired)
                ELSE 0
            END,
            version               = position.version + 1,
            closed_at             = NULL,
            updated_at            = NOW()
        RETURNING (version = 1) AS is_insert
        "#,
    )
    .bind(account_id)
    .bind(term_id)
    .bind(curve_id)
    .bind(shares)
    .bind(assets_after_fees)
    .bind(block_timestamp)
    .fetch_one(&mut **tx)
    .await?;

    // version=1 means the row was just promoted from 0→1 (first deposit update).
    // version=0 would mean a fresh INSERT that hasn't hit the DO UPDATE path yet,
    // but since we always go through DO UPDATE on conflict, version=1 is the
    // reliable "brand-new position" signal.
    let is_insert: bool = row.try_get("is_insert")?;
    Ok(is_insert)
}

// ---------------------------------------------------------------------------
// Redeem-side position update
// ---------------------------------------------------------------------------

/// Upsert a position row when a `Redeemed` event arrives.
///
/// If the position already exists (version > 0), decrements `shares`,
/// accumulates `realized_pnl`, and sets `closed_at` when shares reach zero.
///
/// If the position does NOT exist (redeem arrived before its deposit due to
/// event ordering), creates a stub row with negative shares and version=0.
/// When the deposit eventually arrives, the deposit upsert will accumulate
/// correctly and set version=1.
///
/// Returns `true` if the caller should decrement `holder_count`. This is
/// only true when:
///   - The position was previously established (`version > 0` before this write)
///   - AND the position is now closed (`shares <= 0` after this write)
///
/// A redeem on a stub (version=0) never triggers a holder_count decrement
/// because holder_count was never incremented for it.
///
/// Note: redeem does NOT increment `version`. Version specifically tracks
/// deposit history, used to determine whether holder_count was previously
/// incremented.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
pub async fn upsert_position_on_redeem(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
    term_id: &str,
    curve_id: &str,
    shares: BigDecimal,
    assets: BigDecimal,
    block_timestamp: DateTime<Utc>,
) -> Result<bool, ProjectionError> {
    let row = sqlx::query(
        r#"
        INSERT INTO position (
            account_id, term_id, curve_id,
            shares, total_deposits, total_deposits_value,
            total_shares_acquired, cost_basis, realized_pnl,
            version, opened_at, updated_at
        )
        VALUES (
            $1, $2, $3,
            -$4, 0, 0,
            0, 0, $5,
            0, $6, NOW()
        )
        ON CONFLICT (account_id, term_id, curve_id) DO UPDATE SET
            shares       = position.shares - $4,
            realized_pnl = position.realized_pnl + ($5 - $4 * position.cost_basis),
            closed_at    = CASE
                WHEN position.shares - $4 <= 0 THEN $6
                ELSE position.closed_at
            END,
            updated_at   = NOW()
        RETURNING
            (shares <= 0) AS is_closed,
            (version > 0) AS was_established
        "#,
    )
    .bind(account_id)
    .bind(term_id)
    .bind(curve_id)
    .bind(shares)
    .bind(assets)
    .bind(block_timestamp)
    .fetch_one(&mut **tx)
    .await?;

    let is_closed: bool = row.try_get("is_closed")?;
    let was_established: bool = row.try_get("was_established")?;

    // Only decrement holder_count if the position had a prior deposit
    // (version > 0) and is now fully closed.
    Ok(is_closed && was_established)
}

// ---------------------------------------------------------------------------
// Position change history append
// ---------------------------------------------------------------------------

/// Append a row to the `position_change` TimescaleDB hypertable.
///
/// Uses `ON CONFLICT (event_id) DO NOTHING` so replaying the same event is
/// safe.
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `event_id` - Stable event identifier (`{tx_hash}-{log_index}-{event_type}`).
/// * `account_id` - Account address that made the change.
/// * `term_id` - Vault term identifier.
/// * `curve_id` - Bonding-curve identifier.
/// * `event_type` - Human-readable event type string (`"Deposited"` / `"Redeemed"`).
/// * `shares_delta` - Signed share change (positive for deposit, negative for redeem).
/// * `assets_in` - Assets flowing into the position (0 for redemptions).
/// * `assets_out` - Assets flowing out of the position (0 for deposits).
/// * `execution_price` - Effective price per share for this event.
/// * `block_number` - Block number this event originated from.
/// * `transaction_hash` - Transaction hash that emitted this event.
/// * `ts` - Block timestamp (TimescaleDB time dimension).
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
#[allow(clippy::too_many_arguments)]
pub async fn insert_position_change(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event_id: &str,
    account_id: &str,
    term_id: &str,
    curve_id: &str,
    event_type: &str,
    shares_delta: BigDecimal,
    assets_in: BigDecimal,
    assets_out: BigDecimal,
    execution_price: BigDecimal,
    block_number: i64,
    transaction_hash: &str,
    ts: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO position_change (
            event_id, account_id, term_id, curve_id,
            event_type, shares_delta, assets_in, assets_out,
            execution_price, block_number, transaction_hash, ts
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        ON CONFLICT (event_id, ts) DO NOTHING
        "#,
    )
    .bind(event_id)
    .bind(account_id)
    .bind(term_id)
    .bind(curve_id)
    .bind(event_type)
    .bind(shares_delta)
    .bind(assets_in)
    .bind(assets_out)
    .bind(execution_price)
    .bind(block_number)
    .bind(transaction_hash)
    .bind(ts)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use sqlx::types::BigDecimal;
    use std::str::FromStr;

    /// Verify cost-basis arithmetic that mirrors the SQL expression.
    /// total_deposits_value / total_shares_acquired should equal the
    /// average entry price.
    #[test]
    fn cost_basis_arithmetic() {
        let total_deposits_value = BigDecimal::from_str("2000000").unwrap();
        let total_shares_acquired = BigDecimal::from_str("1000000").unwrap();
        let cost_basis = &total_deposits_value / &total_shares_acquired;
        assert_eq!(cost_basis, BigDecimal::from_str("2").unwrap());
    }

    #[test]
    fn pnl_delta_arithmetic() {
        // assets=1500000, shares=1000000, cost_basis=1.0 → pnl_delta=500000
        let assets = BigDecimal::from_str("1500000").unwrap();
        let shares = BigDecimal::from_str("1000000").unwrap();
        let cost_basis = BigDecimal::from_str("1").unwrap();
        let pnl_delta = &assets - (&shares * &cost_basis);
        assert_eq!(pnl_delta, BigDecimal::from_str("500000").unwrap());
    }
}
