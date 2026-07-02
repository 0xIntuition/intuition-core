use crate::{
    math::{
        check_curve_domains, check_deposit_bounds, check_deposit_out, check_mint_bounds,
        check_mint_out, check_redeem, check_withdraw, mul_div, mul_div_up,
    },
    Curve, CurveError, CurveState, U256,
};

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct LinearCurve;

impl LinearCurve {
    pub const fn new() -> Self {
        Self
    }

    fn convert_to_shares_unchecked(assets: U256, state: CurveState) -> Result<U256, CurveError> {
        if state.total_shares.is_zero() {
            Ok(assets)
        } else {
            mul_div(assets, state.total_shares, state.total_assets)
        }
    }

    fn convert_to_assets_unchecked(shares: U256, state: CurveState) -> Result<U256, CurveError> {
        if state.total_shares.is_zero() {
            Ok(shares)
        } else {
            mul_div(shares, state.total_assets, state.total_shares)
        }
    }
}

impl Curve for LinearCurve {
    fn max_shares(&self) -> U256 {
        U256::MAX
    }

    fn max_assets(&self) -> U256 {
        U256::MAX
    }

    fn preview_deposit(&self, assets: U256, state: CurveState) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets(),
            self.max_shares(),
        )?;
        check_deposit_bounds(assets, state.total_assets, self.max_assets())?;
        let shares = Self::convert_to_shares_unchecked(assets, state)?;
        check_deposit_out(shares, state.total_shares, self.max_shares())?;
        Ok(shares)
    }

    fn preview_mint(&self, shares: U256, state: CurveState) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets(),
            self.max_shares(),
        )?;
        check_mint_bounds(shares, state.total_shares, self.max_shares())?;
        let assets = if state.total_shares.is_zero() {
            shares
        } else {
            mul_div_up(shares, state.total_assets, state.total_shares)?
        };
        check_mint_out(assets, state.total_assets, self.max_assets())?;
        Ok(assets)
    }

    fn preview_withdraw(&self, assets: U256, state: CurveState) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets(),
            self.max_shares(),
        )?;
        check_withdraw(assets, state.total_assets)?;
        if state.total_shares.is_zero() {
            Ok(assets)
        } else {
            mul_div_up(assets, state.total_shares, state.total_assets)
        }
    }

    fn preview_redeem(&self, shares: U256, state: CurveState) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets(),
            self.max_shares(),
        )?;
        check_redeem(shares, state.total_shares)?;
        Self::convert_to_assets_unchecked(shares, state)
    }

    fn convert_to_shares(&self, assets: U256, state: CurveState) -> Result<U256, CurveError> {
        self.preview_deposit(assets, state)
    }

    fn convert_to_assets(&self, shares: U256, state: CurveState) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets(),
            self.max_shares(),
        )?;
        check_redeem(shares, state.total_shares)?;
        Self::convert_to_assets_unchecked(shares, state)
    }

    fn current_price(&self, state: CurveState) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets(),
            self.max_shares(),
        )?;
        Self::convert_to_assets_unchecked(U256::from(1_000_000_000_000_000_000u128), state)
    }
}
