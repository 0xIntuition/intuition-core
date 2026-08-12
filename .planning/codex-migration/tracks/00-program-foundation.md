# Track 0 — Program foundation

## Mission

Create the shared contracts, fixtures, ownership, flags, and release controls that allow all implementation tracks to work independently without semantic drift.

## Owner and reviewers

- Primary: migration/integration lead
- Required reviewers: packages, contract/indexer, Core data, seed/writer, API/product, security

## Work packages

1. Ratify the blocking decisions in [../12-decision-log.md](../12-decision-log.md).
2. Define canonical `ParsedIid`, `ClassificationDecision`, `ResolutionPlan`, `AtomContextEvidence`, `ResolutionArtifact`, `ResolvedAtom`, and `AtomAnchor` schemas.
3. Create versioned golden fixtures covering P0, typed profile, colon-bearing value, invalid input, URI ordering/limits, empty context, and legacy JSON.
4. Record contract artifact/ABI fingerprint, network addresses, activation blocks, and live URI config.
5. Define package, schema, resolver, and projection version stamping.
6. Create feature flags: reader, projection, resolver, API exposure, writer global kill switch, and per-scheme writer allowlist.
7. Define dashboards, go/no-go template, rollback authority, and cross-repository PR dependency labels.

## Interfaces produced

- Machine-readable fixture bundle consumed by package and Core CI.
- Schema definitions owned in one agreed repository/package.
- Release manifest mapping exact contract, package, migration, and fixture versions.
- Program board seeded from [../11-master-execution-checklist.md](../11-master-execution-checklist.md).

## Acceptance

- Each fixture has canonical bytes and expected outputs reviewed by both a producer and consumer owner.
- No blocking decision is merely implied by code.
- Every production write surface and downstream API consumer has a named owner.
- Rollback disables writers without reverting schema or losing context.

## Handoff

Tracks 1 and 2 begin when semantic types, ABI artifact, and fixture formats are frozen. Later compatible fixture additions are allowed; changing existing expected bytes requires a versioned breaking decision.
