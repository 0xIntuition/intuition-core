# Cutover runbook

## Rollout principle

Ship readers before writers, make schema changes additive, and gate every behavior independently. New IID atoms remain valid raw atom data even if resolution is disabled; this is the basis of the rollback plan.

Recommended flags:

| Flag | Effect |
| --- | --- |
| `ATOM_CONTEXT_INGEST_ENABLED` | Project `AtomContextRegistered` into KG context rows |
| `IID_INTERPRETATION_ENABLED` | Detect/validate P0/P1/P2 and persist identity |
| `IID_RESOLUTION_ENABLED` | Queue identifier resolver work |
| `IID_READ_API_ENABLED` | Expose identity/context fields to selected clients |
| `IID_SEED_WRITE_ENABLED` | Make seed manifests IID/profile-first |
| `IID_MINT_DEFAULT_ENABLED` | Make user/app atom creation IID-first |
| `IID_CLUSTERING_ENABLED` | Join equal IIDs in the identity projection |

Do not use one master flag. Parser, resolver, reads, and writes need independent rollback.

## Phase 0 — go/no-go inputs

- [ ] URI-enabled contract artifact, address, chain, and activation block are recorded.
- [ ] Direct versus fee-proxy write route is selected and exercised.
- [ ] Contract URI config is read successfully on the target network.
- [ ] IID spec/package/classification versions and registry hash are pinned.
- [ ] P0/P1/P2 policy is approved; unsupported scheme policy is explicit.
- [ ] Golden fixtures and expected atom IDs are committed.
- [ ] Provider credentials, rate limits, and mocks are ready.
- [ ] Database backup/recovery posture and migration owner are confirmed.
- [ ] Feature flags default off and can be changed without a redeploy.
- [ ] One integration lead holds go/no-go and rollback authority.

No production switch should start with any of these unresolved.

## Phase 1 — land contracts and additive storage

1. Publish/sync the ABI and client package.
2. Apply additive Timescale and KG migrations.
3. Deploy ingestion capable of reading the new event, initially with KG context projection disabled if necessary.
4. Deploy dual-format parser/persistence/API code with new response fields disabled or additive.
5. Validate health queries, migration versions, and old-atom regressions.

Acceptance gates:

- Existing event indexing is unchanged.
- Existing atom APIs pass contract tests.
- No rows are rewritten merely by deploying the new schema.
- A synthetic context event can be decoded without projecting it.

## Phase 2 — enable dual reads and context ingestion

1. Enable context projection on a canary worker.
2. Replay from the exact contract activation block.
3. Verify event counts against chain receipts and check orphan joins.
4. Enable IID interpretation for a sample of new and historical nodes.
5. Expose identity/context fields to internal clients.
6. Enable resolver processing with mocks or a strict canary/rate limit.

Health queries should cover:

- chain context events versus typed rows versus KG URI rows;
- distinct `(tx_hash, log_index)` and `(node_id, tx_hash, log_index, ordinal)` counts;
- contexts with no matching node after the expected projection delay;
- invalid IID/profile counts and examples;
- resolver retries, throttling, permanent misses, and artifact writes;
- legacy stage success/error rates compared with the pre-deploy baseline.

Stop if context counts diverge, raw bytes cannot round-trip, or legacy processing degrades materially.

## Phase 3 — dry-run seed and legacy backfill

### Seed dry run

Run the entire target dataset without writes and produce:

- counts by classification, chosen scheme, class, and profile;
- canonicalization rejects and missing identity ladder inputs;
- unsupported P0 scheme/type routes;
- old atom bytes/ID versus new bytes/ID;
- URI count/length rejects and URI source distribution;
- duplicate IIDs and proposed cluster sizes;
- resolver coverage and estimated provider volume;
- deterministic repeat-run diff, which must be empty.

Any provider-local identifier that appears as an unregistered `int:<scheme>` is a hard failure.

### Legacy backfill dry run

For each existing atom:

1. Read immutable original bytes and existing artifacts.
2. Derive the strongest available IID using the pinned ladder/version.
3. Persist nothing in dry-run mode; report IID, evidence source, confidence, and proposed cluster.
4. Flag classification conflicts and ambiguous ontological levels.
5. Do not claim that a computed IID changes the historical atom ID.

Backfill writes, when approved, add `source=backfill` identifier rows and cluster projection state. They never rewrite atom data. Minting a new P0 anchor is a separate, auditable action.

## Phase 4 — enable IID writes

1. Start a short write freeze for seed jobs and app atom-create routes.
2. Drain or hold in-flight write jobs at a known projection version.
3. Deploy/enable the IID seed writer and URI-enabled SDK/app route.
4. Submit the golden canary atom and one P1 canary.
5. Verify expected atom IDs, receipts, event rows, KG identity/context, enrichment artifacts, API output, search, and explorer rendering.
6. Resume writes for an allowlisted classification/scheme—ISRC music recordings first.
7. Expand only after canary metrics remain healthy.

Avoid turning every registered scheme on at once. Launch readiness is a pair of capabilities: valid profile selection and an approved classification/resolver policy for that scheme.

## Phase 5 — replay, backfill, and expand

- Replay missed context events from the activation block.
- Run legacy identifier backfill in bounded, checkpointed batches.
- Enable exact-IID cluster projection after dry-run comparison.
- Add schemes in cohorts from [06-scheme-resolution-matrix.md](./06-scheme-resolution-matrix.md).
- Refresh search/display materializations from selected artifacts.
- Keep provider concurrency and quotas isolated by resolver.

## Rollback

Rollback is behavioral, not destructive.

1. Disable `IID_MINT_DEFAULT_ENABLED` and `IID_SEED_WRITE_ENABLED`.
2. Return apps/seeders to the previously supported create route.
3. Disable failing resolvers independently; keep parsing and event ingestion running when healthy.
4. Disable new API fields for incompatible clients if necessary.
5. Leave additive tables and already-ingested events intact.
6. Requeue failed projections after the corrected code deploys.

Do not drop migrations, delete context rows, rewrite atom bytes, or attempt to remove already-minted IID atoms. A P0 IID is still valid immutable atom data while downstream hydration is unavailable.

## Post-cutover checks

- [ ] New writes use only canonical registered IIDs.
- [ ] P0 profile counts match the approved scheme allowlist.
- [ ] Expected and indexed atom IDs match for all canaries.
- [ ] Context event counts reconcile with receipts.
- [ ] Resolver errors do not change identity/classification status.
- [ ] Search finds canaries by IID and hydrated name.
- [ ] Legacy atom processing and reads meet the previous baseline.
- [ ] Same-IID nodes appear in the same reversible cluster projection.
- [ ] Seed ledger records package/serializer/contract versions and exact submitted bytes.
- [ ] A repeat replay/backfill creates no duplicate rows or artifacts.

