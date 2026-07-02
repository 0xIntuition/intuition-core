use alloy_primitives::U256;
use curves::{
    market_cap, preview_deposit_with_fees, Curve, CurveState, FeeSchedule, OffsetProgressiveCurve,
};

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let curve = OffsetProgressiveCurve::new(
        U256::from(2_000_000_000_000_000_000u128),
        U256::from(500_000_000_000_000_000u128),
    )?;
    let state = CurveState {
        total_assets: U256::ZERO,
        total_shares: U256::from(10_000_000_000_000_000_000u128),
    };

    let quote = preview_deposit_with_fees(
        &curve,
        U256::from(10_000_000_000_000_000_000u128),
        state,
        FeeSchedule {
            denominator: U256::from(10_000u64),
            protocol_fee: U256::from(100u64),
            entry_fee: U256::from(50u64),
            exit_fee: U256::from(50u64),
        },
        true,
    )?;

    let share_price = curve.current_price(state)?;
    let market_cap = market_cap(state.total_shares, share_price)?;

    println!("previewed shares: {}", quote.shares);
    println!("net assets into vault: {}", quote.assets_after_fees);
    println!("share price: {}", share_price);
    println!("market cap: {}", market_cap);
    Ok(())
}
