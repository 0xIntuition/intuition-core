# `intuition-curves` Publish Record

**Ticket:** ENG-13598

**Published:** 2026-07-21

**Result:** `intuition-curves` v0.1.0 published to crates.io and verified.

## Scope

Publish `intuition-curves` v0.1.0 to crates.io after the ENG-13641 cargo-deny
gate, then verify the registry artifact, docs.rs build, crate ownership, and a
clean consumer project.

## Preflight Evidence

The publish path was gated by the ENG-13641 `cargo deny` CI policy. Local and CI
preflight evidence included:

- `cargo fmt --all -- --check`
- `cargo deny --exclude-unpublished check`
- `cargo package -p intuition-curves --list`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
- `cargo doc --workspace --no-deps`
- `cargo publish -p intuition-curves --dry-run`

Before publication, the crates.io API returned `404` for
`https://crates.io/api/v1/crates/intuition-curves`, confirming no existing crate
page or registry artifact.

## Publish Evidence

Command:

```bash
cargo publish -p intuition-curves
```

Published artifact:

| Field | Value |
| --- | --- |
| Crate | `intuition-curves` |
| Version | `0.1.0` |
| crates.io created_at | `2026-07-21T13:14:28.993970Z` |
| License | `MIT` |
| Checksum | `7c37020dc56bd772e645bcb51d5eef5bcc9f0f5d1e2b514b22be44def2c08001` |
| Size | `31704` bytes |
| Yanked | `false` |

Registry verification:

- crates.io API: `https://crates.io/api/v1/crates/intuition-curves` returned
  `200` with `newest_version` and `max_version` set to `0.1.0`.
- Version API: `https://crates.io/api/v1/crates/intuition-curves/0.1.0`
  returned the checksum above.
- docs.rs package page: `https://docs.rs/crate/intuition-curves/0.1.0`
  returned `200`.
- docs.rs library docs: `https://docs.rs/intuition-curves/0.1.0/curves/`
  returned `200`.

## Ownership

Final owner check:

```text
leboiko (Luis Eduardo Boiko Ferreira)
github:0xintuition:devs (devs)
```

The `github:0xintuition:devs` team owner puts the crate under Intuition team
control. Keep at least one trusted named human owner because crates.io team
owners can publish and yank, but named owners are still needed for owner
management.

## Clean Consumer Verification

Clean project path: `/tmp/intuition-curves-consumer`

Commands:

```bash
cargo init --bin --name intuition_curves_consumer
cargo add intuition-curves@0.1.0
cargo check
```

Consumer code:

```rust
use curves::{Curve, CurveState, OffsetProgressiveCurve, U256};

fn main() -> Result<(), curves::CurveError> {
    let curve = OffsetProgressiveCurve::new(
        U256::from(2_000_000_000_000_000_000u128),
        U256::from(500_000_000_000_000_000u128),
    )?;
    let state = CurveState {
        total_assets: U256::ZERO,
        total_shares: U256::from(10_000_000_000_000_000_000u128),
    };
    let shares = curve.preview_deposit(U256::from(1_000_000_000_000_000_000u128), state)?;
    assert!(shares > U256::ZERO);
    Ok(())
}
```

Result:

```text
Finished `dev` profile [unoptimized + debuginfo] target(s)
```

## Rollback State

No rollback is required. If v0.1.0 is later found unusable or unsafe, prefer
publishing a fixed patch version. Use `cargo yank intuition-curves@0.1.0` only
for an unusable or unsafe release, and record the yank reason plus replacement
version in `CHANGELOG.md`.

## Follow-Ups

- Use this crates.io evidence in the first public RC release notes.
- Keep `shared`, `rindexer-ingestion`, and `projections` unpublished until their
  public crate boundaries and dependency policies are reviewed separately.
