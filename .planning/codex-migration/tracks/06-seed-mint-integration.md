# Track 6 — Seed pipeline and atom creation

## Mission

Move every supported atom producer from classification JSON blobs to canonical IID anchors with aligned URI context, deterministic dry runs, and resumable transaction execution.

## Owner and reviewers

- Primary: seed/data pipeline engineer
- Reviewers: public builder owner, contract owner, Core reader owner, operations owner

## Work packages

1. Inventory every seed source, CLI, API, script, application, and job that can create atoms.
2. Define source-to-identity mappings per dataset, including scheme, typed profile where required, canonical value derivation, and evidence URI policy.
3. Replace local serializers with the public canonical builder.
4. Produce a preflight manifest containing source key, IID/profile, canonical data bytes, predicted atom ID, classification decision, provider plan, ordered URI context, warnings, and source lineage.
5. Validate against registry rules and live contract URI config.
6. Detect duplicate source rows, duplicate canonical IIDs, pre-existing atom IDs, and cross-profile identity clusters.
7. Align `atomDatas[i]`, `assets[i]`, and `uris[i]`; simulate before broadcasting.
8. Create an idempotent batch ledger with planned/simulated/submitted/confirmed/indexed/failed states and retry lineage.
9. Shadow-run against current seed output; review semantic deltas and rejected records.
10. Mint to devnet/staging and accept only after Core re-reads the expected identity/context/resolution.
11. Roll out production by producer and scheme allowlist.

## Dataset contract

Each dataset mapping must document:

- source authority and immutable source key;
- canonical scheme and profile-selection rule;
- normalization and rejection rules;
- primary and optional context URI roles;
- how licensed metadata is retained outside atom bytes;
- duplicate and update policy;
- expected resolver/provider coverage;
- accountable domain reviewer.

## Failure policy

- Validation failure: do not submit; return actionable row-level error.
- Simulation/revert: do not mark submitted; preserve batch plan.
- Partial transaction failure: resume from ledger, never rebuild prior successful identities differently.
- Indexing timeout: keep transaction confirmed state and reconcile; do not blindly remint.
- Reader mismatch: stop the producer allowlist and invoke integration rollback.

## Acceptance

- Running a seed corpus twice yields identical data bytes, atom IDs, and context manifests.
- No unsupported polymorphic scheme is emitted as P0.
- Batch arrays always align and comply with current contract limits.
- Staging atoms are visible end to end in Core and match the manifest.
- Emergency writer disable stops new submissions without affecting readers.

## Handoff

Track 7 controls production canary and expansion. Dataset-specific mapping work can continue after the initial scheme, but every new scheme repeats the same acceptance gate.
