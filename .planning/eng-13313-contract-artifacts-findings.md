# ENG-13313 Contract Artifact Integration Findings

Date: 2026-07-08

## Decisions

- `ENG-13313` now uses `@0xintuition/contracts-v2` as the contract artifact
  source of truth instead of copying ABIs from another repository.
- The latest published version at implementation time is
  `1.0.0-alpha.0`, published on 2026-07-07.
- `packages/contracts` is a thin backend-facing facade over the upstream NPM
  package. It re-exports `MultiVaultAbi`, `MultiVaultBytecode`, and the
  rindexer event list.
- `crates/rindexer-ingestion/abi/MultiVault.json` is generated from the NPM ABI
  export with `bun run --cwd packages/contracts sync:rindexer-artifacts`.

## Findings

- The repo's Bun install policy blocks packages published less than 14 days
  ago. Because `@0xintuition/contracts-v2` only has one first-party version and
  the ticket requires the latest package, `bunfig.toml` has a narrow reviewed
  exception for `@0xintuition/contracts-v2`.
- The supply-chain guard now rejects any unreviewed additions to
  `minimumReleaseAgeExcludes`.
- `cargo clippy --workspace --all-targets -- -D warnings` failed in the
  rindexer-generated ABI binding because the Solidity ABI macro expands event
  constructors with more than seven arguments. The fix is a module-level
  `#![allow(clippy::too_many_arguments)]` on the generated binding file only.
- The checked-in rindexer JSON ABI and the Rust generated binding are separate
  artifacts. This change keeps the JSON ABI package-backed, but does not
  regenerate the rindexer Rust bindings.

## Validation

- `bun run guard:supply-chain`
- `bun run typecheck`
- `bunx @biomejs/biome ci .`
- `bun run test`
- `docker compose config -q`
- `docker compose -f docker-compose.datastores.yml config -q`
- `cargo fmt --all -- --check`
- `cargo clippy --workspace --all-targets -- -D warnings`
- `cargo test --workspace`
