use crate::{
    math::{
        add, check_curve_domains, check_deposit_bounds, check_deposit_out, check_mint_bounds,
        check_mint_out, check_redeem, check_withdraw, div_up, from_big, mul_div, mul_up,
        sqrt_ud60x18, square, square_up, sub, to_big, unit,
    },
    Curve, CurveError, CurveState, U256,
};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OffsetProgressiveCurve {
    slope: U256,
    half_slope: U256,
    offset: U256,
    max_shares: U256,
    max_assets: U256,
}

impl OffsetProgressiveCurve {
    pub fn new(slope: U256, offset: U256) -> Result<Self, CurveError> {
        if slope.is_zero() || slope.bit(0) {
            return Err(CurveError::InvalidSlope);
        }

        let half_slope = slope >> 1;
        let max_shares = {
            // Mirrors Solidity: sqrt(wrap(uMAX_UD60x18 / uUNIT)) which applies
            // UD60x18 sqrt semantics: Common.sqrt(raw * 1e18).
            let v = from_big(to_big(U256::MAX) / to_big(unit()))?;
            let max_shares_before_offset = sqrt_ud60x18(v)?;
            sub(max_shares_before_offset, offset)?
        };
        let max_assets = {
            let max_shares_with_offset = add(max_shares, offset)?;
            let assets_span = sub(square(max_shares_with_offset)?, square_up(offset)?)?;
            mul_div(assets_span, half_slope, unit())?
        };

        Ok(Self {
            slope,
            half_slope,
            offset,
            max_shares,
            max_assets,
        })
    }

    pub fn slope(&self) -> U256 {
        self.slope
    }

    pub fn half_slope(&self) -> U256 {
        self.half_slope
    }

    pub fn offset(&self) -> U256 {
        self.offset
    }

    fn convert_to_shares_internal(
        &self,
        assets: U256,
        state: CurveState,
    ) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets,
            self.max_shares,
        )?;
        check_deposit_bounds(assets, state.total_assets, self.max_assets)?;

        let s = add(state.total_shares, self.offset)?;
        let inner = add(square(s)?, mul_div(assets, unit(), self.half_slope)?)?;
        let shares = sub(sqrt_ud60x18(inner)?, s)?;

        check_deposit_out(shares, state.total_shares, self.max_shares)?;
        Ok(shares)
    }

    fn convert_to_assets_internal(
        &self,
        shares: U256,
        state: CurveState,
    ) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets,
            self.max_shares,
        )?;
        check_redeem(shares, state.total_shares)?;

        let s = add(state.total_shares, self.offset)?;
        let s_next = sub(s, shares)?;
        let area = sub(square(s)?, square(s_next)?)?;
        mul_div(area, self.half_slope, unit())
    }
}

impl Curve for OffsetProgressiveCurve {
    fn max_shares(&self) -> U256 {
        self.max_shares
    }

    fn max_assets(&self) -> U256 {
        self.max_assets
    }

    fn preview_deposit(&self, assets: U256, state: CurveState) -> Result<U256, CurveError> {
        self.convert_to_shares_internal(assets, state)
    }

    fn preview_mint(&self, shares: U256, state: CurveState) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets,
            self.max_shares,
        )?;
        check_mint_bounds(shares, state.total_shares, self.max_shares)?;

        let s = add(state.total_shares, self.offset)?;
        let s_next = add(s, shares)?;
        let area = sub(square_up(s_next)?, square(s)?)?;
        let assets = mul_up(area, self.half_slope)?;
        check_mint_out(assets, state.total_assets, self.max_assets)?;
        Ok(assets)
    }

    fn preview_withdraw(&self, assets: U256, state: CurveState) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets,
            self.max_shares,
        )?;
        check_withdraw(assets, state.total_assets)?;

        let s = add(state.total_shares, self.offset)?;
        let deduct = div_up(assets, self.half_slope)?;
        let inner = sub(square(s)?, deduct)?;
        sub(s, sqrt_ud60x18(inner)?)
    }

    fn preview_redeem(&self, shares: U256, state: CurveState) -> Result<U256, CurveError> {
        self.convert_to_assets_internal(shares, state)
    }

    fn convert_to_shares(&self, assets: U256, state: CurveState) -> Result<U256, CurveError> {
        self.convert_to_shares_internal(assets, state)
    }

    fn convert_to_assets(&self, shares: U256, state: CurveState) -> Result<U256, CurveError> {
        self.convert_to_assets_internal(shares, state)
    }

    fn current_price(&self, state: CurveState) -> Result<U256, CurveError> {
        check_curve_domains(
            state.total_assets,
            state.total_shares,
            self.max_assets,
            self.max_shares,
        )?;
        let s = add(state.total_shares, self.offset)?;
        mul_div(s, self.slope, unit())
    }
}
