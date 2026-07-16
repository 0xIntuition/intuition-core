# Intuition v2 Migration Map

This map tracks duplicated `intuition-v2` backend artifacts that can be replaced
by public Intuition Core crates or images.

Production cut-over is **not** approved by this document. Any production
replacement of v2 backend services or images requires a separate D2/platform
decision with owner sign-off, rollback owner, and environment-specific release
window. This map only identifies safe order, blockers, and validation evidence.

## Target States

- **Consume now**: safe to replace in v2 once the referenced public artifact is
  released, because the API surface is already parity-focused and rollback is
  local.
- **Consume after RC**: safe only after GHCR release-candidate smoke runs prove
  image, schema, and runtime compatibility in dev/staging.
- **Keep private**: v2 artifact has app-specific dependencies or private
  product behavior that Core should not publish or replace.
- **Defer**: public boundary is not stable enough, or the artifact still needs a
  split/design ticket before v2 consumption.

## Migration Matrix

| Artifact | Current v2 source | Core public source | Target state | Blocker | Validation |
| --- | --- | --- | --- | --- | --- |
| Bonding curve Rust crate | `intuition-v2/backend/curves` | `intuition-core/crates/curves` as crate `intuition-curves` with Rust library name `curves` | Consume now | ENG-13598 publishes and verifies the crate on crates.io | Replace the v2 path dependency with the published `intuition-curves` package, keep `use curves::...` imports, prove `projections` resolves the published package with `cargo tree`, then run the projection consumer tests and any parity fixtures moved to a consumer-owned test path. |
| Indexing shared Rust crate | `intuition-v2/backend/indexing-services/crates/shared` | `intuition-core/crates/shared` | Defer | No public crate boundary yet; crate is currently a workspace-private support crate for images | If later published, compare typed event models and error classification with v2, then run v2 indexing-services workspace tests and projection smoke. |
| Rindexer ingestion Rust service | `intuition-v2/backend/indexing-services/crates/rindexer-ingestion` | `intuition-core/crates/rindexer-ingestion`; image `ghcr.io/0xintuition/intuition-core-rindexer-ingestion` | Consume after RC for dev/staging only | ENG-13599/ENG-13600/ENG-13602 image flow must land; v2 generated ABI/rindexer artifacts differ; production cut-over requires D2/platform decision | Run `make smoke-index-published IMAGE_TAG=<rc>` in Core, then v2 dev/staging bounded window with the image digest pinned. Validate event count, canonical event range, `projection_checkpoints`, and API-visible indexed atoms. |
| Projections Rust service | `intuition-v2/backend/indexing-services/crates/projections` | `intuition-core/crates/projections`; image `ghcr.io/0xintuition/intuition-core-projections` | Consume after RC for dev/staging only | Core intentionally disables some product analytics/dual-write defaults; v2 production uses private Surreal/product behavior; production cut-over requires D2/platform decision | Run Core published indexing smoke, then v2 dev/staging with digest-pinned image. Validate `core_entities`, market read models needed by v2, checkpoint advancement, dead-letter counts, and rollback to v2 source-built image. |
| Timescale migration SQL | `intuition-v2/backend/indexing-services/migrations` | `intuition-core/migrations/timescale`; image `ghcr.io/0xintuition/intuition-core-timescale-migrations` | Consume after RC for dev/staging only | Six migration files differ from v2; migration ownership and production rollback require D2/platform decision | Diff migration plans before use. In dev/staging, run the published migration image against disposable DB snapshots, then run v2 API/indexing smoke and schema verification. Never run directly against production without D2 approval. |
| Generated MultiVault ABI and rindexer output | `intuition-v2/backend/indexing-services/crates/rindexer-ingestion/abi` and `src/rindexer_lib` | `intuition-core/crates/rindexer-ingestion/abi` and generated `src/rindexer_lib` | Defer | Core and v2 generated artifacts differ; source of truth must stay tied to the contracts package/ABI sync process | Use `bun run abis:check` in Core, then compare v2 generated event types before image consumption. Do not hand-copy generated files from Core into v2. |
| API service image | `intuition-v2/backend/api/Dockerfile` | `intuition-core/docker/Dockerfile.api`; image `ghcr.io/0xintuition/intuition-core-api` | Keep private | v2 API app depends on auth, storage, protocol, SDK, tRPC, Surreal, and product routes not present in Core public API | Keep v2 API source-built. Use Core API only as a public-node/reference API, not a replacement for v2 application API. |
| Workers image | `intuition-v2/backend/workers/Dockerfile` | `intuition-core/docker/Dockerfile.workers`; image `ghcr.io/0xintuition/intuition-core-workers` | Defer | v2 workers depend on private `@0xintuition/classifications` and `database-surreal`; Core workers are minimal KG workers | First split private worker behavior from public KG processing. Validate parse/classify/enrich state transitions, Surreal writes, and provider-key behavior before considering image consumption. |
| Atom services image | `intuition-v2/backend/atom-services/Dockerfile` | `intuition-core/docker/Dockerfile.atom-services`; image `ghcr.io/0xintuition/intuition-core-atom-services` | Consume after RC for dev/staging only | Package contracts match, but v2 plugin data may rely on workspace-private classification packages | Run Core atom-services image smoke against v2 inputs with no provider keys and with provider keys. Validate `/health`, `/v1/classify`, `/v1/enrich`, `/v1/process`, cache fallback, and auth-token behavior. |
| Atom parser TS package | `intuition-v2/packages/atom-parser` | `intuition-core/packages/atom-parser` | Defer | Package is still private in both repos; no published package boundary | Keep duplicated until package publication plan exists. Validate with v2 parser parity fixtures before replacing. |
| Atom classification TS package | `intuition-v2/packages/atom-classification` | `intuition-core/packages/atom-classification` | Defer | Package is private; v2 also owns public `@0xintuition/classifications` | Split public classification contract from private/product taxonomies before replacement. Validate runtime capability matrix and v2 classification contract tests. |
| Atom enrichment TS package | `intuition-v2/packages/atom-enrichment` | `intuition-core/packages/atom-enrichment` | Defer | Core currently consumes `@0xintuition/classifications` as a published alpha; v2 uses workspace copy; package remains private | Do not replace until classification dependency direction is settled. Validate provider fixtures, keyless behavior, and cache compatibility. |
| Atom rules engine TS package | `intuition-v2/packages/atom-rules-engine` | `intuition-core/packages/atom-rules-engine` | Defer | Private package with UI/card-selection semantics still coupled to app behavior | Keep workspace-private until public item-card contract is stable. Validate persisted artifact fixtures and v2 UI consumers before replacement. |
| Database KG TS package | `intuition-v2/packages/database-kg` | `intuition-core/packages/database-kg` | Keep private | v2 package depends on private ids/predicates/stacks and has app-specific schema surface; Core KG is public-node minimal | Do not replace. Share only schema lessons or explicit migrations after review. |
| Database Timescale TS package | `intuition-v2/packages/database-timescale` | `intuition-core/packages/database-timescale` | Defer | Package is private; generated schema/migration compatibility needs a versioned contract | Use migration/schema verification outputs as comparison evidence. Do not consume until schema generation has a published compatibility contract. |
| Contracts/ABI TS package | `intuition-v2/intuition/protocol` and related protocol packages | `intuition-core/packages/contracts` wrapping `@0xintuition/contracts-v2` | Defer | v2 protocol packages are the broader public SDK/protocol surface; Core package is an internal ABI/address adapter | Keep v2 protocol packages as source of truth for app SDK. Core should continue consuming pinned `@0xintuition/contracts-v2`. |
| Recommendation and embedding services | `intuition-v2/backend/recommendation-service`, `crates/embeddings-job`, `crates/embed-on-create` | Not in Core minimal workspace | Keep private | Search/recommendation tier is intentionally outside Core minimal distribution | Keep private until a dedicated Search tier open-source decision exists. |
| Atom parser service | `intuition-v2/backend/atom-parser-service` | No Core service equivalent; Core has TS package `packages/atom-parser` | Keep private | Rust service boundary is v2-specific and not represented by a Core public artifact | Keep private or replace internally with TS package only after v2 service deprecation plan. |

## First Safe Cut-Over

The first cut-over should be `intuition-v2/backend/curves` to the published
`intuition-curves` crate.

Why this is first:

- Source checksum comparison shows the Rust source and tests are already
  equivalent between v2 and Core; only `Cargo.toml`, `README.md`, and v2's local
  `Cargo.lock` differ.
- Core keeps the Rust library name as `curves`, so existing imports should not
  need code changes.
- Rollback is a one-line dependency revert to the v2 path dependency.
- The validation surface is bounded to curve parity tests and projection crate
  consumers.

Cut-over recipe after crates.io publication:

```toml
curves = { package = "intuition-curves", version = "<released-version>" }
```

Required validation:

```bash
cd intuition-v2/backend
cargo update -p intuition-curves --precise <released-version>
cargo tree -p projections | rg "intuition-curves v<released-version>"
cargo test -p projections
```

Do not use `cargo test -p curves` as cut-over evidence if the old local v2 crate
still exists in the workspace; that tests the workspace package, not necessarily
the published package. If v2-only parity fixtures remain under the old local
crate, move them to a consumer-owned test path or verify them in Core before
removing the path dependency.

If the lockfile or crate name resolution pulls an unexpected version, revert the
dependency change and pin the exact published version in a follow-up PR.

## Dev/Staging Image Candidates

The first image candidates are `rindexer-ingestion` and `projections`, with
`timescale-migrations` as a supporting one-shot image. They should be used only
with digest pins copied from the Core publish workflow summary.

Minimum gate before v2 dev/staging consumption:

1. Core PRs for image publishing, artifact verification, and published Compose
   mode are merged.
2. A release-candidate tag is published and verified in GHCR.
3. Core `make smoke-index-published IMAGE_TAG=<rc>` passes.
4. v2 dev/staging runs a bounded public testnet window with the exact digest
   refs for `rindexer-ingestion`, `projections`, and migrations.
5. v2 validates event counts, canonical range, projection checkpoints,
   `core_entities` atom/triple catch-up, API stats, and rollback to source-built
   images.

Production image consumption remains out of scope and requires D2/platform
approval.

## Rollback Requirements

- Crate rollback: restore the v2 path dependency and lockfile, then rerun the
  same test set used for cut-over.
- Image rollback: switch Compose/Kubernetes/image configuration back to v2
  source-built images or the prior v2 digest. Do not roll back database
  migrations by image replacement alone.
- Migration rollback: use disposable snapshots for dev/staging validation.
  Production migration rollback must be a separate database runbook approved by
  D2/platform.
- ABI rollback: regenerate from the owning contracts package instead of
  hand-editing generated rindexer output.

## Evidence Collected

- v2 `backend/curves` and Core `crates/curves`: 17 of 19 common files identical;
  the differences are packaging/docs (`Cargo.toml`, `README.md`), and v2 has a
  local `Cargo.lock`.
- v2 `backend/indexing-services/crates/shared` and Core `crates/shared`: all 11
  common files identical.
- v2 Timescale migrations and Core `migrations/timescale`: same file set; 43
  identical files and 6 differing files.
- v2 rindexer ABI/generated output and Core rindexer ABI/generated output:
  `MultiVault.json` and generated rindexer files differ, so these must be
  validated through the ABI sync/generation flow rather than copied manually.
- v2 and Core service Dockerfiles differ materially because Core images are
  repo-root builds with public OCI labels and hardened published-image paths.
