//! Canonical off-chain bonding-curve math for Intuition backend services.
//!
//! The crate mirrors the Solidity parity surface for:
//!
//! - [`LinearCurve`]
//! - [`OffsetProgressiveCurve`]
//! - rounding-sensitive helpers from `ProgressiveCurveMathLib.sol`
//!
//! Fee handling stays outside the pure curve implementations so callers can opt into quote
//! simulation without changing the contract-math layer.
//!
//! ```rust
//! use curves::{Curve, CurveState, OffsetProgressiveCurve, U256};
//!
//! let curve = OffsetProgressiveCurve::new(
//!     U256::from(2_000_000_000_000_000_000u128),
//!     U256::from(500_000_000_000_000_000u128),
//! )?;
//! let state = CurveState {
//!     total_assets: U256::ZERO,
//!     total_shares: U256::from(10_000_000_000_000_000_000u128),
//! };
//!
//! let shares = curve.preview_deposit(U256::from(1_000_000_000_000_000_000u128), state)?;
//! assert!(shares > U256::ZERO);
//! # Ok::<(), curves::CurveError>(())
//! ```

mod errors;
mod fees;
mod linear;
mod math;
mod offset_progressive;
mod traits;
mod types;

pub use errors::CurveError;
pub use fees::{
    preview_atom_deposit, preview_deposit_with_fees, preview_redeem_with_fees,
    preview_triple_deposit, AtomFees, DepositQuote, FeeBreakdown, FeeSchedule, RedeemQuote,
    TripleFees,
};
pub use linear::LinearCurve;
pub use math::{fee_on_raw, market_cap, unit};
pub use offset_progressive::OffsetProgressiveCurve;
pub use traits::Curve;
pub use types::{CurveState, U256};
