# Rust Crates

The Core Rust workspace contains both publishable libraries and deployable
services.

| Crate | Distribution | Notes |
| --- | --- | --- |
| `intuition-curves` | crates.io target | Bonding-curve parity library. The package name is public; the Rust library target remains `curves`. |
| `shared` | source-only | Common runtime config and domain types. Not yet a stable public API. |
| `rindexer-ingestion` | container image target | Chain event ingestion service with generated rindexer code. |
| `projections` | container image target | Event-store projection service. |

## Validation

Run from the repository root:

```bash
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo doc --workspace --no-deps
cargo package -p intuition-curves
cargo publish -p intuition-curves --dry-run
```

## Publishing

Only publish crates that have explicit metadata, package dry-run coverage, and
a release note entry. For Week 1, that means `intuition-curves` only.
