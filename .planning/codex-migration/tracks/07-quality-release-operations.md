# Track 7 — Quality, release, backfill, and operations

## Mission

Prove cross-repository compatibility, run safe backfills and canaries, measure the system, and retain an immediate writer rollback path.

## Owner and reviewers

- Primary: integration/release lead with platform reliability partner
- Reviewers: every track owner; security for URI/provider controls

## Test portfolio

### Contract and package contracts

- Golden IID/profile/canonicalization vectors across public packages and Core.
- Atom ID parity across `primitives`, `ids`, Core wrappers, and contract fixture.
- ABI semantic parity across `contracts-v2`, public `protocol`, Core artifacts, and Rindexer.
- Packed-tarball clean-consumer tests using public exports only.
- Lockfile assertion for one exact version per `@0xintuition/*` package.

### Core integration

- Real-log URI event decode, storage, projection, replay, and reorg behavior.
- Live versus backfill convergence for identity/classification/resolution.
- Provider retry/timeout/auth/rate-limit/invalid response tests.
- API/search/explorer tests for every modeled state and legacy atoms.
- Seed manifest -> simulation -> transaction -> event -> indexed response fixture.

### Non-functional

- Database migration duration and lock profile.
- Query plans and API/search load.
- Worker queue throughput, retry amplification, and provider budgets.
- SSRF, URI sanitization, response-size, secret/redaction, and malformed-bytes tests.
- Kill-switch and rollback drill.

## Backfill plan

1. Count candidate historical `int:` raw atoms and all context events from activation block.
2. Run a read-only classification report: valid, invalid, unregistered, polymorphic, already projected.
3. Backfill in deterministic chunks with checkpoint, version, attempt, and error ledger.
4. Use the same domain functions and projections as live processing.
5. Rate-limit external resolution separately from local recognition/projection.
6. Reconcile counts among raw events, typed events, KG identities/context, artifacts, and resolved views.
7. Re-run a sample and then the full backfill to prove idempotency.

## Go/no-go dashboard

Minimum signals:

- chain ingestion and projection lag;
- context event stored/projected/orphan/error counts;
- IID parse valid/invalid by scheme/profile/version;
- classification unknown/polymorphic rates;
- resolution queue depth, age, success, retry, terminal failure by provider/scheme;
- API error/latency and search fallback rate;
- seed builder rejection, simulation, transaction, confirmation, and indexing outcomes;
- contract/package/fixture version deployed.

## Canary sequence

1. Readers and migrations deployed, writer disabled.
2. Historical backfill and reconciliation within budget.
3. Internal actor, one P0 scheme, very small volume.
4. Inspect each atom end to end and compare manifest.
5. Expand volume for same scheme.
6. Add schemes one at a time; typed/polymorphic profiles last.
7. Enable approved external producers.
8. Change default only after observation window and consumer sign-off.

## Stop and rollback criteria

Immediately disable IID/URI writers when any of these occur:

- atom ID differs from the preflight manifest;
- ABI/event decode mismatch or lost context;
- persistent reader/API failure for newly created atoms;
- duplicate creation caused by ledger/reconciliation behavior;
- material provider abuse, SSRF, credential exposure, or uncontrolled retry amplification;
- database or projection lag exceeds agreed error budget.

Rollback means writer flags off and producer jobs paused. Keep additive schema, parsing, context ingestion, and reader support deployed unless they themselves cause the incident. Reconcile submitted transactions from the ledger before resuming.

## Acceptance

- All master checklist gates have evidence and named sign-off.
- Package versions have passed Core's release-age and integrity policies.
- Backfill and double-replay reconcile exactly.
- Canary metrics remain within the agreed observation budget.
- Rollback drill completes without data deletion or schema reversal.
- Operations runbooks identify on-call owner, dashboards, common failure actions, and escalation path.
