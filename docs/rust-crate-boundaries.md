# Rust Crate Boundaries

This design explains how to split the current `shared` Rust crate into stable
public crates without exposing service internals as a semver contract.

## Current Audit

`crates/shared` is source-only today. It is consumed by `crates/projections` and
mixes three different responsibilities:

| Module | Current contents | Public API suitability |
| --- | --- | --- |
| `types` | `EventType`, `VaultType`, `IngestionMode`, block/log/sequence aliases, ID aliases. | Mostly public, but enum evolution needs semver annotations. |
| `models` | `StoredEvent`, typed MultiVault event payload records, projection checkpoint/read-model rows. | Split: event envelopes and payloads are public; checkpoint/read-model rows are service/database contracts. |
| `parsed_event` | `ParsedEvent`, `EventMetadata`, parse helpers, `ParseError`. | Public if the event record types move with it and the unknown-event fallback remains. |
| `errors` | `IndexerError`, retry classification, deprecated helper shims. | Service-local. It depends on SQLx, Redis, IO, metrics, leader election, and projection concerns. |
| `config` | Environment readers for database, Redis, blockchain, server config. | Service-local. These are runtime policy, not library primitives. |
| `locking` | PostgreSQL advisory lock helpers and `LockableEvent`. | Private/service-local. It depends on SQLx transactions and database locking policy. |
| `graph_flags` | Cached env feature flags for SurrealDB/Postgres migration. | Private/service-local. It is deployment transition logic. |
| `test_utils`, `proptest_invariants` | Test factories and property suites. | Keep private; move reusable fixtures later only if external tests need them. |

`crates/rindexer-ingestion` does not currently depend on `shared`; it owns its
storage/event code. The first migration therefore targets `projections`, then
optionally converges ingestion after the public contracts are stable.

## Proposed Public Crates

### `intuition-core-primitives`

Stable, dependency-light scalar contracts:

- `BlockNumber`, `LogIndex`, `SequenceNumber`
- `TermId`, `EntityId`, transaction/block hash aliases or newtypes
- `EventType`
- `UnknownEventType`

Dependencies should be limited to `serde` and, only if needed, small no-runtime
helpers. Do not include SQLx, Redis, Tokio, tracing, dotenv, or database pools.

Semver rules:

- Mark externally matched enums `#[non_exhaustive]` unless every future variant
  is intended to be a breaking change.
- Keep canonical string parsing strict and case-sensitive.
- Keep `EventType::as_str()` as the single source of truth for wire names.
- Prefer newtypes before publication if aliases need validation or display
  guarantees; otherwise document aliases as convenience only.

### `intuition-core-events`

Event-store envelope and typed MultiVault payload contracts:

- `StoredEvent`
- `NewEvent`, if external ingestion tools should construct event-store writes
- `EventMetadata`, `EventMetadataRef`
- typed payload records:
  - `AtomCreatedRecord`
  - `TripleCreatedRecord`
  - `DepositedRecord`
  - `RedeemedRecord`
  - `SharePriceChangedRecord`
  - `ProtocolFeeAccruedRecord`
- `ParsedEvent`
- `ParseError`

This crate can depend on `intuition-core-primitives`, `chrono`, `serde`,
`serde_json`, `thiserror`, and `bigdecimal`. Keep SQLx derives out of the public
crate unless there is a deliberate `sqlx` feature, because SQLx ties the crate
to database column contracts and a heavier dependency graph.

Semver rules:

- Mark `ParsedEvent` `#[non_exhaustive]` so new protocol events can be added
  without forcing downstream exhaustive matches to break unexpectedly.
- Mark typed payload structs `#[non_exhaustive]` if adding optional decoded
  fields should be non-breaking.
- Preserve `ParsedEvent::Unknown(StoredEvent)` as the forward-compatibility
  escape hatch.
- Preserve parse behavior: unknown event type is not an error; known event type
  with malformed payload returns `ParseError` or `Unknown` through
  `parse_or_unknown`.

### `intuition-core-projection-types`

Optional later crate for read-model DTOs if external consumers need typed
Timescale rows:

- `Vault`
- `Position`
- `SharePriceHistory`
- stable output DTOs for leaderboard/protocol/term aggregates

Do not publish this in the first split. These types are closer to database and
API evolution than protocol event contracts, so they need a separate schema
compatibility review.

## What Stays Unpublished

Keep these source-only inside the services or move them to an internal
`crates/service-support` crate that is not published:

- `IndexerError` and retry classification: service supervision policy differs
  between ingestion, projections, and future services.
- `DatabaseConfig`, `RedisConfig`, `BlockchainConfig`, `ServerConfig`, and
  env helpers: runtime configuration is deployment policy.
- PostgreSQL advisory lock helpers: they depend on SQLx transactions and table
  locking strategy.
- `graph_flags`: migration/deployment transition logic.
- projection checkpoints, ingestion state, reorg rows, and database read-model
  rows until a public schema compatibility policy exists.
- test-only factories and property suites, except for a future fixtures crate
  if downstream integrators request it.

This keeps the public Rust API limited to protocol/event contracts that external
indexers can reasonably depend on.

## Migration Plan

1. Add `crates/primitives` with package name `intuition-core-primitives`.
   Move the stable scalar aliases and `EventType` there.
2. Add `crates/events` with package name `intuition-core-events`.
   Move event envelopes, typed payload records, `ParsedEvent`, metadata, and
   parse errors there.
3. Turn `crates/shared` into a compatibility crate inside the workspace:
   re-export public items from the new crates and keep service-local modules
   (`errors`, `config`, `locking`, `graph_flags`) in place.
4. Update `crates/projections` imports gradually:
   - `shared::types::EventType` -> `intuition_core_primitives::EventType`
   - `shared::models::*Record` and `StoredEvent` ->
     `intuition_core_events::*`
   - `shared::parsed_event::*` -> `intuition_core_events::*`
5. Keep `crates/rindexer-ingestion` independent for the first pass. Converge it
   only after the event-store write path can use the public event envelope
   without importing projection-only or database-only concepts.
6. Remove the public re-exports from `shared` after all internal consumers have
   migrated and one compatibility release cycle has passed.

## Package Metadata

Use the same workspace license and author metadata as `intuition-curves`.
Before any publish:

- package names are final and checked on crates.io
- README and crate docs explain stable vs. private surfaces
- `cargo package -p <crate> --list` contains no internal planning files
- `cargo publish -p <crate> --dry-run` passes
- `cargo doc -p <crate> --no-deps` passes without new broken links
- gitleaks scans the release commit and full published history

## Follow-Up Implementation Tickets

1. Create `intuition-core-primitives` and move scalar/event primitive contracts.
   Acceptance: projections compiles through `shared` compatibility re-exports,
   and `cargo publish -p intuition-core-primitives --dry-run` passes.
2. Create `intuition-core-events` and move event envelopes, typed records, and
   parsed-event logic.
   Acceptance: projections tests pass with imports still compatible, parse
   behavior unchanged, and package dry-run passes.
3. Migrate `projections` imports from `shared` to the new crates.
   Acceptance: no direct imports of public event/type contracts from `shared`
   remain, and full Rust CI passes.
4. Make `shared` service-local.
   Acceptance: `shared` contains only config/error/locking/feature-flag support
   or is renamed to an unpublished service-support crate.
5. Evaluate `rindexer-ingestion` convergence.
   Acceptance: written decision on whether ingestion uses `intuition-core-events`
   for event-store writes or remains intentionally independent.
6. Decide whether read-model DTOs deserve `intuition-core-projection-types`.
   Acceptance: schema compatibility policy exists before any publish attempt.

## Non-Goals

- Do not publish `projections` as a crate. It is a runtime service distributed
  as a container image.
- Do not expose Redis, SQLx pool, advisory lock, or env-loading helpers as
  public library APIs.
- Do not force `rindexer-ingestion` to depend on the new crates until the write
  path has a clear compatibility benefit.
