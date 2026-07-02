use std::cmp::Ordering;

use num_bigint::BigUint;
use num_traits::{One, Zero};

use crate::{CurveError, U256};

pub fn unit() -> U256 {
    U256::from(1_000_000_000_000_000_000u128)
}

pub fn max_u256() -> BigUint {
    (BigUint::one() << 256usize) - BigUint::one()
}

pub fn to_big(value: U256) -> BigUint {
    BigUint::from_bytes_be(&value.to_be_bytes::<32>())
}

pub fn from_big(value: BigUint) -> Result<U256, CurveError> {
    if value > max_u256() {
        return Err(CurveError::MathOverflow);
    }

    let bytes = value.to_bytes_be();
    let mut padded = [0u8; 32];
    let start = padded.len().saturating_sub(bytes.len());
    padded[start..start + bytes.len()].copy_from_slice(&bytes);
    Ok(U256::from_be_bytes(padded))
}

pub fn add(a: U256, b: U256) -> Result<U256, CurveError> {
    a.checked_add(b).ok_or(CurveError::MathOverflow)
}

pub fn sub(a: U256, b: U256) -> Result<U256, CurveError> {
    a.checked_sub(b).ok_or(CurveError::MathUnderflow)
}

pub fn mul_div(x: U256, y: U256, denominator: U256) -> Result<U256, CurveError> {
    if denominator.is_zero() {
        return Err(CurveError::DivisionByZero);
    }

    let q = (to_big(x) * to_big(y)) / to_big(denominator);
    from_big(q)
}

pub fn mul_div_up(x: U256, y: U256, denominator: U256) -> Result<U256, CurveError> {
    if denominator.is_zero() {
        return Err(CurveError::DivisionByZero);
    }

    let denominator_big = to_big(denominator);
    let product = to_big(x) * to_big(y);
    let q = &product / &denominator_big;
    let r = &product % &denominator_big;
    let rounded = if r.is_zero() { q } else { q + BigUint::one() };
    from_big(rounded)
}

pub fn sqrt_ud60x18(raw: U256) -> Result<U256, CurveError> {
    from_big((to_big(raw) * to_big(unit())).sqrt())
}

pub fn square(x: U256) -> Result<U256, CurveError> {
    mul_div(x, x, unit())
}

pub fn square_up(x: U256) -> Result<U256, CurveError> {
    mul_div_up(x, x, unit())
}

pub fn mul_up(x: U256, y: U256) -> Result<U256, CurveError> {
    mul_div_up(x, y, unit())
}

pub fn div_up(x: U256, y: U256) -> Result<U256, CurveError> {
    mul_div_up(x, unit(), y)
}

pub fn fee_on_raw(amount: U256, fee: U256, denominator: U256) -> Result<U256, CurveError> {
    mul_div_up(amount, fee, denominator)
}

pub fn market_cap(total_shares: U256, share_price: U256) -> Result<U256, CurveError> {
    mul_div(total_shares, share_price, unit())
}

pub fn check_curve_domains(
    total_assets: U256,
    total_shares: U256,
    max_assets: U256,
    max_shares: U256,
) -> Result<(), CurveError> {
    match (total_assets.cmp(&max_assets), total_shares.cmp(&max_shares)) {
        (Ordering::Greater, _) | (_, Ordering::Greater) => Err(CurveError::DomainExceeded),
        _ => Ok(()),
    }
}

pub fn check_withdraw(assets: U256, total_assets: U256) -> Result<(), CurveError> {
    if assets > total_assets {
        return Err(CurveError::AssetsExceedTotalAssets);
    }
    Ok(())
}

pub fn check_redeem(shares: U256, total_shares: U256) -> Result<(), CurveError> {
    if shares > total_shares {
        return Err(CurveError::SharesExceedTotalShares);
    }
    Ok(())
}

pub fn check_deposit_bounds(
    assets: U256,
    total_assets: U256,
    max_assets: U256,
) -> Result<(), CurveError> {
    let remaining = max_assets
        .checked_sub(total_assets)
        .ok_or(CurveError::DomainExceeded)?;
    if assets > remaining {
        return Err(CurveError::AssetsOverflowMax);
    }
    Ok(())
}

pub fn check_deposit_out(
    shares_out: U256,
    total_shares: U256,
    max_shares: U256,
) -> Result<(), CurveError> {
    let remaining = max_shares
        .checked_sub(total_shares)
        .ok_or(CurveError::DomainExceeded)?;
    if shares_out > remaining {
        return Err(CurveError::SharesOverflowMax);
    }
    Ok(())
}

pub fn check_mint_bounds(
    shares: U256,
    total_shares: U256,
    max_shares: U256,
) -> Result<(), CurveError> {
    let remaining = max_shares
        .checked_sub(total_shares)
        .ok_or(CurveError::DomainExceeded)?;
    if shares > remaining {
        return Err(CurveError::SharesOverflowMax);
    }
    Ok(())
}

pub fn check_mint_out(
    assets_out: U256,
    total_assets: U256,
    max_assets: U256,
) -> Result<(), CurveError> {
    let remaining = max_assets
        .checked_sub(total_assets)
        .ok_or(CurveError::DomainExceeded)?;
    if assets_out > remaining {
        return Err(CurveError::AssetsOverflowMax);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        check_curve_domains, div_up, fee_on_raw, market_cap, mul_div, mul_div_up, sqrt_ud60x18,
        square, square_up, unit,
    };
    use crate::{CurveError, U256};

    #[test]
    fn rounding_sensitive_helpers_match_progressive_curve_expectations() {
        let one_and_half = U256::from(1_500_000_000_000_000_000u128);

        assert_eq!(
            square(one_and_half).unwrap(),
            U256::from(2_250_000_000_000_000_000u128)
        );
        assert_eq!(square_up(U256::from(1u8)).unwrap(), U256::from(1u8));
        assert_eq!(
            mul_div_up(U256::from(1u8), unit(), U256::from(3u8)).unwrap(),
            U256::from(333_333_333_333_333_334u128)
        );
        assert_eq!(
            div_up(U256::from(1u8), U256::from(3u8)).unwrap(),
            U256::from(333_333_333_333_333_334u128)
        );
        assert_eq!(
            sqrt_ud60x18(U256::from(2_250_000_000_000_000_000u128)).unwrap(),
            one_and_half
        );
    }

    #[test]
    fn shared_helpers_cover_fee_and_market_cap_paths() {
        assert_eq!(
            fee_on_raw(
                U256::from(1_000u64),
                U256::from(150u64),
                U256::from(10_000u64)
            )
            .unwrap(),
            U256::from(15u64)
        );
        assert_eq!(
            market_cap(
                U256::from(10_000_000_000_000_000_000u128),
                U256::from(21_000_000_000_000_000_000u128)
            )
            .unwrap(),
            U256::from(210_000_000_000_000_000_000u128)
        );
    }

    #[test]
    fn helper_errors_match_expected_failure_modes() {
        assert_eq!(
            mul_div(U256::from(1u8), U256::from(1u8), U256::ZERO),
            Err(CurveError::DivisionByZero)
        );
        assert_eq!(
            check_curve_domains(U256::from(2u8), U256::from(1u8), U256::from(1u8), U256::MAX),
            Err(CurveError::DomainExceeded)
        );
    }
}
