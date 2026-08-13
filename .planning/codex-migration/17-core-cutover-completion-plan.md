# Intuition Core cutover completion plan

Status: authoritative remaining-work plan; execution update appended 2026-08-12

Prepared: 2026-08-11

Original constraint (2026-08-11): complete useful local work without Docker. Docker was explicitly authorized and started on 2026-08-12; the execution ledger below supersedes deferred-environment statements where evidence now exists.

## Execution update — 2026-08-12

The implementation is substantially beyond the 2026-08-11 baseline in this document. Do not use the older R1-R7 descriptions as current code-state claims; retain them as the rationale for the PR stack.

| Cutover capability | Current evidence | Remaining release action |
| --- | --- | --- |
| URI-aware contract API | Local v1.1 deployment passed `getAtomUriConfig`, `createAtomsWithUris`, predicted term ID, and joined creation/context events | Split/review the mixed Core diff and packages P06-P07 diff |
| Canonical fixtures | `int:isrc:USUM71703861` and `int:isbn:9780684832722` were created idempotently, indexed, projected, resolved, and read through the API | Preserve as the release/CI golden path |
| URI ingestion/projection | Raw/typed Rindexer storage and exact-term-ID KG projection passed applied chain replay and checkpoint/dependency-order verification | Serialize and archive the same evidence in CI |
| IID recognition/classification | Package-neutral inspection/registry adapters, persistence, fallback taxonomy, and fail-closed worker behavior are implemented | Publish and age-gate exact public packages, then wire the composition root |
| IID provider resolution | Total provider capability adapter, MusicBrainz ISRC, OpenLibrary ISBN/OLID, identifier-to-plugin bridge, retry taxonomy, and resolved projection are implemented | Live worker activation awaits eligible package dependencies |
| API/Explorer | Ordered context reads and exact IID clusters passed live API/database/query-plan verification; safe Explorer views build and test | Browser smoke and production-sized load evidence |
| Reconciliation | Bounded `kg-reconcile-iid` dry-run/apply CLI is implemented and passed against the live fixture database | Production report-only run, approval, bounded apply, and convergence report |
| Public packages | P00-P07 are integrated locally; frozen install, exception policy tests, artifact parity, all workspace tests/typechecks/checks/builds, generated drift checks, pack dry-run, and Node/Bun clean-room tarball smoke are green | Split/review/commit P06-P07 and release work, restore NPM credentials, publish with approval, record integrity, and qualify the exact Core runtime dependencies |

The only hard production activation dependency is now the public package release gate. Core intentionally does not commit `file:`, tarball, Git, arbitrary-module-loader, or workspace dependencies to bypass its 14-day supply-chain policy. Local acceptance loads built sibling public exports only inside a test harness; production worker composition remains fail-closed until the exact releases are eligible.

### Applied end-to-end evidence — 2026-08-12

The local acceptance loop has now crossed every Core-owned durable boundary:

```text
createAtomsWithUris on Anvil
  -> AtomCreated + AtomContextRegistered joined by termId
  -> Rindexer raw + typed Timescale rows
  -> core_entities exact-ID KG node
  -> atom_context:dual ordered byte-preserving KG context
  -> semantic atom detail + exact-IID cluster API
```

| Gate | Result |
| --- | --- |
| Contract deployment | v1.1 MultiVault deployed on chain 31337; URI config read as 5 values x 700 bytes |
| Canonical writer fixture | `int:isrc:USUM71703861` and `int:isbn:9780684832722` simulated, created, event-joined by term ID, then returned `already-created` on replay |
| Identifier invariance | Each term ID was derived from IID bytes only; URI values were independently verified from context events |
| Typed ingestion | Rindexer indexed blocks 26-34 and persisted 3 context events, including the canonical fixtures at typed sequences 291 and 292 |
| Indexer container | The pinned, lockfile-enforced Linux/arm64 image built successfully and replayed blocks 26-34 in Docker, exiting 0; the second replay retained 3/3 unique context events |
| Dependency ordering | `atom_context:dual` pinned at sequence 283 while its exact node was missing; after `core_entities` advanced through sequence 286, context projection advanced through 292 |
| Context projection | KG contains the exact chain transaction hashes/log index 8 and byte-preserving URI hex for both fixtures; no adjacency assumption was used |
| Live resolution | MusicBrainz resolved the ISRC to “Cut to the Feeling”; OpenLibrary resolved the ISBN to “The Sovereign Individual” / `OL7721520M` |
| Failure taxonomy | A MusicBrainz HTTP 503 and an OpenLibrary timeout were retryable; subsequent attempts succeeded |
| API read | Both atom details return separate identity, classification, resolution, display, and ordered on-chain context; exact IID cluster lookup returns only the matching atom |
| Query plan | `idx_nodes_iid` and `idx_node_contexts_node_sequence` were selected; warm executions were 0.038 ms and 0.086 ms respectively in the fixture database |
| Reconciliation | `kg-reconcile-iid` dry-run found the two canonical candidates with bounded pagination and emitted explicit parser/registry/resolver provenance |

The developer-machine acceptance intentionally ran the already-built native projection binary after Docker Desktop terminated two simultaneous cold Rust image builds under memory pressure. The Dockerfiles now pin the Rust builder and Linux runtime, copy `Cargo.lock`, use `--locked`, and no longer swallow dependency-build failures. A serialized indexer image build/replay passed. The projection binary passed the applied E2E path and 546 unit tests; its final container build should remain a required CI artifact gate.

### Remaining work to declare production cutover

These are release and operations gates, not missing Core feature design:

1. Split the mixed Core worktree into C01-C14 review units and land them in dependency order.
2. Review and land packages P06-P07, finish the public conformance/release PRs, restore NPM organization credentials (current preflight returns `E401`), publish exact versions with provenance/integrity, and start the 14-day eligibility clock.
3. After package eligibility, add exact public IID package dependencies at the worker composition root, freeze the install, and rerun the same acceptance without the test-only sibling-package harness.
4. Run the production-sized historical reconciliation in report-only mode, record counts/error taxonomy, then apply in bounded resumable batches.
5. Execute the reader-first canary: IID recognition -> semantic reads -> ISRC resolution -> ISBN resolution -> external IID-default writers.
6. Record production query/load budgets, provider rate behavior, rollback rehearsal, and release-owner approval in the evidence ledger.

No production flag should be enabled globally before step 3. The correct interim posture is additive readers deployed, flags off, durable URI evidence retained, and legacy reads/writes available.

Package release note: leadership approved a narrowly scoped release-age
exception for `@0xintuition/contracts-v2@1.1.0-alpha.0`. The packages worktree
now records its exact version, registry SHA-512 integrity, publication time,
and automatic removal time in `supply-chain-exceptions.json`. Bun can exempt
only by package name, so the repository guard binds the exception back to the
exact manifest version and lockfile integrity, rejects additional exclusions,
and fails after the normal 14-day age is reached on
`2026-08-18T19:56:37.884Z`. Frozen installation and
`protocol:check-artifacts` now pass. This resolves the P06 artifact-generation
gate; it does not authorize release-age exceptions for Core's unpublished IID
runtime packages.

The package release rehearsal subsequently passed the full workspace and
clean-room tarball matrix. Registry preflight found one versioning defect before
release: React's exact dependency moved to `protocol@3.1.0`, so the candidate
was correctly advanced from the already-published
`@0xintuition/react@0.1.0-alpha.0` to the unpublished `0.1.0-alpha.1`. The exact
IID, classifications, primitives, protocol, and React candidate versions remain
unpublished; no registry mutation was performed.

After the corrected React version and final package rebuild, Core reran the
sibling-package acceptance boundary: canonical ISRC/ISBN semantic enrichment,
cross-stack semantic identity persistence, and exact public runtime manifest
binding passed 6/6. This is valid pre-publication consumer evidence, while the
production composition root remains correctly blocked on eligible NPM
artifacts.

### Docker shutdown checkpoint — 2026-08-12

The Intuition Core Compose services and the profile-managed Anvil container
were stopped, then Docker Desktop was quit to release developer-machine
resources. Containers, named database volumes, and the persisted Anvil state
were not removed. Docker-free Core tests, typechecks, checks, the supply-chain
guard, and diff validation passed after shutdown. Package policy tests and
frozen installation also remain green. Continue package review, PR separation,
documentation, and static consumer integration with Docker off; restart it
only for the final clean migration/replay/container-image gate.

## Executive verdict

Intuition Core is **not fully switched yet**. The current branch contains most of the additive foundation for contract URI context and IID-aware read models, but the identifier-first runtime path is still deliberately dark.

The remaining critical path is:

```text
publish/qualify public IID packages
              |
              v
IID inspection -> registry classification -> identifier/provider enrichment
              |                    |
              v                    v
       identity persistence   resolved display/search
              \                    /
               +-> API/explorer <-+-- ordered URI context
                            |
                            v
                  backfill, canary, cutover
```

The URI event ingestion path and the identifier/enrichment path are independent until the read model. They should continue in parallel. URI values are evidence attached to a term; they do not participate in atom ID calculation and are not an initial source of automated network fetches.

## What “fully switched” means

The first production cutover is complete when all of the following are true:

1. A canonical IID such as `int:isrc:USUM71703861` is recognized before the legacy string fallback and persisted with its exact public-package provenance.
2. Its classification comes from `@0xintuition/iid-registry`, not a duplicate Core scheme map.
3. Its provider targets and identifier hints drive the existing enrichment engine without requiring a source URL or JSON-LD object.
4. Raw provider artifacts remain distinct from the resolved display/search projection.
5. `AtomContextRegistered` values are joined by `termId`, persisted in ordinal order, and exposed safely on the atom detail read path.
6. API and Explorer show raw identity, classification, resolution status, display data, and URI context as distinct concepts.
7. Existing `int:` rows can be reprocessed through the same code path, and replay/reconciliation is idempotent.
8. One golden IID fixture passes builder -> hash -> protocol calldata/event -> ingestion -> resolution -> API/Explorer checks, while legacy JSON, URL, IPFS, and string fixtures remain compatible.
9. Reader and resolver switches can be enabled separately and rolled back without deleting durable evidence.

This does **not** require removing legacy readers or writers. Legacy compatibility exits only after usage telemetry reaches zero.

## Reconciled state on 2026-08-11

### Foundation present in the current Core worktree

| Capability | State | Remaining action |
| --- | --- | --- |
| URI-enabled contract artifact and development deployment configuration | Implemented, unlanded | Split and review as C01. |
| Raw and typed `AtomContextRegistered` ingestion | Implemented, unlanded | Split and review as C02-C03; exercise against a database later. |
| Replay-safe `kg.node_contexts` projection joined by `termId` | Implemented, unlanded | Split and review as C04; expose it through API reads in C11. |
| IID database runway (`raw_type='iid'`, nullable `nodes.iid`) | Implemented, unlanded | Use it from C08; no new identity table is required for the first cutover. |
| Package-neutral identity/classification/provider DTOs | Implemented, unlanded | Wire public package adapters in C08-C10. |
| Strict IID read/resolution configuration flags | Implemented, unlanded | The flags are parsed but do not yet alter worker behavior. |
| API/Explorer semantic response envelope | Implemented, default off, unlanded | Supply real context/identity data in C11 and canary the flags in C14. |
| Public `@0xintuition/ids` hash wrappers and known-answer tests | Implemented, unlanded | Land as C07. |
| Parser generic URL safety and enrichment completion semantics | Implemented, unlanded | Land as C05 and retain legacy regression coverage. |

These changes are currently a large mixed worktree. They are implementation progress, not release evidence, until separated into reviewable PRs and merged.

### Public package train

The local `packages` integration branch `update/v1.1.0-alpha` is clean at `6a484dc` and contains P00-P05. In particular, P05 is now integrated and `buildIidAnchor` is available from source. P06-P07, the contract artifact/provenance sync and direct MultiVault URI APIs, remain unimplemented. P10-P12 conformance, documentation, and publication also remain.

At the audit time, the new IID packages, `@0xintuition/primitives@0.1.0-alpha.1`, and `@0xintuition/protocol@3.1.0` were not published on NPM. Core's normal dependency policy requires a 14-day release age. Draft integration may use packed tarballs in a disposable clean worktree, but committed Core dependencies must not use a tarball, `file:`, Git, or workspace reference.

Recommendation: publish the package train as early as possible and do not create additional release-age exceptions. If product leadership elects to override that policy, record a separate explicit supply-chain decision; urgency alone is not an implicit exception.

## Confirmed remaining gaps

### R1 — IID recognition is not connected

`WORKERS_IID_READ_ENABLED` is loaded and tested but unused by the parser worker. The worker still sends every atom through the legacy parser, so a valid P0 IID is stored and processed as a plain string.

Required result: a thin adapter calls `inspectIntuitionId`, maps the public result to Core's `NormalizedAtomIdentity`, persists canonical IID/provenance, and falls back to legacy parsing for malformed, unknown, and noncanonical historical inputs. It must split only the first two colons and must never silently repair a new write.

### R2 — Classification still follows JSON/URL inference

Core does not import the public registry. An IID classification therefore cannot be inferred from its registered scheme/profile, and the dark `identityDecision`/`providerPlan` fields are never populated.

Required result: use public registry results directly, distinguish polymorphic from ratified-but-unmapped outcomes, and preserve unknown state without guessing. Do not copy classification or scheme tables into Core.

### R3 — Identifier-first enrichment cannot run

The current enrichment handoff requires a URL or a structured object. For an IID-only atom, `buildClassifiedInputFromPlan` returns `null`. Public provider targets and identifier hints are not translated into the existing plugin engine.

Required result: adapt the ordered public provider plan into Core plugin requests, pass exact identifier hints, retain existing retryable/terminal semantics, and project resolved fields only from successful artifacts.

There is one known coverage mismatch: the public registry emits `openlibrary` for ISBN/OLID, while Core has no `openlibrary` plugin. C10 must either add that plugin or explicitly mark those provider plans unsupported. Silent dropping is forbidden. A contract test must compare every `PROVIDER_SLUGS` value with a Core adapter capability.

### R4 — Stored URI context is not served

`kg.node_contexts` exists and the presentation type supports context, but API list/detail queries never load that table. As a result, Explorer cannot receive the stored values.

Required result: add an ordered context reader and include it in atom detail responses. Keep list endpoints bounded: expose a context count or omit context on lists unless a batch query is explicitly requested. Render only allowlisted HTTP(S) links as clickable; preserve opaque bytes/raw values as non-clickable evidence.

### R5 — Identity cluster reads and reprocessing are absent

There is no exact-IID query path and no bounded job to reprocess historical `int:` rows after the adapter or registry version changes.

Required result: use the indexed `nodes.iid` column for exact same-IID cluster reads, add resumable parser/classifier/resolver reconciliation jobs, and persist checkpoint/version evidence. Do not add a separate identity table or indexed scheme column until a concrete query/SLO requires it.

### R6 — Public protocol and writer conformance is incomplete

Core's vendored contract surface is URI-aware, but the public `protocol` package is not. Core also does not own a production on-chain atom writer; `POST /api/atoms` inserts an off-chain KG row with a protocol-compatible content ID and does not submit a transaction.

Required result: after packages P06-P07, prove ABI selector, calldata, receipt event, term ID, and URI ordering parity. Document `POST /api/atoms` as an ingestion endpoint, not a mint endpoint. Production seed/application writers remain owned by their respective repositories and must consume the public builder/protocol APIs.

### R7 — Operational proof remains

The repository has unit/static evidence, but no applied migration, real event replay, live provider resolution, devnet mint, or query-load evidence for this change set. Those checks require a database or chain environment and are intentionally deferred while Docker is off.

## Core PR stack

The first seven PRs extract the existing mixed worktree into reviewable foundations. C08-C14 finish the behavior. Each PR should target the migration branch in the listed dependency order; use stacked branches where needed and rebase after its parent merges.

### Foundation PRs already represented in the worktree

| PR | Recommended title | Scope | Depends on | Docker-free merge gate |
| --- | --- | --- | --- | --- |
| C01 | `chore(contracts): sync URI-enabled protocol artifacts` | Exact contracts dependency, vendored ABI/provenance, config, development deployment acceptance, docs | none | ABI/artifact checks, package tests, shell checks |
| C02 | `feat(indexer): ingest atom context events` | Rindexer ABI/bindings/config, raw event storage, handler metrics | C01 | Rust unit tests, formatting, clippy, schema generation diff |
| C03 | `feat(shared): add typed atom context event reads` | Timescale migration/schema, shared event model, typed reader | C02 | Rust/TypeScript schema tests and typed-reader fixtures |
| C04 | `feat(projections): persist IID and atom context read models` | KG IID runway, `node_contexts`, replay-safe projection by `termId` | C03 | migration snapshot tests, projection unit tests, replay fixture twice in memory |
| C05 | `refactor(workers): prepare identifier-first processing contracts` | URL safety, Core DTOs, strict flags, structured target handling, enrichment completion taxonomy | none | scoped worker/parser tests and typecheck |
| C06 | `feat(readers): add gated semantic atom presentation` | API/Explorer envelope, safe URI presentation helpers, golden presentation fixture | C04-C05 | API/Explorer unit tests, legacy response snapshots, typecheck |
| C07 | `refactor(ids): use public protocol ID helpers` | Thin `@0xintuition/ids` wrappers and exact known answers | none | hash/ID parity tests and dependency policy check |

Do not fold C01-C07 back into one PR. The current diff crosses contract, Rust ingestion, projection, database, workers, API, and UI trust boundaries and needs separate rollback points.

### Behavioral completion PRs

| PR | Recommended title | Scope | Depends on | Docker-free merge gate | Deferred environment gate |
| --- | --- | --- | --- | --- | --- |
| C08 | `feat(workers): recognize canonical Intuition Identifiers` | `inspectIntuitionId` adapter, flag wiring, persistence, invalid/fallback taxonomy | C04-C05; packages P01-P02 | public-entrypoint tarball consumer, full IID conformance corpus, legacy parser regression | applied migration and live queued atom |
| C09 | `feat(workers): classify IIDs through the public registry` | classification adapter, source/version evidence, ambiguous/unmapped handling | C08; packages P03-P04 | registry fixtures and no-local-map code-search test | live classification queue/replay |
| C10 | `feat(enrichment): execute IID provider plans` | identifier hints, ordered provider adapter, OpenLibrary decision/plugin, artifact projection | C09; package P04 | mocked provider tests, provider-slug coverage, retry taxonomy, ISRC golden fixture | credentialed provider canary and retry observation |
| C11 | `feat(api): serve IID clusters and atom context` | ordered context action/query, atom detail join, exact IID cluster route/filter, Explorer detail | C04-C06 | database query-shape tests, presenter/UI tests, safe-link tests | real query plan and load test |
| C12 | `feat(operations): reconcile IID identity and resolution` | resumable reprocessing CLI/job, checkpoints, registry/resolver version selection, bounded metrics | C08-C11 | dry-run fixtures, restart/idempotency tests, metrics label cardinality test | database backfill/replay convergence |
| C13 | `test(conformance): prove IID URI creation parity` | consume public builder/protocol exports, builder/hash/calldata/event golden path, document API ingest semantics | C07-C10; packages P05-P07/P10 | packed-tarball clean consumer under Node/Bun; no source imports | devnet mint/index/read proof |
| C14 | `chore(release): stage the IID reader cutover` | config/runbook, canary allowlist, dashboards/alerts, rollback, consumer notes | C08-C13; eligible published packages | config tests, lockfile/supply checks, runbook review | migrations, replay, load, provider and devnet acceptance |

## Dependency graph and parallel tracks

```text
Track A — land foundations
C01 -> C02 -> C03 -> C04 -> C06
                    C05 --^       C07 (independent)

Track B — identifier runtime
P01/P02 -> C08 -> P03/P04 -> C09 -> C10

Track C — reader exposure
C04 + C06 -> C11

Track D — operations
C08 + C09 + C10 + C11 -> C12

Track E — public writer parity
P05 + P06/P07 -> C13 -> C14
```

Recommended ownership for a concentrated sprint:

| Owner | Primary responsibility | First deliverable |
| --- | --- | --- |
| Core integration owner | Split/sequence C01-C07, guard shared lockfile and migrations | Clean PR dependency graph and green foundation stack |
| Identity owner | C08-C09 | Canonical IID reaches persisted identity and registry classification |
| Enrichment owner | C10 | ISRC resolution plus provider-slug coverage report |
| Reader/data owner | C11-C12 | Real context detail read, IID cluster read, resumable reconciliation |
| Package/protocol owner | packages P06-P12 and C13 handoff | Packed public protocol API and end-to-end conformance evidence |
| Release owner | C14 and external seed/app coordination | Gate ledger, canary manifest, go/no-go packet |

With four engineers, combine integration/release and reader/operations. Avoid multiple owners editing `bun.lock`, KG migration metadata, or worker orchestration simultaneously.

## What can be completed now without Docker

### Immediate wave: hours 0-4

1. Freeze the current mixed worktree and split C01-C07 without changing behavior.
2. Update the live package board: P05 is integrated; P06-P07 and publication are the package blockers.
3. Build C08-C10 against clean packed package tarballs in disposable consumers/worktrees.
4. Start C11 immediately; it depends on existing Core context persistence, not on package publication.
5. Add the public-provider/Core-plugin coverage test and settle OpenLibrary support.

### Integration wave: hours 4-12

1. Complete IID inspection and registry adapter fixtures.
2. Complete identifier-hint/provider-plan execution with network mocks.
3. Add atom-detail context and exact-IID cluster reads.
4. Build the reconciliation CLI in dry-run mode with deterministic page/checkpoint fixtures.
5. Repack packages after every package merge and rerun clean-consumer tests.

### Closure wave: hours 12-24

1. Land P06-P07, then complete C13 against their packed public exports.
2. Run all TypeScript/Rust unit, type, formatting, clippy, ABI, schema, supply-chain, and shell gates that do not contact Docker.
3. Produce the exact package/version/integrity manifest and release-age calendar.
4. Finalize C14 with reader-first flag order, canary scheme, rollback conditions, and deferred environment commands.
5. Publish the public package prereleases as soon as P10-P12 pass so the 14-day eligibility clock starts.

## No-Docker verification matrix

| Concern | Verify locally now | Verify later in CI/remote environment |
| --- | --- | --- |
| IID grammar/canonicalization | public conformance fixtures, invalid reason mapping, colon-bearing values | live queued atoms |
| Registry/classification | public tarball exports, all known/ambiguous/unmapped fixtures | historical distribution report |
| Provider planning | slug capability contract, mocked HTTP, retry/terminal semantics | credentialed API calls and rate limits |
| URI contract | ABI semantic parity, calldata/event fixtures, ID invariance | devnet transaction and receipts |
| Event ingestion | handler/storage unit tests, raw event fixture | Rindexer against real logs |
| Database | SQL/snapshot/schema tests, query generation | apply migrations, explain plans, constraints, rollback rehearsal |
| Replay/backfill | deterministic in-memory/dry-run twice | real bounded range twice and convergence diff |
| API/Explorer | response contracts, safe URI rendering, legacy snapshots | real database responses, browser smoke, load test |
| Supply chain | clean pack, public entrypoint smoke, exact versions, single lockfile copy | NPM provenance/integrity and release-age eligibility |

No PR should claim the deferred column as complete based only on a mock. C14 owns one evidence ledger with command, environment, commit, package versions, timestamp, and result for every deferred gate.

## Cutover order

Use reader-before-writer rollout:

1. Deploy migrations and URI/IID readers with semantic exposure and IID flags off.
2. Replay context events and run IID recognition/classification backfill in report-only mode.
3. Enable IID recognition for an internal allowlist; keep resolution off.
4. Enable semantic API/Explorer exposure and verify raw identity/context evidence.
5. Enable IID resolution for one unambiguous canary scheme. Recommended canary: ISRC.
6. Verify provider artifacts, display/search projection, same-IID cluster lookup, latency, retries, and rollback.
7. Expand resolver schemes by explicit capability matrix, not all at once.
8. Enable IID-default writes in external seed/application writers only after the complete reader proof.
9. Keep legacy reads and the legacy `createAtoms` contract path throughout the compatibility window.

Rollback is flag-first: disable writers, then resolution, then semantic exposure/recognition as needed. Do not delete identity, URI, event, or provider evidence during rollback.

## Decisions frozen for the first cutover

These defaults minimize the 24-hour critical path. Change them only through an explicit decision record.

- Direct MultiVault URI creation is in scope; FeeProxy URI support is deferred and does not block Core readers.
- React writer changes are not a Core dependency because this repository has no supported production mint UI.
- `POST /api/atoms` remains off-chain KG ingestion and must be documented accordingly.
- Context URIs are stored and displayed safely but are not automatically fetched during the initial cutover.
- `nodes.iid` is the first-cutover identity cluster key; no new identity table is required.
- Exact IID lookup and atom-detail context are required; scheme/status filters are deferred until backed by an indexed query need.
- ISRC is the first resolver canary; wider registry coverage is enabled only when Core has a tested provider capability or an explicit unsupported result.
- No new package release-age exceptions are assumed.

## Final go/no-go checklist

### Code-complete without Docker

- [ ] C01-C07 are split, reviewed, and green.
- [ ] C08 recognizes valid canonical IIDs behind the real worker flag.
- [ ] C09 classifies exclusively through public registry exports.
- [ ] C10 resolves an IID from identifier hints and has total provider-slug accounting.
- [ ] C11 exposes ordered URI context and exact same-IID cluster reads.
- [ ] C12 dry-runs and resumes deterministically without duplicate promotion.
- [ ] C13 passes the packed-package golden path without private/source imports.
- [ ] Legacy parser, classification, enrichment, API, and contract paths remain green.
- [ ] Exact dependency, lockfile uniqueness, integrity, and release-age policy pass.

### Environment acceptance before production

- [ ] Timescale and KG migrations apply cleanly and constraints/indexes are verified.
- [ ] A real `AtomContextRegistered` range replays twice with identical projections.
- [ ] Historical IID backfill and reconciliation converge with a recorded report.
- [ ] A credentialed ISRC resolves within the agreed latency/error budget.
- [ ] Atom detail returns real ordered context; list/cluster queries meet the query budget.
- [ ] A URI-aware devnet mint produces the predicted term ID and indexed read model.
- [ ] Reader, resolver, semantic exposure, and external writer rollback switches are rehearsed.
- [ ] Release owner signs the evidence ledger before IID-default production writes begin.

## Immediate next action

Start C11 and the C08-C10 packed-tarball adapters in parallel while the package owner implements P06-P07. In the same window, split the existing foundation into C01-C07 so none of the behavioral work grows on top of an unreviewable mixed diff.
