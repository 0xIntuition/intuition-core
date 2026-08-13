# 24-hour parallel execution plan

Status: active

Prepared: 2026-08-10

Implementation snapshot: 2026-08-10 13:10 PDT

| Lane | Core state |
| --- | --- |
| A01–A04 URI chain truth | Implemented and focused-test green, including linked devnet artifacts, raw/typed ingestion, `kg.node_contexts`, and the independent `atom_context:dual` replay cursor. |
| B01–B04 semantic runway | Implemented and dark: HTTP(S)-only remote parsing, additive IID storage, package-neutral worker DTOs, and terminal/retryable/partial enrichment semantics. |
| C01–C03 readers/operations | Implemented and default-off: lossless semantic API/Explorer envelope, safe context display, golden cross-stack fixtures, smoke gates, and rollout runbook. |
| J03a public IDs | Implemented with exact, age-eligible `@0xintuition/ids@0.1.0-alpha.0`; duplicate Core hash bodies removed. |
| J01/J02/J03b/J04 | Package-gated as recorded in the live join board; no unpublished/Git/file package dependency has entered Core. |

## Objective

Use the package-development window to make Core ready to consume the new packages as thin adapters. The next 24 hours should not recreate IID semantics locally. They should land the contract event path, additive storage and worker contracts, future-compatible readers, regression fixtures, and rollout controls.

## What is genuinely independent

```text
Lane A — URI chain truth
contracts-v2 -> ABI -> Rindexer -> event store -> typed reader -> KG context

Lane B — Core semantic runway
KG schema -> worker DTOs -> parser safety -> enrichment completion semantics
                                      |
                        public packages plug in here

Lane C — Reader and operations runway
API presenter -> Explorer presenter -> flags/metrics -> golden smoke

External Lane D — public packages
iid-spec -> iid -> classifications -> iid-registry -> primitives
contracts artifact -> protocol -> react

A + B + C + D join at packed-package conformance and the end-to-end fixture.
```

URI ingestion is never feature-flagged after the ABI/migrations deploy. It records chain truth. Flags control semantic interpretation, external resolution, and writers.

## Active wave: hours 0–4

These three PR-sized changes run concurrently and have disjoint ownership.

### Core PR A01 — URI contract artifact readiness

Owner: contract/indexer engineer

Scope:

- pin `@0xintuition/contracts-v2@1.1.0-alpha.0`;
- add `AtomContextRegistered` to Core's critical event list;
- assert `createAtomsWithUris` and `getAtomUriConfig` in the exact ABI;
- regenerate `crates/rindexer-ingestion/abi/MultiVault.json`;
- update contract documentation and provenance;
- keep `createAtoms` supported.

Gate: contract tests, typecheck, `abis:check`, generated diff review.

### Core PR B01 — Parser URL safety

Owner: parser engineer

Scope:

- restrict generic URL recognition and remote inspection to HTTP(S);
- add regression cases for `int:*`, other custom schemes, and colon-bearing strings;
- do not implement IID parsing, canonicalization, or scheme tables.

Gate: atom-parser tests/typecheck; every legacy fixture unchanged.

### Core PR C01 — Future-compatible atom presentation

Owner: API/explorer engineer

Scope:

- add a pure API atom-view presenter with additive `raw`, optional `identity`, `classification`, optional `context`, `resolution`, and `display` sections;
- retain every existing response field;
- add an Explorer presentation adapter that prefers resolved display fields and falls back safely;
- allow only approved URI schemes to render as links; opaque, malformed, `javascript:`, and `data:` values remain escaped text;
- never return an empty context list merely because context ingestion is not deployed.

Gate: API and Explorer unit tests/typechecks; legacy response contract remains compatible.

## Second wave: hours 3–9

Begin as soon as the overlapping first-wave change merges or stabilizes.

### Core PR A02 — Rindexer and canonical context event storage

Depends on: A01

- include `AtomContextRegistered` in Rindexer configuration and generated types;
- add handler conversion preserving URI bytes as ordered `0x` hex strings;
- add Timescale migration 050 extending the event-type constraint;
- add `atom_context_registered_events` with event provenance, numeric/hex term ID, registrant, ordered JSONB URI array, and `sequence_number` from inception;
- dual-write raw and typed rows atomically and idempotently.

Do not UTF-8 decode, normalize, fetch, or validate URI schemes in ingestion. Join by `termId`, never by event adjacency.

### Core PR B02 — IID database runway

Depends on: none; deploy before IID-aware workers

- extend KG `raw_type` with `iid` through an additive migration;
- add nullable, non-unique canonical-cluster `iid` column and partial index;
- allow parse completion to promote `rawType` and `iid` atomically;
- expose the optional field through API projections;
- preserve every legacy row and raw type.

The column permits multiple nodes to share an IID because semantic identity does not merge distinct on-chain atom IDs.

### Core PR B03 — Dark worker contracts

Depends on: B02 schema contract; can be coded in parallel

- define Core-owned persistence/handoff DTOs for normalized identity, classification decision, and provider plan;
- add optional identity/provenance fields to parse, classification, enrichment, and persisted worker payloads;
- add default-off `WORKERS_IID_READ_ENABLED` and `WORKERS_IID_RESOLUTION_ENABLED`;
- maintain backward deserialization compatibility;
- add no grammar, canonicalizer, classification map, or provider routing.

### Core PR C02 — Rollout controls and metrics

Depends on: no semantic packages

- add default-off reader/resolution/writer/scheme flags at the owning service boundaries;
- do not imply Core's current `POST /api/atoms` is an on-chain writer;
- add bounded-cardinality metrics for recognition, registry decision, resolution, display fallback, and context storage/projection;
- never use complete IIDs, URIs, payloads, or secrets as labels;
- document stop/rollback operations.

## Third wave: hours 7–15

### Core PR A03 — Typed event model and reader

Depends on: A02

- add `EventType::AtomContextRegistered` and exhaustive conversions;
- add `AtomContextRegisteredRecord` and `ParsedEvent` variant;
- add typed-reader SQL reconstruction without converting the URI array to a scalar;
- regenerate the TypeScript Timescale layout/manifest;
- prove raw and typed readers return equivalent stored events.

### Core PR A04 — Dedicated context projection

Depends on: A03 and KG migration coordination with B02

- add `kg.node_contexts` ledger with raw bytes canonical and optional safe UTF-8 text;
- create a dedicated `atom_context:dual` projection and checkpoint;
- insert one row per URI with ordinal and immutable event provenance;
- retry a missing node without advancing the checkpoint;
- add `kg.events` entry without changing node data, data hex, or atom ID.

Do not add the event to an already-advanced `core_entities` checkpoint: historical context would be skipped.

### Core PR B04 — Enrichment completion runway

Depends on: coordinate overlap with B02 in `processing.ts`

- complete artifacts and promoted resolved/search fields atomically under the same run guard;
- keep all-retryable provider failure retryable;
- allow partial artifacts with explicit error metadata;
- stop unspecified/opaque input from becoming search text by default;
- leave actual IID projection logic unplugged until public APIs arrive.

### Core PR C03 — Golden fixture and smoke contract

Depends on: API envelope frozen; package outputs can be added incrementally

- add package-neutral fixtures for P0 ISRC, typed MBID, polymorphic Wikidata, invalid/lookalike IID, legacy JSON, URI order/duplicates/unsafe bytes, and resolution states;
- consume presentation cases in API/Explorer immediately;
- add opt-in smoke expectations for IID/context without replacing the stable legacy testnet window;
- verify canonical bytes/hashes against packed public packages as soon as they are available.

## Package join: hours 10–20

Start integration from packed tarballs as individual package PRs stabilize; do not wait for the final NPM publish.

### Join J01 — `iid` into atom-parser

- install the packed public artifact in a clean integration worktree;
- recognize a valid IID before URL/string fallbacks;
- delegate all grammar/canonicalization to the package;
- promote `raw_type = iid` only after successful public validation;
- map public types into the Core DTO;
- run package and Core conformance fixtures together.

### Join J02 — registry into classification and enrichment

- consume `iid-registry` and updated classifications from packed tarballs;
- add deterministic IID-first classification;
- add identifier-first provider plans/hints;
- keep provider clients in Core but all mapping in the public registry;
- assert provider-slug alignment and unknown/polymorphic behavior.

### Join J03 — public `ids`/`protocol` parity

- replace duplicate KG atom/triple hash implementations with thin public `ids` wrappers;
- compare Core's exact contracts ABI with public `protocol` URI ABI;
- run calldata/event fixture parity;
- do not commit `file:` or Git dependencies.

### Join J04 — builder/seed/writer validation

- consume the public primitive builder and protocol helper in a clean seed/writer harness;
- compare predicted atom ID, aligned arrays, URI manifest, and decoded receipt;
- keep production writer flags off until the reader gate passes.

## Final gate: hours 18–24

1. Rebase/merge lanes in dependency order: migrations -> ABI/ingestion -> typed reader -> projections -> semantic adapters -> readers.
2. Run package, TypeScript workspace, Rust workspace, migration, ABI drift, and clean-tarball conformance gates.
3. Run devnet golden transaction with a canonical, valid ISRC—not the invalid illustrative `int:src:*` string.
4. Confirm atom ID is unchanged when URI context changes.
5. Confirm `AtomCreated` and `AtomContextRegistered` associate by `termId` through raw, typed, KG, API, and Explorer layers.
6. Replay ingestion/projections and compare row counts/content.
7. Confirm legacy JSON, URL, IPFS, string atoms and existing `createAtoms` behavior.
8. Deploy readers dark, writers disabled.

## Staffing and collision map

| Engineer | Primary lane | Avoids |
| --- | --- | --- |
| Contract/indexer | A01–A03 | KG schema until A03 handoff |
| Projection/data | A04 + context KG migration | node identity migration files without coordination |
| Parser/worker | B01 + B03 | public semantic implementations |
| KG/backend | B02 + B04 | event Timescale migration |
| API/explorer | C01 + C02 | parser/worker internals |
| Integration/release | C03 + J01–J04 + final gate | feature ownership |

Only one owner at a time edits:

- `packages/database-kg/src/actions/processing.ts` (B02/B04);
- Drizzle journal/snapshot files (B02/A04);
- Rindexer generated code (A02 only);
- root lockfile (A01, then package joins in a clean coordinated update);
- shared `ParsedEvent` exhaustiveness (A03).

## Work that must wait

- Exact IID parser/canonicalizer until `@0xintuition/iid` is available.
- Scheme-to-classification/provider behavior until `iid-registry` is available.
- Resolved semantic field projection until classification contracts are frozen.
- Production URI/IID writers until indexed reader proof passes.
- NPM dependency commits until versions satisfy Core's release-age policy, unless an explicit separately reviewed exception is approved.

## Stop conditions

- Contract ABI differs between `contracts-v2`, public protocol, Core, or Rindexer.
- Canonical bytes or atom ID differ across package/Core fixtures.
- A Core PR introduces its own IID scheme/canonicalization/provider table.
- Context ingestion drops, reorders, or requires UTF-8 URI bytes.
- A migration requires destructive rollback.
- Reader compatibility breaks legacy consumers.
