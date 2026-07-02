# `backend/curves`

Canonical off-chain bonding-curve library for Intuition backend services.

The crate mirrors the Solidity surface for:

- `LinearCurve`
- `OffsetProgressiveCurve`
- rounding-sensitive helpers from `ProgressiveCurveMathLib.sol`

It keeps the pure parity layer separate from optional fee-aware quoting helpers so backend
code can reuse the contract math directly and only opt into fee simulation when needed.

## Workspace strategy

`backend/curves` is a standalone Cargo crate with its own manifest. This matches the
existing backend layout where `backend/indexing-services` has an isolated workspace and
`backend/atom-parser-service` is also standalone. Commands should target
`backend/curves/Cargo.toml` directly.

## Scope

- Exact parity for curve previews, conversions, bounds checks, and current-price math
- Shared `U256` types and typed errors
- Fee-aware wrappers for backend deposit and redeem simulation
- Parity fixtures and example usage for downstream adoption

## Non-goals

- Re-implementing `MultiVault` fee-threshold branching or vault lifecycle rules
- Replacing on-chain validation for inconsistent `totalAssets` / `totalShares` state
- Introducing a repo-root Cargo workspace

## Recommended Adoption Points

- `backend/indexing-services`: centralize share-price, market-cap, and preview logic in Rust
  rather than re-encoding curve formulas in projection code.
- `backend/e2e-tests`: use this crate for off-chain expected-value previews when contract
  interactions need a Rust-side oracle or regression fixtures.
- Future backend services: prefer taking `CurveState { total_assets, total_shares }` plus a
  curve config and calling the crate directly instead of open-coding ratios or progressive math.

## Adoption Status

- Landed in `backend/indexing-services` for market-cap normalization inside projections.
- Landed in `backend/e2e-tests` as a consumer-side exact market-cap helper for regression checks.
- Broader app and service migration is intentionally deferred to a follow-up adoption ticket so
  this crate can stay the parity source of truth without expanding this ticket into a repository-
  wide refactor.

## Example

```rust
use alloy_primitives::U256;
use curves::{Curve, CurveState, OffsetProgressiveCurve};

let curve = OffsetProgressiveCurve::new(U256::from(2_000_000_000_000_000_000u128), U256::from(500_000_000_000_000_000u128))?;
let state = CurveState {
    total_assets: U256::ZERO,
    total_shares: U256::from(10_000_000_000_000_000_000u128),
};

let shares = curve.preview_deposit(U256::from(1_000_000_000_000_000_000u128), state)?;
assert!(shares > U256::ZERO);
# Ok::<(), curves::CurveError>(())
```

Run validation with:

```bash
cargo fmt --manifest-path backend/curves/Cargo.toml --all --check
cargo test --manifest-path backend/curves/Cargo.toml
cargo test --manifest-path backend/curves/Cargo.toml --test parity
```
