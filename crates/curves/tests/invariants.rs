use curves::{
    preview_deposit_with_fees, preview_redeem_with_fees, Curve, CurveError, CurveState,
    FeeSchedule, LinearCurve, OffsetProgressiveCurve, U256,
};

fn one() -> U256 {
    U256::from(1_000_000_000_000_000_000u128)
}

fn default_progressive() -> OffsetProgressiveCurve {
    OffsetProgressiveCurve::new(
        U256::from(2_000_000_000_000_000_000u128),
        U256::from(500_000_000_000_000_000u128),
    )
    .unwrap()
}

// =====================================================================
// Round-trip invariants: deposit → redeem should never produce more
// assets than were deposited (protocol always favored by rounding).
// =====================================================================

#[test]
fn linear_deposit_then_redeem_never_profits() {
    let curve = LinearCurve::new();
    let deposit_amount = U256::from(5_000_000_000_000_000_000u128);

    for (total_assets, total_shares) in [
        (U256::ZERO, U256::ZERO),
        (one(), one()),
        (U256::from(100u64) * one(), U256::from(50u64) * one()),
        (U256::from(999_999_999u64), U256::from(1_000_000_001u64)),
    ] {
        let state = CurveState {
            total_assets,
            total_shares,
        };
        let shares = curve.preview_deposit(deposit_amount, state).unwrap();

        let state_after = CurveState {
            total_assets: total_assets + deposit_amount,
            total_shares: total_shares + shares,
        };
        let assets_back = curve.preview_redeem(shares, state_after).unwrap();
        assert!(
            assets_back <= deposit_amount,
            "round-trip profit: deposited {deposit_amount}, got back {assets_back}"
        );
    }
}

#[test]
fn progressive_deposit_then_redeem_never_profits() {
    let curve = default_progressive();
    let deposit_amount = U256::from(5_000_000_000_000_000_000u128);

    for (total_assets, total_shares) in [
        (U256::ZERO, U256::ZERO),
        (U256::ZERO, U256::from(10u64) * one()),
        (U256::from(50u64) * one(), U256::from(100u64) * one()),
    ] {
        let state = CurveState {
            total_assets,
            total_shares,
        };
        let shares = curve.preview_deposit(deposit_amount, state).unwrap();

        let state_after = CurveState {
            total_assets: total_assets + deposit_amount,
            total_shares: total_shares + shares,
        };
        let assets_back = curve.preview_redeem(shares, state_after).unwrap();
        assert!(
            assets_back <= deposit_amount,
            "round-trip profit at shares={total_shares}: deposited {deposit_amount}, got back {assets_back}"
        );
    }
}

// =====================================================================
// Round-trip invariants: mint → withdraw consistency.
// preview_mint gives assets needed for N shares; preview_withdraw gives
// shares needed to extract those assets. They should be consistent.
// =====================================================================

#[test]
fn linear_mint_withdraw_consistency() {
    let curve = LinearCurve::new();
    let mint_shares = one();
    let state = CurveState {
        total_assets: U256::from(10u64) * one(),
        total_shares: U256::from(5u64) * one(),
    };

    let assets_needed = curve.preview_mint(mint_shares, state).unwrap();

    let state_after = CurveState {
        total_assets: state.total_assets + assets_needed,
        total_shares: state.total_shares + mint_shares,
    };
    let shares_to_withdraw = curve.preview_withdraw(assets_needed, state_after).unwrap();

    // Withdraw rounds up (more shares burned), so shares_to_withdraw >= mint_shares
    assert!(shares_to_withdraw >= mint_shares);
}

#[test]
fn progressive_mint_withdraw_consistency() {
    let curve = default_progressive();
    let mint_shares = one();
    let state = CurveState {
        total_assets: U256::ZERO,
        total_shares: U256::from(10u64) * one(),
    };

    let assets_needed = curve.preview_mint(mint_shares, state).unwrap();

    let state_after = CurveState {
        total_assets: state.total_assets + assets_needed,
        total_shares: state.total_shares + mint_shares,
    };
    let shares_to_withdraw = curve.preview_withdraw(assets_needed, state_after).unwrap();
    assert!(shares_to_withdraw >= mint_shares);
}

// =====================================================================
// Multi-step simulation: sequence of deposits then full redeem.
// Final redeem should drain ≤ accumulated assets.
// =====================================================================

#[test]
fn linear_multi_deposit_full_redeem() {
    let curve = LinearCurve::new();
    let mut total_assets = U256::ZERO;
    let mut total_shares = U256::ZERO;
    let mut deposited = U256::ZERO;

    let amounts = [
        one(),
        U256::from(3u64) * one(),
        U256::from(7u64) * one(),
        U256::from(2u64) * one(),
    ];

    for amount in amounts {
        let state = CurveState {
            total_assets,
            total_shares,
        };
        let shares = curve.preview_deposit(amount, state).unwrap();
        total_assets += amount;
        total_shares += shares;
        deposited += amount;
    }

    // Redeem ALL shares
    let state = CurveState {
        total_assets,
        total_shares,
    };
    let assets_back = curve.preview_redeem(total_shares, state).unwrap();
    assert_eq!(
        assets_back, total_assets,
        "linear full redeem should return all assets"
    );
}

#[test]
fn progressive_multi_deposit_full_redeem_bounded() {
    let curve = default_progressive();
    let mut total_assets = U256::ZERO;
    let mut total_shares = U256::ZERO;

    let amounts = [one(), U256::from(5u64) * one(), U256::from(10u64) * one()];

    let mut total_deposited = U256::ZERO;
    for amount in amounts {
        let state = CurveState {
            total_assets,
            total_shares,
        };
        let shares = curve.preview_deposit(amount, state).unwrap();
        total_assets += amount;
        total_shares += shares;
        total_deposited += amount;
    }

    // Redeem ALL shares
    let state = CurveState {
        total_assets,
        total_shares,
    };
    let assets_back = curve.preview_redeem(total_shares, state).unwrap();
    // Due to rounding across sqrt/square/mul_div, we may lose a small amount
    assert!(assets_back <= total_deposited);
    // Progressive curves compound rounding across multiple fixed-point ops
    // per deposit (square + sqrt + mul_div), so allow ~10 wei per operation
    let loss = total_deposited - assets_back;
    assert!(
        loss < U256::from(amounts.len() * 10),
        "rounding loss {loss} too large for {} deposits",
        amounts.len()
    );
}

// =====================================================================
// Monotonicity: larger deposits → more shares (same state).
// =====================================================================

#[test]
fn linear_deposit_monotonic() {
    let curve = LinearCurve::new();
    let state = CurveState {
        total_assets: U256::from(10u64) * one(),
        total_shares: U256::from(5u64) * one(),
    };

    let small = curve.preview_deposit(one(), state).unwrap();
    let large = curve
        .preview_deposit(U256::from(10u64) * one(), state)
        .unwrap();
    assert!(large > small);
}

#[test]
fn progressive_deposit_monotonic() {
    let curve = default_progressive();
    let state = CurveState {
        total_assets: U256::ZERO,
        total_shares: U256::from(10u64) * one(),
    };

    let small = curve.preview_deposit(one(), state).unwrap();
    let large = curve
        .preview_deposit(U256::from(10u64) * one(), state)
        .unwrap();
    assert!(large > small);
}

// =====================================================================
// Price monotonicity: more shares → higher price for progressive.
// =====================================================================

#[test]
fn progressive_price_increases_with_supply() {
    let curve = default_progressive();

    let prices: Vec<U256> = (0..5)
        .map(|i| {
            let state = CurveState {
                total_assets: U256::ZERO,
                total_shares: U256::from(i as u64) * U256::from(10u64) * one(),
            };
            curve.current_price(state).unwrap()
        })
        .collect();

    for window in prices.windows(2) {
        assert!(
            window[1] > window[0],
            "price should increase: {} → {}",
            window[0],
            window[1]
        );
    }
}

// =====================================================================
// Zero-amount edge cases.
// =====================================================================

#[test]
fn linear_zero_deposit_returns_zero_shares() {
    let curve = LinearCurve::new();
    let state = CurveState {
        total_assets: U256::from(10u64) * one(),
        total_shares: U256::from(5u64) * one(),
    };
    let shares = curve.preview_deposit(U256::ZERO, state).unwrap();
    assert_eq!(shares, U256::ZERO);
}

#[test]
fn progressive_zero_deposit_returns_zero_shares() {
    let curve = default_progressive();
    let state = CurveState {
        total_assets: U256::ZERO,
        total_shares: U256::from(10u64) * one(),
    };
    let shares = curve.preview_deposit(U256::ZERO, state).unwrap();
    assert_eq!(shares, U256::ZERO);
}

#[test]
fn linear_zero_redeem_returns_zero_assets() {
    let curve = LinearCurve::new();
    let state = CurveState {
        total_assets: U256::from(10u64) * one(),
        total_shares: U256::from(5u64) * one(),
    };
    let assets = curve.preview_redeem(U256::ZERO, state).unwrap();
    assert_eq!(assets, U256::ZERO);
}

#[test]
fn progressive_zero_redeem_returns_zero_assets() {
    let curve = default_progressive();
    let state = CurveState {
        total_assets: U256::ZERO,
        total_shares: U256::from(10u64) * one(),
    };
    let assets = curve.preview_redeem(U256::ZERO, state).unwrap();
    assert_eq!(assets, U256::ZERO);
}

// =====================================================================
// LinearCurve: preview_redeem with various non-trivial states.
// =====================================================================

#[test]
fn linear_preview_redeem_non_trivial_states() {
    let curve = LinearCurve::new();

    // Equal assets:shares → 1:1 redemption
    let assets = curve
        .preview_redeem(
            one(),
            CurveState {
                total_assets: U256::from(10u64) * one(),
                total_shares: U256::from(10u64) * one(),
            },
        )
        .unwrap();
    assert_eq!(assets, one());

    // 2:1 assets:shares → each share worth 2 assets
    let assets = curve
        .preview_redeem(
            one(),
            CurveState {
                total_assets: U256::from(20u64) * one(),
                total_shares: U256::from(10u64) * one(),
            },
        )
        .unwrap();
    assert_eq!(assets, U256::from(2u64) * one());

    // Redeem all shares returns all assets
    let total_assets = U256::from(123_456_789u64);
    let total_shares = U256::from(987_654_321u64);
    let assets = curve
        .preview_redeem(
            total_shares,
            CurveState {
                total_assets,
                total_shares,
            },
        )
        .unwrap();
    assert_eq!(assets, total_assets);
}

// =====================================================================
// convert_to_shares / convert_to_assets consistency.
// =====================================================================

#[test]
fn linear_convert_matches_preview() {
    let curve = LinearCurve::new();
    let state = CurveState {
        total_assets: U256::from(10u64) * one(),
        total_shares: U256::from(5u64) * one(),
    };

    let deposit_shares = curve.preview_deposit(one(), state).unwrap();
    let convert_shares = curve.convert_to_shares(one(), state).unwrap();
    assert_eq!(deposit_shares, convert_shares);

    let redeem_assets = curve.preview_redeem(one(), state).unwrap();
    let convert_assets = curve.convert_to_assets(one(), state).unwrap();
    assert_eq!(redeem_assets, convert_assets);
}

#[test]
fn progressive_convert_matches_preview() {
    let curve = default_progressive();
    let state = CurveState {
        total_assets: U256::ZERO,
        total_shares: U256::from(10u64) * one(),
    };

    let deposit_shares = curve.preview_deposit(one(), state).unwrap();
    let convert_shares = curve.convert_to_shares(one(), state).unwrap();
    assert_eq!(deposit_shares, convert_shares);

    let redeem_assets = curve.preview_redeem(one(), state).unwrap();
    let convert_assets = curve.convert_to_assets(one(), state).unwrap();
    assert_eq!(redeem_assets, convert_assets);
}

// =====================================================================
// Rounding direction: deposit rounds down, mint rounds up.
// =====================================================================

#[test]
fn linear_rounding_directions() {
    let curve = LinearCurve::new();

    // State where rounding matters: 3 assets / 2 shares (non-integer ratio)
    let state = CurveState {
        total_assets: U256::from(3u64),
        total_shares: U256::from(2u64),
    };

    // preview_deposit rounds down (fewer shares for depositor)
    let deposit_shares = curve.preview_deposit(U256::from(1u64), state).unwrap();
    // preview_mint rounds up (more assets required from minter)
    let mint_assets = curve.preview_mint(U256::from(1u64), state).unwrap();

    // mint should require at least as many assets as deposit would give for 1 share
    // deposit: 1 * 2 / 3 = 0 (rounded down)
    // mint: ceil(1 * 3 / 2) = 2 (rounded up)
    assert_eq!(deposit_shares, U256::ZERO);
    assert_eq!(mint_assets, U256::from(2u64));
}

#[test]
fn progressive_mint_costs_at_least_as_much_as_deposit_earns() {
    let curve = default_progressive();
    let state = CurveState {
        total_assets: U256::ZERO,
        total_shares: U256::from(10u64) * one(),
    };

    let shares = one();
    let mint_cost = curve.preview_mint(shares, state).unwrap();

    // Depositing mint_cost should yield at most `shares`
    let deposit_result = curve.preview_deposit(mint_cost, state).unwrap();
    assert!(deposit_result <= shares + U256::from(1u8));
}

// =====================================================================
// OffsetProgressiveCurve: different slopes and offsets.
// =====================================================================

#[test]
fn progressive_various_slopes() {
    for slope_wad in [2u128, 4, 10, 100, 1_000_000] {
        let slope = U256::from(slope_wad * 1_000_000_000_000_000_000u128);
        let curve = OffsetProgressiveCurve::new(slope, U256::ZERO).unwrap();

        let shares = curve.preview_deposit(one(), CurveState::default()).unwrap();
        assert!(shares > U256::ZERO, "slope={slope_wad} should yield shares");

        let price = curve.current_price(CurveState::default()).unwrap();
        assert_eq!(
            price,
            U256::ZERO,
            "price at zero supply with zero offset should be 0"
        );
    }
}

#[test]
fn progressive_zero_offset() {
    let slope = U256::from(2_000_000_000_000_000_000u128);
    let curve = OffsetProgressiveCurve::new(slope, U256::ZERO).unwrap();

    // At zero supply with zero offset, price should be zero
    let price = curve.current_price(CurveState::default()).unwrap();
    assert_eq!(price, U256::ZERO);

    // Deposit should still work
    let shares = curve.preview_deposit(one(), CurveState::default()).unwrap();
    assert!(shares > U256::ZERO);
}

#[test]
fn progressive_large_offset() {
    let slope = U256::from(2_000_000_000_000_000_000u128);
    let offset = U256::from(1_000_000u128) * one(); // 1M units offset
    let curve = OffsetProgressiveCurve::new(slope, offset).unwrap();

    // Price at zero supply should be offset * slope / 1e18
    let price = curve.current_price(CurveState::default()).unwrap();
    let expected = U256::from(2_000_000u128) * one(); // offset * slope
    assert_eq!(price, expected);
}

// =====================================================================
// Error: shares exceed total, assets exceed total.
// =====================================================================

#[test]
fn progressive_redeem_more_than_total_fails() {
    let curve = default_progressive();
    let state = CurveState {
        total_assets: one(),
        total_shares: one(),
    };
    assert_eq!(
        curve.preview_redeem(one() + U256::from(1u8), state),
        Err(CurveError::SharesExceedTotalShares)
    );
}

#[test]
fn progressive_withdraw_more_than_total_fails() {
    let curve = default_progressive();
    let state = CurveState {
        total_assets: one(),
        total_shares: U256::from(10u64) * one(),
    };
    assert_eq!(
        curve.preview_withdraw(one() + U256::from(1u8), state),
        Err(CurveError::AssetsExceedTotalAssets)
    );
}

// =====================================================================
// Fee edge cases.
// =====================================================================

#[test]
fn fees_with_zero_protocol_fee() {
    let curve = LinearCurve::new();
    let fees = FeeSchedule {
        denominator: U256::from(10_000u64),
        protocol_fee: U256::ZERO,
        entry_fee: U256::from(100u64), // 1%
        exit_fee: U256::from(100u64),
    };
    let state = CurveState {
        total_assets: U256::from(10u64) * one(),
        total_shares: U256::from(10u64) * one(),
    };

    let deposit = preview_deposit_with_fees(&curve, one(), state, fees, true).unwrap();
    assert_eq!(deposit.fees.protocol_fee, U256::ZERO);
    assert!(deposit.fees.entry_fee > U256::ZERO);
}

#[test]
fn fees_entry_fee_skipped_when_flag_false() {
    let curve = LinearCurve::new();
    let fees = FeeSchedule {
        denominator: U256::from(10_000u64),
        protocol_fee: U256::from(100u64),
        entry_fee: U256::from(500u64), // 5% - would be significant
        exit_fee: U256::from(100u64),
    };
    let state = CurveState {
        total_assets: U256::from(10u64) * one(),
        total_shares: U256::from(10u64) * one(),
    };

    let with_fee = preview_deposit_with_fees(&curve, one(), state, fees, true).unwrap();
    let without_fee = preview_deposit_with_fees(&curve, one(), state, fees, false).unwrap();

    assert!(without_fee.shares > with_fee.shares);
    assert_eq!(without_fee.fees.entry_fee, U256::ZERO);
}

#[test]
fn fees_exit_fee_skipped_when_flag_false() {
    let curve = LinearCurve::new();
    let fees = FeeSchedule {
        denominator: U256::from(10_000u64),
        protocol_fee: U256::from(100u64),
        entry_fee: U256::from(100u64),
        exit_fee: U256::from(500u64), // 5%
    };
    let state = CurveState {
        total_assets: U256::from(10u64) * one(),
        total_shares: U256::from(10u64) * one(),
    };

    let with_fee = preview_redeem_with_fees(&curve, one(), state, fees, true).unwrap();
    let without_fee = preview_redeem_with_fees(&curve, one(), state, fees, false).unwrap();

    assert!(without_fee.assets_after_fees > with_fee.assets_after_fees);
    assert_eq!(without_fee.fees.exit_fee, U256::ZERO);
}

#[test]
fn fees_with_progressive_curve() {
    let curve = default_progressive();
    let fees = FeeSchedule {
        denominator: U256::from(10_000u64),
        protocol_fee: U256::from(100u64),
        entry_fee: U256::from(50u64),
        exit_fee: U256::from(25u64),
    };
    let state = CurveState {
        total_assets: U256::ZERO,
        total_shares: U256::from(10u64) * one(),
    };

    let deposit =
        preview_deposit_with_fees(&curve, U256::from(10u64) * one(), state, fees, true).unwrap();
    assert!(deposit.assets_after_fees < U256::from(10u64) * one());
    assert!(deposit.shares > U256::ZERO);

    // State after deposit
    let state_after = CurveState {
        total_assets: state.total_assets + deposit.assets_after_fees,
        total_shares: state.total_shares + deposit.shares,
    };
    let redeem = preview_redeem_with_fees(&curve, deposit.shares, state_after, fees, true).unwrap();
    assert!(redeem.assets_after_fees < deposit.assets_after_fees);
}

// =====================================================================
// Multi-step simulation with interleaved deposits and redeems.
// =====================================================================

#[test]
fn progressive_interleaved_deposit_redeem_simulation() {
    let curve = default_progressive();
    let mut total_assets = U256::ZERO;
    let mut total_shares = U256::ZERO;

    // User A deposits 5 ETH
    let a_deposit = U256::from(5u64) * one();
    let state = CurveState {
        total_assets,
        total_shares,
    };
    let a_shares = curve.preview_deposit(a_deposit, state).unwrap();
    total_assets += a_deposit;
    total_shares += a_shares;

    // User B deposits 10 ETH
    let b_deposit = U256::from(10u64) * one();
    let state = CurveState {
        total_assets,
        total_shares,
    };
    let b_shares = curve.preview_deposit(b_deposit, state).unwrap();
    total_assets += b_deposit;
    total_shares += b_shares;

    // User A redeems all their shares
    let state = CurveState {
        total_assets,
        total_shares,
    };
    let a_received = curve.preview_redeem(a_shares, state).unwrap();
    total_assets -= a_received;
    total_shares -= a_shares;

    // User B redeems all their shares
    let state = CurveState {
        total_assets,
        total_shares,
    };
    let b_received = curve.preview_redeem(b_shares, state).unwrap();
    total_assets -= b_received;
    total_shares -= b_shares;

    // Rounding dust: total_assets should be very small (just rounding residue)
    assert!(
        total_assets < U256::from(10u8),
        "residual assets {total_assets} too large after full redemption"
    );
    assert_eq!(total_shares, U256::ZERO);

    // Early depositor (A) benefits from bonding curve - gets back more
    // than deposited because B's later deposit pushed the price up
    assert!(
        a_received > a_deposit,
        "early depositor should profit from later deposits on progressive curve"
    );
}

// =====================================================================
// OffsetProgressiveCurve: max_shares matches UD60x18 sqrt parity.
// =====================================================================

#[test]
fn progressive_max_shares_matches_ud60x18_sqrt() {
    let slope = U256::from(2_000_000_000_000_000_000u128);
    let curve = OffsetProgressiveCurve::new(slope, U256::ZERO).unwrap();

    // With zero offset, max_shares should be isqrt(U256::MAX / 1e18 * 1e18)
    // which equals 2^128 - 1 (since (U256::MAX / 1e18) * 1e18 ≈ U256::MAX)
    let two_pow_128_minus_1 = U256::from(1u8) << 128;
    let expected = two_pow_128_minus_1 - U256::from(1u8);
    assert_eq!(curve.max_shares(), expected);
}

// =====================================================================
// OffsetProgressiveCurve: construction validation.
// =====================================================================

#[test]
fn progressive_rejects_zero_slope() {
    assert_eq!(
        OffsetProgressiveCurve::new(U256::ZERO, U256::ZERO),
        Err(CurveError::InvalidSlope)
    );
}

#[test]
fn progressive_rejects_odd_slope() {
    assert_eq!(
        OffsetProgressiveCurve::new(U256::from(1u8), U256::ZERO),
        Err(CurveError::InvalidSlope)
    );
    assert_eq!(
        OffsetProgressiveCurve::new(U256::from(3u8), U256::ZERO),
        Err(CurveError::InvalidSlope)
    );
    assert_eq!(
        OffsetProgressiveCurve::new(U256::from(1_000_000_000_000_000_001u128), U256::ZERO,),
        Err(CurveError::InvalidSlope)
    );
}

#[test]
fn progressive_accepts_even_slopes() {
    for slope in [2u128, 4, 100, 2_000_000_000_000_000_000] {
        assert!(
            OffsetProgressiveCurve::new(U256::from(slope), U256::ZERO).is_ok(),
            "slope={slope} should be valid"
        );
    }
}

// =====================================================================
// LinearCurve: full operations on default (zero) state.
// =====================================================================

#[test]
fn linear_all_operations_from_zero() {
    let curve = LinearCurve::new();
    let state = CurveState::default();

    // First deposit is 1:1
    let shares = curve.preview_deposit(one(), state).unwrap();
    assert_eq!(shares, one());

    // Mint from zero is 1:1
    let assets = curve.preview_mint(one(), state).unwrap();
    assert_eq!(assets, one());

    // Current price from zero state (0 shares / 0 assets) returns 1:1
    let price = curve.current_price(state).unwrap();
    assert_eq!(price, one());
}

// =====================================================================
// OffsetProgressiveCurve: accessor getters.
// =====================================================================

#[test]
fn progressive_accessors() {
    let slope = U256::from(4_000_000_000_000_000_000u128);
    let offset = U256::from(1_000_000_000_000_000_000u128);
    let curve = OffsetProgressiveCurve::new(slope, offset).unwrap();

    assert_eq!(curve.slope(), slope);
    assert_eq!(curve.half_slope(), slope >> 1);
    assert_eq!(curve.offset(), offset);
    assert!(curve.max_shares() > U256::ZERO);
    assert!(curve.max_assets() > U256::ZERO);
}
