# Program roadmap

## Delivery strategy

Treat this as a staged platform migration, not a flag day. Semantic packages, URI event ingestion, and Core reader work can run in parallel after the shared contracts are frozen. Production writers are the final dependent track.

```text
Phase 0: ratify contracts and fixtures
       |----------------------|
       v                      v
Phase 1A: public packages     Phase 1B: URI event ingestion
       |                      |
       v                      v
Phase 2: Core recognize + persist + resolve
       |
       v
Phase 3: API + search + explorer reader gate
       |
       v
Phase 4: shadow seed/mint writers
       |
       v
Phase 5: controlled default switch + backfill + deprecation

NPM prerelease publish -> 14-day soak runs alongside Phases 2–3
```

## Phase 0 — Foundation and decision freeze

Goal: make every parallel team build against the same contract.

Deliverables:

- Ratify [12-decision-log.md](./12-decision-log.md).
- Freeze canonical identity and resolution types.
- Freeze the public builder input/output contract.
- Freeze normalized atom-context representation and bounds.
- Establish one golden fixture set: unambiguous P0, typed polymorphic IID, colon-bearing value, invalid IID, URI context, no-context IID, and legacy JSON.
- Record exact contract artifact/version and expected ABI fingerprint.
- Establish dashboards, feature flags, and rollback ownership before rollout work starts.

Exit gate: fixture schemas and ownership are approved by package, contract/indexer, backend, seed, and product/API owners.

## Phase 1A — Public semantic and protocol packages

Goal: create the shared implementation that every repository consumes.

Deliverables:

- `iid`, reconciled classification ladders, and `iid-registry`.
- Canonical builder in `primitives`.
- URI-enabled ABI and helpers in `protocol`.
- Optional URI-aware React hook.
- Packed-tarball integration harness and ABI parity test.
- Prereleases published in dependency order.

Exit gate: package tarballs pass the end-to-end package fixture and are published. The 14-day release-age clock begins.

## Phase 1B — Contract URI ingestion

Goal: ensure Core never loses URI context emitted by the protocol.

Deliverables:

- Exact URI-enabled contracts artifact in Core's contracts workspace.
- Synchronized Rindexer ABI/config/generated bindings.
- `AtomContextRegistered` in raw/typed event storage, shared event models, and replay readers.
- Knowledge-graph context projection joined by `termId`.
- Raw bytes preserved plus a separately normalized view.
- Event metrics, malformed URI handling, and replay fixture.

This work can initially compile against local contract artifacts. Public `protocol` parity must pass before production release.

Exit gate: replaying the URI fixture twice is idempotent, order-preserving, and produces the same durable context.

## Phase 2 — Recognize, persist, classify, and resolve

Goal: make Core a complete reader of IID atoms.

Deliverables:

- IID raw type and canonical parsing in the atom parser.
- Identity persistence with raw/canonical IID and parsed components.
- Classification through the registry, including safe behavior for polymorphic schemes.
- Identifier-first enrichment plans and provider adapters.
- Artifact provenance, retry taxonomy, resolved projection, and reconciliation jobs.
- Legacy paths preserved.

Exit gate: backfilled and live IID atoms converge to identical identity, classification, provider plan, and resolved projection.

## Phase 3 — Data product reader gate

Goal: make the migration visible and correct to API and explorer consumers.

Deliverables:

- Versioned API shape for identity, context, resolution status, classification, artifacts, and display data.
- Search uses display labels/resolved metadata rather than raw IIDs where resolution exists.
- Explorer shows identity and context provenance without replacing the raw on-chain value.
- Loading, unresolved, retryable failure, terminal failure, and legacy states are distinct.
- Query/index performance is measured against production-scale datasets.

Exit gate: all reader acceptance tests pass in staging; no surface relies on a legacy JSON object being present.

## Phase 4 — Shadow writer and seed migration

Goal: validate the future write path without changing production defaults.

Deliverables:

- Seed source data maps to canonical IID inputs before upload/mint.
- Single public builder used by seed jobs and any application transaction adapter.
- URI manifest produced deterministically, deduplicated, ordered, and contract-bounded.
- Dry-run output records canonical data bytes, predicted atom ID, provider plan, URI manifest, and validation warnings.
- Shadow comparison against legacy output and duplicate/collision reports.
- Idempotent resume ledger for bulk jobs.

Exit gate: the seed golden corpus produces deterministic results across reruns and the reader path displays shadow-minted staging atoms correctly.

## Phase 5 — Cutover, backfill, and compatibility

Goal: enable IID writes safely and move existing data into the new read model.

Order:

1. Deploy all readers with IID writer flags off.
2. Replay/backfill URI context and IID identity projections.
3. Verify API, search, explorer, queue, provider, and database SLOs.
4. Enable URI-aware writer for an internal allowlist.
5. Enable one scheme at a time, beginning with a deterministic unambiguous P0 scheme such as ISRC.
6. Expand by scheme and producer while watching failure budgets.
7. Make IID the default for approved new atoms.
8. Retain legacy reads and an explicit legacy write escape hatch for the agreed compatibility period.
9. Deprecate duplicate derivation code only after telemetry shows no callers.

Rollback disables writers first. Reader support and durable context storage remain deployed because they are backward compatible and necessary to interpret already-created atoms.

## Staffing model

Recommended: one program/integration lead and one owner for each of Tracks 1–6; Track 7 is jointly staffed by the integration lead and platform/reliability. A smaller team can combine work as follows:

- Package foundation + IID recognition
- URI ingestion + data/API
- Resolution/enrichment + seed/mint
- Integration/operations remains a named owner, not an unowned shared responsibility

Do not assign both sides of a producer/consumer contract without a second reviewer. In particular, package APIs require review from Core consumers, and URI event projection requires review from the contract owner.

## Integration cadence

- Daily contract review during active implementation: changed exports, schemas, fixtures, migrations, and event shapes.
- Merge package work in dependency order; merge Core reader work behind flags.
- Run the cross-repository golden fixture on every boundary change.
- Use one integration branch only for packed-tarball validation; normal feature work remains independently reviewable.
- Cutover authority belongs to one named integration lead with explicit stop/rollback criteria.

## Schedule reality

The hands-on Core integration can be compressed into focused parallel days after contracts and packages are ready. The production program cannot honestly complete in one to two days because package publication must satisfy Core's release-age policy and external resolver behavior needs observation. Plan around gates, not calendar optimism: publish early, run Core integration against packed tarballs while versions soak, and use the waiting period for reader/backfill/load validation.

## Program-level success metrics

- 100% of recognized IID atoms have canonical parsed identity rows.
- 100% of context events are durably stored; projection lag stays within the existing event SLO.
- Resolution success and retry rates are visible by scheme/provider.
- No user-facing label or search document is only a raw IID when a resolved label exists.
- Zero atom-ID mismatch between public builder, Core, and contract fixture.
- Zero ABI drift between contracts artifact, public protocol package, and Rindexer.
- Legacy atom query success does not regress.
- Writer rollback can be completed without schema rollback or loss of ingested context.
