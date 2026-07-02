use crate::{CurveError, CurveState, U256};

pub trait Curve {
    fn max_shares(&self) -> U256;
    fn max_assets(&self) -> U256;

    fn preview_deposit(&self, assets: U256, state: CurveState) -> Result<U256, CurveError>;
    fn preview_mint(&self, shares: U256, state: CurveState) -> Result<U256, CurveError>;
    fn preview_withdraw(&self, assets: U256, state: CurveState) -> Result<U256, CurveError>;
    fn preview_redeem(&self, shares: U256, state: CurveState) -> Result<U256, CurveError>;
    fn convert_to_shares(&self, assets: U256, state: CurveState) -> Result<U256, CurveError>;
    fn convert_to_assets(&self, shares: U256, state: CurveState) -> Result<U256, CurveError>;
    fn current_price(&self, state: CurveState) -> Result<U256, CurveError>;
}
