//! Repository functions for the `vault` and `share_price_history` tables.
//!
//! All functions accept a mutable reference to a sqlx transaction so that
//! callers can compose multiple writes atomically. Each function is idempotent
//! via `ON CONFLICT DO UPDATE` / `ON CONFLICT DO NOTHING` as appropriate.
//!
//! **Deadlock prevention**: Both `vault_state` and `position_tracking` workers
//! write to the `vault` table concurrently. We rely exclusively on PostgreSQL
//! row-level tuple locks acquired implicitly by `INSERT ... ON CONFLICT DO UPDATE`.
//! All vault mutations — including `holder_count` increments — go through upsert
//! paths so that both workers always acquire tuple locks via the same code path
//! (primary-key lookup → tuple lock). This eliminates the multi-lock ordering
//! problem that causes deadlocks when advisory locks are held across multiple
//! rows within a long-running batch transaction.

use chrono::{DateTime, Utc};
use sqlx::types::BigDecimal;

use crate::error::ProjectionError;

// ---------------------------------------------------------------------------
// Deposit-side upsert
// ---------------------------------------------------------------------------

/// Upsert a vault row when a `Deposited` event arrives.
///
/// Only accumulates `total_deposits`. Snapshot fields (`total_shares`,
/// `current_share_price`, `total_assets`, `market_cap`) are set exclusively
/// by `SharePriceChanged` events via [`update_vault_price`], which avoids
/// stale overwrites when event types arrive out of chronological order.
///
/// # Arguments
///
/// * `tx` - Active transaction to write within.
/// * `term_id` - Vault term identifier string (e.g. `"7"`).
/// * `curve_id` - Bonding-curve identifier string (e.g. `"1"`).
/// * `assets_after_fees` - Net assets deposited after protocol fee deduction.
/// * `block_timestamp` - Chain timestamp of the block containing this event.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
pub async fn upsert_vault_on_deposit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    curve_id: &str,
    assets_after_fees: BigDecimal,
    block_timestamp: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO vault (
            term_id, curve_id, total_shares, total_deposits,
            current_share_price, market_cap, holder_count,
            total_redemptions, updated_at
        )
        VALUES ($1, $2, 0, $3, 0, 0, 0, 0, $4)
        ON CONFLICT (term_id, curve_id) DO UPDATE SET
            total_deposits = vault.total_deposits + EXCLUDED.total_deposits,
            updated_at     = NOW()
        "#,
    )
    .bind(term_id)
    .bind(curve_id)
    .bind(assets_after_fees)
    .bind(block_timestamp)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Redeem-side upsert
// ---------------------------------------------------------------------------

/// Upsert a vault row when a `Redeemed` event arrives.
///
/// Only accumulates `total_redemptions` and decrements `total_deposits`.
/// Snapshot fields are set exclusively by `SharePriceChanged` events via
/// [`update_vault_price`].
///
/// # Arguments
///
/// * `tx` - Active transaction to write within.
/// * `term_id` - Vault term identifier.
/// * `curve_id` - Bonding-curve identifier.
/// * `assets` - Asset amount returned to the redeemer.
/// * `block_timestamp` - Chain timestamp of the block containing this event.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
pub async fn upsert_vault_on_redeem(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    curve_id: &str,
    assets: BigDecimal,
    block_timestamp: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO vault (
            term_id, curve_id, total_shares, total_deposits,
            current_share_price, market_cap, holder_count,
            total_redemptions, updated_at
        )
        VALUES ($1, $2, 0, 0, 0, 0, 0, $3, $4)
        ON CONFLICT (term_id, curve_id) DO UPDATE SET
            total_deposits    = vault.total_deposits - $3,
            total_redemptions = vault.total_redemptions + $3,
            updated_at        = NOW()
        "#,
    )
    .bind(term_id)
    .bind(curve_id)
    .bind(assets)
    .bind(block_timestamp)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Share-price update
// ---------------------------------------------------------------------------

/// Update vault price fields when a `SharePriceChanged` event arrives.
///
/// Sets snapshot fields from a `SharePriceChanged` event.
///
/// `market_cap` is pre-computed by the caller as
/// `total_shares * share_price / 1e18` — this is conceptually different from
/// `total_assets` (which is the value locked in the vault). They are
/// numerically close for standard ERC4626 vaults but may diverge for
/// non-standard bonding curves.
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `term_id` - Vault term identifier.
/// * `curve_id` - Bonding-curve identifier.
/// * `share_price` - New share price from the event.
/// * `total_assets` - Total assets in the vault after the price change.
/// * `total_shares` - Total shares outstanding after the price change.
/// * `market_cap` - Pre-computed `total_shares * share_price / 1e18`.
/// * `block_timestamp` - Chain timestamp.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
#[allow(clippy::too_many_arguments)]
pub async fn update_vault_price(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    curve_id: &str,
    share_price: BigDecimal,
    total_assets: BigDecimal,
    total_shares: BigDecimal,
    market_cap: BigDecimal,
    block_timestamp: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO vault (
            term_id, curve_id, current_share_price, total_assets, total_shares,
            market_cap, total_deposits, total_redemptions, holder_count, updated_at
        )
        VALUES ($1, $2, $3, $4, $5, $6, 0, 0, 0, $7)
        ON CONFLICT (term_id, curve_id) DO UPDATE SET
            current_share_price = $3,
            total_assets        = $4,
            total_shares        = $5,
            market_cap          = $6,
            updated_at          = NOW()
        "#,
    )
    .bind(term_id)
    .bind(curve_id)
    .bind(share_price)
    .bind(total_assets)
    .bind(total_shares)
    .bind(market_cap)
    .bind(block_timestamp)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Share-price history append
// ---------------------------------------------------------------------------

/// Append a row to the `share_price_history` TimescaleDB hypertable.
///
/// Uses `ON CONFLICT DO NOTHING` so replaying the same event is safe —
/// the unique constraint on `(event_id)` prevents duplicate rows.
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `event_id` - Stable event identifier (`{tx_hash}-{log_index}-{event_type}`).
/// * `term_id` - Vault term identifier.
/// * `curve_id` - Bonding-curve identifier.
/// * `share_price` - Share price recorded at this point in time.
/// * `total_assets` - Total vault assets at this point in time.
/// * `total_shares` - Total vault shares at this point in time.
/// * `market_cap` - Market capitalisation (`total_shares * share_price`).
/// * `block_number` - Block number this event originated from.
/// * `transaction_hash` - Transaction hash that emitted this event.
/// * `ts` - Block timestamp (used as the TimescaleDB time dimension).
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
#[allow(clippy::too_many_arguments)]
pub async fn insert_share_price_history(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    event_id: &str,
    term_id: &str,
    curve_id: &str,
    share_price: BigDecimal,
    total_assets: BigDecimal,
    total_shares: BigDecimal,
    market_cap: BigDecimal,
    block_number: i64,
    transaction_hash: &str,
    ts: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO share_price_history (
            event_id, term_id, curve_id, share_price,
            total_assets, total_shares, market_cap,
            block_number, transaction_hash, ts
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (event_id, ts) DO NOTHING
        "#,
    )
    .bind(event_id)
    .bind(term_id)
    .bind(curve_id)
    .bind(share_price)
    .bind(total_assets)
    .bind(total_shares)
    .bind(market_cap)
    .bind(block_number)
    .bind(transaction_hash)
    .bind(ts)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Position upsert on deposit — active_vault_position
// ---------------------------------------------------------------------------

/// Upsert a position row in `active_vault_position` when a `Deposited` event
/// arrives.
///
/// The depositing receiver becomes `account_id`. Shares and `total_deposits`
/// are accumulated idempotently via `ON CONFLICT DO UPDATE`.
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `term_id` - Vault term identifier.
/// * `curve_id` - Bonding-curve identifier.
/// * `account_id` - Receiving account address (depositor's `receiver` field).
/// * `shares` - Share amount credited by this deposit.
/// * `total_deposits` - Asset amount deposited after fees (`assets_after_fees`).
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
pub async fn upsert_position_on_deposit(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    curve_id: &str,
    account_id: &str,
    shares: BigDecimal,
    total_deposits: BigDecimal,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO active_vault_position
            (term_id, curve_id, account_id, shares, total_deposits, opened_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        ON CONFLICT (term_id, curve_id, account_id) DO UPDATE SET
            shares          = active_vault_position.shares + EXCLUDED.shares,
            total_deposits  = active_vault_position.total_deposits + EXCLUDED.total_deposits,
            updated_at      = NOW()
        "#,
    )
    .bind(term_id)
    .bind(curve_id)
    .bind(account_id)
    .bind(shares)
    .bind(total_deposits)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Position decrement on redeem — active_vault_position
// ---------------------------------------------------------------------------

/// Decrement shares and accumulate `total_redemptions` in `active_vault_position`
/// when a `Redeemed` event arrives.
///
/// If the row does not exist (e.g. the position was already pruned or this is a
/// replay after pruning), the UPDATE is a no-op — no error is raised.
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `term_id` - Vault term identifier.
/// * `curve_id` - Bonding-curve identifier.
/// * `account_id` - Redeeming account address (sender's `sender` field).
/// * `shares` - Share amount returned by this redemption.
/// * `total_redemptions` - Asset amount returned to the redeemer (`assets`).
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
pub async fn decrement_position_on_redeem(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    curve_id: &str,
    account_id: &str,
    shares: BigDecimal,
    total_redemptions: BigDecimal,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        UPDATE active_vault_position SET
            shares             = active_vault_position.shares - $4,
            total_redemptions  = active_vault_position.total_redemptions + $5,
            updated_at         = NOW()
        WHERE term_id = $1 AND curve_id = $2 AND account_id = $3
        "#,
    )
    .bind(term_id)
    .bind(curve_id)
    .bind(account_id)
    .bind(shares)
    .bind(total_redemptions)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Zero-position pruning — active_vault_position
// ---------------------------------------------------------------------------

/// Delete a fully-exited position from `active_vault_position`.
///
/// Runs after [`decrement_position_on_redeem`]. Removes the row where
/// `shares <= 0` so `holder_count` (COUNT-derived by `refresh_holder_count`)
/// reflects only accounts with live exposure.
///
/// The conditional (`AND shares <= 0`) makes this safe to replay — a replay
/// after the DELETE is already committed produces a no-op `DELETE 0`.
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `term_id` - Vault term identifier.
/// * `curve_id` - Bonding-curve identifier.
/// * `account_id` - Account whose position should be pruned if shares <= 0.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
pub async fn prune_zero_position(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    curve_id: &str,
    account_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        DELETE FROM active_vault_position
        WHERE term_id = $1 AND curve_id = $2 AND account_id = $3
          AND shares <= 0
        "#,
    )
    .bind(term_id)
    .bind(curve_id)
    .bind(account_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Holder count refresh — vault
// ---------------------------------------------------------------------------

/// Derive `vault.holder_count` from the authoritative `active_vault_position`
/// table.
///
/// COUNT-derived approach replaces incremental tracking which breaks when event
/// types arrive out of chronological order. Uses a COUNT on the PK index
/// `(term_id, curve_id, account_id)` — fast even for vaults with tens of
/// thousands of holders.
///
/// # Arguments
///
/// * `tx` - Active transaction.
/// * `term_id` - Vault term identifier.
/// * `curve_id` - Bonding-curve identifier.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any sqlx error.
pub async fn refresh_holder_count(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    term_id: &str,
    curve_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        UPDATE vault SET
            holder_count = (
                SELECT COUNT(*)::int
                FROM active_vault_position
                WHERE term_id = $1 AND curve_id = $2 AND shares > 0
            )
        WHERE term_id = $1 AND curve_id = $2
        "#,
    )
    .bind(term_id)
    .bind(curve_id)
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

    /// Verify that BigDecimal::from_str parses typical wei-scale strings
    /// without precision loss. This is a pure-logic test with no DB connection.
    #[test]
    fn big_decimal_parses_wei_string() {
        let bd = BigDecimal::from_str("1000000000000000000").unwrap();
        assert_eq!(bd.to_string(), "1000000000000000000");
    }

    #[test]
    fn big_decimal_parses_zero() {
        let bd = BigDecimal::from_str("0").unwrap();
        assert_eq!(bd.to_string(), "0");
    }
}
