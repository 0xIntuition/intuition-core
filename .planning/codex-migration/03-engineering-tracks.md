# Engineering tracks

## Operating model

Name one integration lead before work starts. During the opening interface freeze, the team commits the shared fixture file and the versioned interpretation contract. Each owner then works in a separate branch/worktree and avoids editing another track's generated files unless coordinated.

All tracks use the same first fixture:

```text
payload:       int:isrc:USRC17607839
profile:       P0
classification MusicRecording (exact, from scheme)
context:       one Spotify track URL, one MusicBrainz recording URL
expected:      stable atom ID, indexed context, normalized artifacts, searchable display
```

Add P1, invalid, and legacy fixtures before implementation starts; the full matrix is in [05-decisions-risks-and-tests.md](./05-decisions-risks-and-tests.md).

## Track A — contract artifacts and chain ingestion

**Suggested owner:** protocol/indexer engineer  
**Can start after:** deployed contract version/address/start block confirmed  
**Primary repositories:** `intuition-contracts-v2`, `intuition-core`, shared contract package

### Deliverables

- Publish/sync the URI-enabled ABI into all contract consumers.
- Add `AtomContextRegistered` to Rindexer configuration and regenerate bindings.
- Extend `ParsedEvent`, storage records, Timescale typed tables/readers, and metrics.
- Add the KG projection handoff keyed by `term_id` plus tx/log/ordinal.
- Update SDK write bindings for direct and proxy routes, including config reads.
- Supply event fixtures/receipts for single, empty-context, and batch cases.

### Definition of done

- A local/devnet batch emits and indexes context for the correct atoms even though context logs are not adjacent to their `AtomCreated` logs.
- Replaying the range produces byte-for-byte equivalent rows and no duplicates.
- Empty URI lists create no false failure.
- Raw non-UTF-8 context survives ingestion without loss.
- ABI drift CI fails when the generated artifact differs from the contract source.

### Handoffs

- To Track C: event row/projection schema and sample records.
- To Track D: final function signature, proxy choice, limits, and receipt shape.
- To Track E: deployment boundary and replay command.

## Track B — IID interpretation, classification, and enrichment

**Suggested owner:** data-semantics/enrichment engineer  
**Can start after:** registry/spec version and shared interpretation contract frozen  
**Primary repositories:** `intuition-v2/intuition/iid`, `intuition-v2/intuition/classifications`, `intuition-core/packages`, atom services/workers

### Deliverables

- Pin/publish compatible IID and classification package versions.
- Add P0/P1/P2 parsing and validation to `atom-parser`.
- Add scheme/value classification rules and polymorphic-profile validation.
- Define resolver targets and update enrichment engine/plugin interfaces.
- Build the ISRC-to-music vertical slice, including context URL hints and artifact provenance.
- Update worker and atom-services processing contracts/statuses.
- Keep legacy URL/JSON/IPFS behavior as adapters.

### Definition of done

- The golden P0 ISRC fixture reaches `MusicRecording` classification with no provider call.
- Provider failure leaves identity/classification complete and resolution retryable.
- A polymorphic IID in bare P0 is flagged as profile-invalid; the same IID in valid P1 is accepted.
- Unknown schemes and non-canonical values are rejected on writes and quarantined on reads.
- Parser, worker, and atom-services parity tests share the same fixtures.
- Resolver output records provider, source, fetch time, version, raw reference/hash, and normalized payload.

### Handoffs

- To Track C: interpretation schema, statuses, and artifact fields.
- To Track D: profile-selection API, identity ladder API, and deterministic serializer requirements.
- To Track E: package versions/registry hash and golden expected outputs.

## Track C — persistence, projections, API, and explorer

**Suggested owner:** backend/platform engineer  
**Can start after:** table/API field names and interpretation contract frozen  
**Primary repository:** `intuition-core`

### Deliverables

- Add KG identity and context projection migrations/actions/indexes.
- Add the Timescale typed event schema in coordination with Track A.
- Update parsing/classification/enrichment persistence and reconciliation statuses.
- Add compatible API input validation and identity/context/resolution response fields.
- Update search/display materialization and explorer presentation.
- Implement same-IID cluster keying or, for the minimum slice, a deterministic query/view that proves expected cluster membership without destructive merges.
- Add a legacy IID backfill job with dry-run/report mode.

### Definition of done

- Migrations are additive, reversible at the application level, and pass schema tests.
- Multiple nodes can share an IID and query as one identity cluster.
- Exact atom bytes, context event bytes, and enrichment artifacts remain independently inspectable.
- Legacy API consumers continue to receive usable `dataResolved` and classification fields.
- Search finds a node by IID immediately and by hydrated name after resolution.
- Reprocessing and context replay are idempotent.

### Handoffs

- To Track A: storage actions for event projection.
- To Track B: persistence actions and status enums.
- To Track D: seed write schema and conflict/upsert behavior.
- To Track E: migration order, health queries, and rollback-compatible flags.

## Track D — seed control plane, SDK, and mint clients

**Suggested owner:** data pipeline/application engineer  
**Can start after:** profile-selection API, serializer version, and contract route frozen  
**Primary repositories:** `intuition-v2`, seed/import tooling, shared SDK/contract package

### Deliverables

- Replace ad hoc/provider identifiers with registered canonical IIDs.
- Evaluate classification identity ladders and choose the highest usable rung.
- Produce P0/P1/P2 atom bytes and bounded context URI arrays.
- Bump the seed write projection version and extend the job ledger/audit report.
- Recompute expected IDs from final bytes; make repeated preparation deterministic.
- Update app/SDK create flows to URI-enabled calls and receipt handling.
- Create a dry-run diff showing legacy atom bytes/IDs versus proposed profile/bytes/IDs before any submission.

### Definition of done

- Two clean runs over the same input yield identical IID, profile, atom bytes, URI order, and expected atom ID.
- P0 is never emitted for Class C or polymorphic schemes.
- Registered IIDs use `int:<scheme>:<canonical-value>`; provider-local keys do not masquerade as schemes.
- Batch arrays stay aligned and preflight against live URI limits.
- Already-written/on-chain jobs are not silently reprojected or overwritten.
- The golden seed item can be submitted and matches Track A's indexed result and Track C's API response.

### Handoffs

- To Track A: submission transaction and expected event mapping.
- To Track C: write-ready row/manifest shape.
- To Track E: dry-run distribution, rejects, and ID-diff report.

## Track E — integration, QA, and release

**Suggested owner:** tech lead/release engineer  
**Starts immediately and remains unshared:** merge order, flags, go/no-go, rollback

### Deliverables

- Run and record the interface freeze.
- Own the golden fixture corpus and end-to-end harness.
- Track dependency/API/package versions across repositories.
- Prepare deployment order, write freeze, replay/backfill, feature flags, and rollback.
- Verify metrics and query-based acceptance gates.
- Prevent scope creep into full candidate generation/equivalence during the cutover.

### Definition of done

- All cross-stack fixtures pass from transaction receipt to public API.
- No unresolved contract/spec/package drift remains.
- The team has an explicit go/no-go checklist and one person with rollback authority.
- Dual reads run before IID-default writes.
- A rollback disables new writers/resolvers without dropping additive data or losing already-minted atoms.

## Two-day schedule

### Preparation before the focused window

- Contract deployment/artifact is available.
- Spec and package versions are selected.
- Provider credentials/dev mocks work.
- Branches/worktrees, test databases, and devnet are ready.
- The integration lead has a list of actual owners and communication channel.

### Day 1 morning

- 60–90 minute interface freeze.
- Track C lands additive schema skeleton.
- Tracks A and B commit shared event/interpretation fixtures.
- Track D produces dry-run output format and begins profile conversion.

### Day 1 afternoon

- Track A indexes URI events on devnet.
- Track B parses/classifies P0/P1 and resolves ISRC through mocks.
- Track C exposes identity/context through storage and API.
- Track D creates deterministic write manifests and updated SDK simulation.
- Track E runs the first stitched fixture and records gaps.

### Day 2 morning

- Fix integration mismatches.
- Exercise real provider sandbox/API where permitted.
- Run legacy regression, replay/idempotency, batch, and invalid-input tests.
- Produce seed and legacy backfill dry-run reports.

### Day 2 afternoon

- Deploy dual-read/indexing changes with writers still on legacy behavior.
- Replay context events from the confirmed block and validate metrics.
- Perform a short write freeze, deploy IID writers, run canary mints, then enable IID default gradually.
- Keep candidate generation/full equivalence and broad registry resolver coverage in the follow-up backlog.

## Three-engineer fallback

If only three engineers are available:

| Owner | Combined scope | Guardrail |
| --- | --- | --- |
| 1 | Tracks A + event portions of C | Land migrations/schema contract first; regenerate rather than hand-edit bindings |
| 2 | Track B + interpretation portions of C | Freeze shared types before touching resolver plugins |
| 3 | Track D + API/UI portions of C | Use fixtures/mocks until Tracks A/B land; do not invent a second IID serializer |

The tech lead role still must be explicit even if one of the three engineers performs it.

## Follow-up backlog, not cutover scope

- Resolver coverage for every registered scheme.
- Candidate generation for Class C and cross-scheme entities.
- Accepted `sameAs`/`differentFrom` edge thresholds and union-find recomputation.
- Identity-canonical versus display-canonical election at production scale.
- Automated opportunistic anchor minting for legacy data.
- P2 authoring policy and long-term context URI governance.

