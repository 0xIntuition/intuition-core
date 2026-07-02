pub use alloy_primitives::U256;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct CurveState {
    pub total_assets: U256,
    pub total_shares: U256,
}
