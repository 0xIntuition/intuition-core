pub mod dual;
pub mod surreal;
#[cfg(test)]
pub(crate) mod test_parity;
pub mod timescaledb;
pub mod traits;

// Backward-compatible shim so `crate::projection::pg::*` still resolves.
pub mod pg {
    pub use super::traits::*;
}

// Re-export sub-module contents for backward-compatible paths.
// surreal projections are only accessed via all_projections(), so no glob needed.
//
// `dual::*` is NOT glob-imported here because both `dual` and `timescaledb`
// export modules named `vault_state` and `vault_holders_index`, which would
// create an E0659 ambiguity. Instead, use the full paths:
//   - `projection::dual::core_entities::CoreEntitiesProjection`
//   - `projection::dual::vault_state::VaultStateDualProjection`
//   - `projection::dual::vault_holders_index::VaultHoldersIndexDualProjection`
pub use dual::core_entities;
pub use timescaledb::*;
pub use traits::*;

use serde_json::Value;
use sqlx::types::BigDecimal;
use std::str::FromStr;

use crate::error::ProjectionError;
use curves::U256;

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/// Extract a required string field from `event_data`.
///
/// Returns `ProjectionError::MissingField` if the key is absent or not a string.
pub(crate) fn get_str<'a>(data: &'a Value, field: &str) -> Result<&'a str, ProjectionError> {
    data.get(field)
        .and_then(Value::as_str)
        .ok_or_else(|| ProjectionError::MissingField(field.to_owned()))
}

/// Parse a string-encoded numeric value into a `serde_json::Value::Number`.
///
/// Values that fit in i64 or u64 are stored as exact `serde_json::Number`
/// integers. This is safe for values up to u64::MAX (~1.8e19).
/// For values that may exceed i64::MAX and need negation, use
/// [`neg_decimal_value`] instead.
pub(crate) fn parse_numeric(raw: &str, field: &str) -> Result<Value, ProjectionError> {
    let n: serde_json::Number = raw
        .parse()
        .map_err(|_| ProjectionError::InvalidEventData(format!("{field} is not numeric: {raw}")))?;
    Ok(Value::Number(n))
}

/// Sentinel prefix used to carry exact decimal strings through
/// `serde_json::Value::String` without precision loss.
pub(crate) const DECIMAL_PREFIX: &str = "decimal:";

/// Wrap a raw numeric string as a decimal value that `value_to_surql` will
/// emit as `<decimal>'N'`.
///
/// Use this for blockchain amounts that may exceed i64::MAX.
pub(crate) fn decimal_value(raw: &str) -> Value {
    Value::String(format!("{DECIMAL_PREFIX}{raw}"))
}

/// Wrap a raw numeric string as a negated decimal value that `value_to_surql`
/// will emit as `<decimal>'-N'`.
///
/// Use this for decrement operations on large blockchain amounts.
pub(crate) fn neg_decimal_value(raw: &str) -> Value {
    Value::String(format!("{DECIMAL_PREFIX}-{raw}"))
}

/// Sentinel prefix used to carry datetime strings through
/// `serde_json::Value::String` as explicit SurrealQL datetimes.
pub(crate) const DATETIME_PREFIX: &str = "datetime:";

/// Wrap a chrono timestamp as a datetime value that `value_to_surql` emits as
/// `type::datetime('...')`.
pub(crate) fn datetime_value(ts: &chrono::DateTime<chrono::Utc>) -> Value {
    Value::String(format!("{DATETIME_PREFIX}{}", ts.to_rfc3339()))
}

/// Extract a string field from `event_data` and parse it as a `BigDecimal`.
///
/// Returns `ProjectionError::InvalidEventData` when the string is not a
/// valid decimal number.
///
/// Used exclusively in test modules — production projections use pre-parsed
/// [`ParsedEvent`] typed fields instead.
#[allow(dead_code)]
pub(crate) fn parse_decimal(data: &Value, field: &str) -> Result<BigDecimal, ProjectionError> {
    let raw = get_str(data, field)?;
    BigDecimal::from_str(raw)
        .map_err(|_| ProjectionError::InvalidEventData(format!("{field} is not numeric: {raw}")))
}

pub(crate) fn compute_market_cap(
    total_shares_raw: &str,
    share_price_raw: &str,
) -> Result<BigDecimal, ProjectionError> {
    let total_shares = U256::from_str(total_shares_raw).map_err(|_| {
        ProjectionError::InvalidEventData(format!(
            "total_shares is not a valid uint256: {total_shares_raw}"
        ))
    })?;
    let share_price = U256::from_str(share_price_raw).map_err(|_| {
        ProjectionError::InvalidEventData(format!(
            "share_price is not a valid uint256: {share_price_raw}"
        ))
    })?;
    let market_cap = curves::market_cap(total_shares, share_price)
        .map_err(|err| ProjectionError::InvalidEventData(format!("market_cap overflow: {err}")))?;

    BigDecimal::from_str(&market_cap.to_string())
        .map_err(|_| ProjectionError::InvalidEventData("market_cap is not numeric".to_string()))
}

/// Create all SurrealDB projection instances.
pub fn all_projections() -> Vec<Box<dyn Projection>> {
    vec![
        Box::new(surreal::atom::AtomProjection),
        Box::new(surreal::triple::TripleProjection),
        Box::new(surreal::deposit::DepositProjection),
        Box::new(surreal::redeem::RedeemProjection),
        Box::new(surreal::price::PriceProjection),
        Box::new(surreal::fee::FeeProjection),
    ]
}
