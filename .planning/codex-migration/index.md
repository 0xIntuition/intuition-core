# Intuition Core IID and atom-context migration

Status: active comprehensive program; current completion tracking is in [17-core-cutover-completion-plan.md](./17-core-cutover-completion-plan.md)

Prepared: 2026-08-10

Scope: Intuition Core, `0xIntuition/packages`, contract artifacts, indexing, data APIs, explorer, seed preparation, and atom creation

This packet is the implementation and coordination plan for making Intuition Identifiers (IIDs) the default identity representation for new atoms and for carrying the contract's URI context through the complete Core stack. It supersedes the earlier assumption that the whole migration is a one-to-two-day change. A focused integration sprint is still useful, but it sits inside a stage-gated cross-repository release program.

## Program at a glance

The migration has two independent inputs that meet in Core:

```text
public semantic packages                       URI-enabled contracts
iid -> classifications -> registry             ABI -> event ingestion
                 |                                      |
                 +-----------> Core <-------------------+
                                  |
               recognize -> resolve -> project -> serve
                                  |
                         seed and mint writers
```

The governing rule is **read before write**: Core must recognize, store, resolve, search, and display IIDs and URI context before production writers make IID atoms the default.

## Reading order

### Architecture baseline

1. [00-executive-overview.md](./00-executive-overview.md) — problem, target state, and critical path
2. [01-target-architecture.md](./01-target-architecture.md) — shared data contracts and end state
3. [02-impact-inventory.md](./02-impact-inventory.md) — repository and subsystem impact
4. [03-engineering-tracks.md](./03-engineering-tracks.md) — initial ownership model
5. [04-cutover-runbook.md](./04-cutover-runbook.md) — rollout, backfill, and rollback baseline
6. [05-decisions-risks-and-tests.md](./05-decisions-risks-and-tests.md) — original decisions and acceptance matrix
7. [06-scheme-resolution-matrix.md](./06-scheme-resolution-matrix.md) — IID-to-type and resolver routing

### Comprehensive execution program

8. [07-reference-implementation-analysis.md](./07-reference-implementation-analysis.md) — what the private implementation proves, and what does not port directly
9. [08-public-package-architecture-and-release.md](./08-public-package-architecture-and-release.md) — package boundaries, Core integration, versions, and NPM release train
10. [09-program-roadmap.md](./09-program-roadmap.md) — phases, dependency graph, staffing, gates, and integration cadence
11. [10-core-file-change-map.md](./10-core-file-change-map.md) — concrete Core seams and expected changes
12. [11-master-execution-checklist.md](./11-master-execution-checklist.md) — owner-ready execution and cutover checklist
13. [12-decision-log.md](./12-decision-log.md) — decisions to ratify before implementation begins
14. [13-open-source-program-interlock.md](./13-open-source-program-interlock.md) — how this migration changes and extends the completed OSS program
15. [14-24-hour-parallel-execution.md](./14-24-hour-parallel-execution.md) — immediate package-independent Core work and the 24-hour merge order
16. [16-live-package-join-board.md](./16-live-package-join-board.md) — verified package state, exact IID adapter mapping, tarball gates, and live J01–J04 ownership
17. [17-core-cutover-completion-plan.md](./17-core-cutover-completion-plan.md) — authoritative remaining gaps, Core PR stack, no-Docker work, and final cutover gates

Detailed track charters live under [`tracks/`](./tracks/00-program-foundation.md).

## Recommended ownership

Seven workstreams can proceed with controlled overlap. With fewer engineers, combine adjacent tracks, but keep the ownership boundaries and acceptance gates intact.

| Track | Owns | Depends on |
| --- | --- | --- |
| 0. Program foundation | decisions, schemas, fixtures, release coordination | none |
| 1. Public packages | IID grammar, semantic registry, builders, NPM releases | Track 0 |
| 2. Contract URI ingestion | ABI parity, event storage, projection of context | Track 0 |
| 3. IID recognition | parser, classification, normalization, identity persistence | Tracks 0–1 |
| 4. Resolution and enrichment | provider plans, workers, artifacts, projections | Tracks 1 and 3 |
| 5. Data, API, and explorer | schema/read models, search, compatibility, UI | Tracks 2–4 |
| 6. Seed and mint integration | canonical writer, seed projection, URI-aware minting | Tracks 1 and 5 read gate |
| 7. Quality and operations | contract tests, observability, backfill, cutover | all tracks |

Track charters:

- [00-program-foundation.md](./tracks/00-program-foundation.md)
- [01-public-packages.md](./tracks/01-public-packages.md)
- [02-contract-uri-ingestion.md](./tracks/02-contract-uri-ingestion.md)
- [03-iid-recognition.md](./tracks/03-iid-recognition.md)
- [04-resolution-enrichment.md](./tracks/04-resolution-enrichment.md)
- [05-data-api-explorer.md](./tracks/05-data-api-explorer.md)
- [06-seed-mint-integration.md](./tracks/06-seed-mint-integration.md)
- [07-quality-release-operations.md](./tracks/07-quality-release-operations.md)

## Source hierarchy

1. URI-enabled protocol source: `/Users/metasudo/workspace/intution/workspace/intuition-contracts-v2/src/protocol`
2. Public package source and release policy: `/Users/metasudo/workspace/intution/workspace/packages` ([GitHub](https://github.com/0xIntuition/packages))
3. Implemented private reference: `/Users/metasudo/workspace/intution/workspace/alpha/.planning/iid-migration` and its corresponding code
4. Current Core runtime: this repository
5. Earlier IID design material: `/Users/metasudo/workspace/intution/workspace/intuition-v2/.planning/intuition-id`

The private monorepo is evidence that the architecture works, not a package API specification. Public package source and contract source win when interfaces differ. Any disagreement at those boundaries is a release blocker.

## Non-negotiable invariants

- Identity bytes are deterministic and offline. External APIs enrich an atom but never change its IID.
- Parse an IID by splitting only the first two colons; the value may contain additional colons.
- New writes use only registered schemes and canonical values.
- P0 (`int:<scheme>:<value>`) is used only when the scheme is unambiguously typed. Polymorphic schemes use an explicit P1/P2 profile.
- URI context is ordered, bounded evidence. It never contributes to the atom ID.
- `AtomContextRegistered` is joined to the atom by `termId`, never by log adjacency.
- Raw identity, resolution artifacts, and resolved projection remain separate.
- Legacy JSON, URL, IPFS, and string atoms remain readable during the compatibility window.
- Same IID means the same off-chain identity cluster; it does not imply the same on-chain atom ID.
- Every published `@0xintuition/*` dependency is exact-pinned, provenance-checked, and represented once in the lockfile.
- Production writers remain disabled until reader, API, search, display, and rollback gates pass.

## Definition of program completion

The program is complete when one golden IID fixture can be followed end to end from canonical builder output through URI-aware contract creation, event ingestion, durable identity/context storage, provider resolution, resolved projection, API/search/explorer display, replay/backfill, and operational rollback—and the same test proves that legacy atoms continue to behave correctly.
