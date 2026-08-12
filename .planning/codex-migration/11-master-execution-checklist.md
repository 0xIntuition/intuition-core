# Master execution checklist

> Completion tracking has moved to [17-core-cutover-completion-plan.md](./17-core-cutover-completion-plan.md), which reconciles this original checklist with the implemented Core foundation and the current public package train. Keep this document as the full program gate inventory; use document 17 for current remaining work and PR order.

Use this as the program board seed. Every item needs an owner, issue/PR link, environment, and evidence link. A checkbox is complete only when its acceptance evidence exists.

## Gate 0 — Decisions and contracts

- [ ] Ratify every blocking item in [12-decision-log.md](./12-decision-log.md).
- [ ] Freeze the canonical IID/domain types and errors.
- [ ] Freeze public registry lookup semantics and provider ordering.
- [ ] Freeze the canonical atom builder input/output.
- [ ] Freeze raw and normalized URI-context storage shapes.
- [ ] Record exact URI-enabled contract artifact, addresses, activation blocks, ABI fingerprint, and configured URI limits.
- [ ] Name track owners, cross-reviewers, integration lead, release owner, and rollback authority.
- [ ] Create the shared fixture manifest and document versioning rules.
- [ ] Create feature flags and per-scheme writer allowlist definitions.

Evidence: approved decision record, fixture package, ABI manifest, and assigned program board.

## Gate 1 — Public package release candidate

- [ ] Add and validate public `@0xintuition/iid`.
- [ ] Reconcile declarative classification identity ladders with shared IID types.
- [ ] Add and validate public `@0xintuition/iid-registry`.
- [ ] Add canonical IID atom builder and legacy compatibility mode to `primitives`.
- [ ] Update `protocol` ABI/helpers/events/config readers for URI context.
- [ ] Update `react` if it is part of the supported write surface.
- [ ] Update deployments only if addresses/activation metadata change.
- [ ] Update publish order, pack dry-run list, and tarball smoke list.
- [ ] Enforce exact internal package pins and no undeclared cycles.
- [ ] Add ABI parity test against exact `contracts-v2` artifact.
- [ ] Install packed tarballs together in a clean consumer.
- [ ] Run shared fixture exclusively through public exports.
- [ ] Publish release train and verify NPM integrity/provenance.
- [ ] Record the date each version becomes eligible under Core's 14-day rule.

Evidence: package CI, tarball manifest, ABI report, NPM versions/integrity, eligibility calendar.

## Gate 2 — URI context is durable

- [ ] Bump Core's exact contracts artifact.
- [ ] Synchronize ABI and regenerate Rindexer bindings.
- [ ] Configure and ingest `AtomContextRegistered`.
- [ ] Add shared event type and parsed model.
- [ ] Add typed event table with `sequence_number` and provenance.
- [ ] Add handler storage and typed event reader.
- [ ] Add idempotent projection keyed by event identity and joined by `termId`.
- [ ] Preserve raw bytes and ordinal order.
- [ ] Normalize supported URIs separately; flag malformed/unsupported entries.
- [ ] Reconcile event-before-atom/orphan timing.
- [ ] Replay the same range twice and compare results.
- [ ] Expose context metrics and alerts.

Evidence: migration output, real-log fixture decode, replay diff, KG query, dashboard.

## Gate 3 — IID reader and resolver

- [ ] Add IID raw type to parser and database constraint.
- [ ] Recognize IID before URL/string fallbacks.
- [ ] Persist raw/canonical identity, profile, scheme, value, version, and status.
- [ ] Backfill existing `int:` atoms through the same parser.
- [ ] Classify only through public registry.
- [ ] Preserve unknown/polymorphic state without guesses.
- [ ] Plan enrichment from IID provider/hint lookup.
- [ ] Store raw artifacts with provider/fetch/version provenance.
- [ ] Implement retryable versus terminal failure taxonomy.
- [ ] Project resolved display/search fields idempotently.
- [ ] Add reconciliation for resolver/registry upgrades.
- [ ] Prove live ingestion and replay/backfill converge.
- [ ] Prove legacy parser/classification/enrichment behavior does not regress.

Evidence: fixture results, migration/backfill report, worker tests, queue metrics, convergence report.

## Gate 4 — API, search, and explorer readers

- [ ] Add additive API identity/context/resolution/display fields.
- [ ] Preserve raw and legacy fields for compatibility.
- [ ] Add unresolved/retryable/terminal status semantics.
- [ ] Update queries/loaders to avoid JSON-only assumptions.
- [ ] Add search documents from resolved labels and semantic metadata.
- [ ] Prevent raw IID from becoming the final label/search content when resolution exists.
- [ ] Render raw identity, context provenance, and resolved display distinctly in explorer.
- [ ] Add scheme/classification/status/context filters only where indexed and supported.
- [ ] Run contract tests with known downstream consumers.
- [ ] Load-test identity/context joins and search backfill.
- [ ] Validate accessibility and safe URI rendering.

Evidence: OpenAPI/GraphQL diff as applicable, consumer tests, screenshots, query plans, load results.

## Gate 5 — Seed and writer shadow mode

- [ ] Inventory every production atom writer and seed source.
- [ ] Route each writer through the public canonical builder.
- [ ] Transform source rows into typed identity inputs.
- [ ] Validate P0/P1/P2 eligibility and canonicalization offline.
- [ ] Create deterministic URI manifests within live contract config.
- [ ] Generate reviewable dry-run artifact with predicted atom IDs.
- [ ] Detect intra-batch and on-chain duplicates.
- [ ] Create idempotent batch/resume ledger.
- [ ] Simulate URI-aware calls and report per-record failures.
- [ ] Run golden corpus twice and compare byte-for-byte.
- [ ] Mint to staging/devnet and verify through indexed reader output.
- [ ] Run shadow comparison against legacy seed output.

Evidence: dry-run manifest, duplicate report, repeatability hash, staging transaction and indexed API proof.

## Gate 6 — Production cutover

- [ ] Adopt exact NPM versions after release-age eligibility.
- [ ] Verify one version of each `@0xintuition/*` dependency in lockfile.
- [ ] Deploy migrations and readers with writer flags off.
- [ ] Complete bounded backfills and reconciliation.
- [ ] Record baseline SLOs and error budgets.
- [ ] Enable internal allowlist for one unambiguous scheme.
- [ ] Verify on-chain event, projection, resolution, API, search, and explorer for canary atoms.
- [ ] Expand by scheme/producer only after observation window passes.
- [ ] Make IID the default for approved new atom types.
- [ ] Retain and test emergency writer disable.
- [ ] Publish migration notes for downstream package/API consumers.

Evidence: deployment manifest, dashboard snapshots, canary ledger, go/no-go sign-off.

## Gate 7 — Compatibility exit

- [ ] Measure remaining legacy write callers and legacy-read traffic.
- [ ] Migrate or explicitly exempt every caller.
- [ ] Announce deprecation dates and supported escape hatch.
- [ ] Remove duplicate scheme maps and local builders only after usage is zero.
- [ ] Keep historical raw data and immutable event evidence.
- [ ] Archive backfill/runbook reports and final fixture versions.
- [ ] Conduct post-migration review and convert follow-ups to owned issues.

Evidence: usage telemetry, deprecation record, code search proof, final program report.

## Immediate next actions

1. Hold the decision review using [12-decision-log.md](./12-decision-log.md).
2. Open the public package foundation issues in dependency order.
3. Open the Core URI-ingestion issue independently so it can begin in parallel.
4. Create the golden fixture repository/export and CI contract before feature PRs diverge.
5. Publish prereleases as soon as package gates pass so the 14-day clock overlaps Core reader work.
