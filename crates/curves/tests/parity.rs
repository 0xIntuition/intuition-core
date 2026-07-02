use std::{fs, path::PathBuf, str::FromStr};

use curves::{
    preview_deposit_with_fees, preview_redeem_with_fees, Curve, CurveError, CurveState,
    FeeSchedule, LinearCurve, OffsetProgressiveCurve, U256,
};
use serde::Deserialize;

#[derive(Debug, Deserialize)]
struct Fixtures {
    linear: LinearFixtures,
    offset_progressive: ProgressiveFixtures,
}

#[derive(Debug, Deserialize)]
struct LinearFixtures {
    preview_deposit_zero_supply: String,
    preview_mint_round_up: String,
    preview_withdraw_round_up: String,
    current_price_max_domain: String,
}

#[derive(Debug, Deserialize)]
struct ProgressiveFixtures {
    slope: String,
    offset: String,
    max_shares: String,
    max_assets: String,
    current_price_zero: String,
    preview_deposit_from_zero: String,
    preview_mint: String,
    preview_redeem: String,
    preview_withdraw: String,
    preview_redeem_zero_offset_low_shares: String,
}

fn parse_u256(raw: &str) -> U256 {
    U256::from_str(raw).expect("fixture should parse as U256")
}

fn fixtures() -> Fixtures {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/parity.json");
    serde_json::from_str(&fs::read_to_string(path).expect("fixture file should exist"))
        .expect("fixture json should deserialize")
}

#[test]
fn linear_curve_matches_parity_fixtures_and_errors() {
    let fixtures = fixtures();
    let curve = LinearCurve::new();

    assert_eq!(
        curve
            .preview_deposit(
                U256::from(1_000_000_000_000_000_000u128),
                CurveState::default()
            )
            .unwrap(),
        parse_u256(&fixtures.linear.preview_deposit_zero_supply)
    );

    assert_eq!(
        curve
            .preview_mint(
                U256::from(1_000_000_000_000_000_000u128),
                CurveState {
                    total_assets: U256::from(3_000_000_000_000_000_001u128),
                    total_shares: U256::from(2_000_000_000_000_000_000u128),
                }
            )
            .unwrap(),
        parse_u256(&fixtures.linear.preview_mint_round_up)
    );

    assert_eq!(
        curve
            .preview_withdraw(
                U256::from(1_000_000_000_000_000_000u128),
                CurveState {
                    total_assets: U256::from(3_000_000_000_000_000_000u128),
                    total_shares: U256::from(2_000_000_000_000_000_000u128),
                }
            )
            .unwrap(),
        parse_u256(&fixtures.linear.preview_withdraw_round_up)
    );

    assert_eq!(
        curve
            .current_price(CurveState {
                total_assets: U256::MAX,
                total_shares: U256::MAX,
            })
            .unwrap(),
        parse_u256(&fixtures.linear.current_price_max_domain)
    );

    assert_eq!(
        curve.convert_to_assets(U256::from(1u8), CurveState::default()),
        Err(CurveError::SharesExceedTotalShares)
    );
    assert_eq!(
        curve
            .preview_mint(U256::from(7u8), CurveState::default())
            .unwrap(),
        U256::from(7u8)
    );
    assert_eq!(
        curve
            .preview_withdraw(
                U256::from(7u8),
                CurveState {
                    total_assets: U256::from(7u8),
                    total_shares: U256::ZERO,
                }
            )
            .unwrap(),
        U256::from(7u8)
    );
    assert_eq!(
        curve.preview_deposit(
            U256::from(1u8),
            CurveState {
                total_assets: U256::MAX,
                total_shares: U256::ZERO
            }
        ),
        Err(CurveError::AssetsOverflowMax)
    );
    assert_eq!(
        curve.preview_mint(
            U256::from(1u8),
            CurveState {
                total_assets: U256::ZERO,
                total_shares: U256::MAX
            }
        ),
        Err(CurveError::SharesOverflowMax)
    );
}

#[test]
fn offset_progressive_curve_matches_parity_fixtures_and_errors() {
    let fixtures = fixtures();
    let slope = parse_u256(&fixtures.offset_progressive.slope);
    let offset = parse_u256(&fixtures.offset_progressive.offset);
    let curve = OffsetProgressiveCurve::new(slope, offset).unwrap();

    assert_eq!(
        curve.max_shares(),
        parse_u256(&fixtures.offset_progressive.max_shares)
    );
    assert_eq!(
        curve.max_assets(),
        parse_u256(&fixtures.offset_progressive.max_assets)
    );
    assert_eq!(
        curve.current_price(CurveState::default()).unwrap(),
        parse_u256(&fixtures.offset_progressive.current_price_zero)
    );
    assert_eq!(
        curve
            .preview_deposit(
                U256::from(1_000_000_000_000_000_000u128),
                CurveState::default()
            )
            .unwrap(),
        parse_u256(&fixtures.offset_progressive.preview_deposit_from_zero)
    );
    assert_eq!(
        curve
            .preview_mint(
                U256::from(1_000_000_000_000_000_000u128),
                CurveState {
                    total_assets: U256::ZERO,
                    total_shares: U256::from(10_000_000_000_000_000_000u128),
                }
            )
            .unwrap(),
        parse_u256(&fixtures.offset_progressive.preview_mint)
    );
    assert_eq!(
        curve
            .preview_redeem(
                U256::from(1_000_000_000_000_000_000u128),
                CurveState {
                    total_assets: U256::ZERO,
                    total_shares: U256::from(10_000_000_000_000_000_000u128),
                }
            )
            .unwrap(),
        parse_u256(&fixtures.offset_progressive.preview_redeem)
    );
    assert_eq!(
        curve
            .preview_withdraw(
                U256::from(1_000_000_000_000_000_000u128),
                CurveState {
                    total_assets: U256::from(1_000_000_000_000_000_000u128),
                    total_shares: U256::from(10_000_000_000_000_000_000u128),
                }
            )
            .unwrap(),
        parse_u256(&fixtures.offset_progressive.preview_withdraw)
    );

    let zero_offset_curve = OffsetProgressiveCurve::new(slope, U256::ZERO).unwrap();
    assert_eq!(
        zero_offset_curve
            .preview_redeem(
                U256::from(699_560_508u64),
                CurveState {
                    total_assets: U256::ZERO,
                    total_shares: U256::from(700_560_508u64),
                }
            )
            .unwrap(),
        parse_u256(
            &fixtures
                .offset_progressive
                .preview_redeem_zero_offset_low_shares
        )
    );

    assert_eq!(
        OffsetProgressiveCurve::new(U256::from(3u8), offset),
        Err(CurveError::InvalidSlope)
    );
    assert_eq!(
        OffsetProgressiveCurve::new(
            slope,
            parse_u256(&fixtures.offset_progressive.max_shares) + offset + U256::from(1u8)
        ),
        Err(CurveError::MathUnderflow)
    );
    assert_eq!(
        curve.current_price(CurveState {
            total_assets: curve.max_assets() + U256::from(1u8),
            total_shares: curve.max_shares(),
        }),
        Err(CurveError::DomainExceeded)
    );
}

#[test]
fn fee_helpers_stay_separate_from_pure_curve_math() {
    let curve = LinearCurve::new();
    let fees = FeeSchedule {
        denominator: U256::from(10_000u64),
        protocol_fee: U256::from(100u64),
        entry_fee: U256::from(50u64),
        exit_fee: U256::from(25u64),
    };
    let state = CurveState {
        total_assets: U256::from(10_000u64),
        total_shares: U256::from(10_000u64),
    };

    let deposit =
        preview_deposit_with_fees(&curve, U256::from(1_000u64), state, fees, true).unwrap();
    assert_eq!(deposit.assets_after_fees, U256::from(985u64));
    assert_eq!(deposit.shares, U256::from(985u64));

    let redeem = preview_redeem_with_fees(&curve, U256::from(1_000u64), state, fees, true).unwrap();
    assert_eq!(redeem.assets_before_fees, U256::from(1_000u64));
    assert_eq!(redeem.assets_after_fees, U256::from(987u64));
}
