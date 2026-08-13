# Track 2 — Contract URI event ingestion

## Mission

Carry URI context from the authoritative contract ABI through Rindexer, event storage, replay, and the knowledge graph without loss or accidental reinterpretation.

## Owner and reviewers

- Primary: contract/indexer engineer
- Reviewers: Solidity owner, projection/data owner, security owner

## Work packages

1. Bump Core's exact contracts artifact and regenerate all ABI-derived files.
2. Add `AtomContextRegistered` to Rindexer configuration and generated handler types.
3. Add the event to shared unions/models, typed storage, handler persistence, and typed readers.
4. Create additive database migrations with `sequence_number`, chain identity, `termId`, creator, raw ordered URI bytes, and timestamps/block provenance.
5. Add idempotent KG projection joined by `termId`.
6. Preserve raw evidence; create separate safe normalization and validation results.
7. Reconcile event-before-atom/orphan projection ordering.
8. Add activation-block backfill, restart/resume, reorg, and double-replay tests.
9. Add URI event lag, malformed entry, orphan, and projection error metrics.
10. Prove ABI parity with public `protocol` before production.

## Edge cases

- Zero context entries.
- Maximum entry count and maximum bytes per entry.
- Non-UTF-8 bytes and unsupported schemes.
- Duplicate URI values and order preservation.
- Multiple context events for a term if the protocol permits/produces them.
- Reorg/removal semantics and projection idempotency.
- Context event observed before the atom event projection.

## Acceptance

- Real encoded event log decodes identically in contracts package, public protocol package, and Rindexer.
- Raw bytes and ordinal order survive storage/replay exactly.
- Normalization cannot overwrite evidence.
- Replaying the same range twice creates no duplicates or drift.
- Orphan context converges after the corresponding atom is available.

## Handoff

Track 5 consumes normalized context and evidence provenance. Track 6 validates writer-produced context against the indexed result.
