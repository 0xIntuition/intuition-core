# Intuition ID migration packet

Status: proposed execution plan  
Prepared: 2026-08-06  
Scope: Intuition Core, shared IID/classification packages, contract artifacts, application minting, and the seed control plane

This packet turns the Intuition ID (IID) and atom-context contract changes into a coordinated migration that can be split across engineers. The intended execution window is one to two focused days after the decisions in [05-decisions-risks-and-tests.md](./05-decisions-risks-and-tests.md) are closed.

## Read this first

1. [00-executive-overview.md](./00-executive-overview.md) — what is changing and the critical path
2. [01-target-architecture.md](./01-target-architecture.md) — shared data contracts and end state
3. [02-impact-inventory.md](./02-impact-inventory.md) — concrete repository and subsystem impact
4. [03-engineering-tracks.md](./03-engineering-tracks.md) — ownership tracks, handoffs, and definition of done
5. [04-cutover-runbook.md](./04-cutover-runbook.md) — sequence, rollout, backfill, and rollback
6. [05-decisions-risks-and-tests.md](./05-decisions-risks-and-tests.md) — decisions to lock and cross-stack acceptance matrix
7. [06-scheme-resolution-matrix.md](./06-scheme-resolution-matrix.md) — IID-to-type and resolver routing

## Source of truth used

- IID planning: `/Users/metasudo/workspace/intution/workspace/intuition-v2/.planning/intuition-id`
- IID implementation: `/Users/metasudo/workspace/intution/workspace/intuition-v2/intuition/iid`
- IID formal specification: `/Users/metasudo/workspace/intution/workspace/intuition-v2/intuition/iid-spec`
- Classification ladders: `/Users/metasudo/workspace/intution/workspace/intuition-v2/intuition/classifications`
- URI-enabled protocol implementation: `/Users/metasudo/workspace/intution/workspace/intuition-contracts-v2/src/protocol`
- Current backend: this repository
- Current seed control plane: `/Users/metasudo/workspace/intution/workspace/intuition-v2/packages/database-seed-control-plane`

When these disagree, the migration should stop at the boundary and resolve the discrepancy. In particular, the checked-in Core ABI and older transaction guidance do not yet describe `createAtomsWithUris` or `AtomContextRegistered`; the URI-enabled contract source is authoritative for this plan.

## Recommended staffing

The cleanest split is four implementation owners plus one integration lead. With three engineers, combine Tracks A and C, and combine Tracks B and D only after the shared interpretation contract is frozen.

| Track | Primary ownership | Core output |
| --- | --- | --- |
| A | Contract artifacts and event ingestion | URI context reaches durable storage correctly |
| B | IID, classification, and enrichment | A canonical IID becomes a typed resolution plan and artifacts |
| C | Database, projections, API, and read paths | Identity and context are queryable without breaking legacy atoms |
| D | Seed pipeline, SDK, and minting | New atoms use the right profile and pass aligned context URIs |
| E | Integration/release lead | Fixtures, gates, coordinated cutover, and rollback authority |

## Non-negotiable invariants

- Identity bytes are deterministic and offline. External APIs may enrich an atom; they may never change its IID.
- Parse an IID by splitting only the first two colons.
- Validate against the closed scheme registry and canonical form before new minting.
- P0 is only for Class A/B, unambiguously typed schemes. Class C and polymorphic schemes require P1 or P2.
- Context URIs are evidence and resolution hints. They do not contribute to the atom ID.
- `AtomContextRegistered` must be joined by `termId`, never by event adjacency.
- Legacy JSON, URL, IPFS, and plain-string atoms remain readable throughout the migration.
- Same IID means same identity cluster, not necessarily the same on-chain atom.
- Enrichment preserves source, resolver version, fetch time, and raw artifact provenance.

