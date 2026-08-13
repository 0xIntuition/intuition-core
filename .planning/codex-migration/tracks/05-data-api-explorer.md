# Track 5 — Data model, API, search, and explorer

## Mission

Make IID identity, URI evidence, resolution state, and resolved presentation available across Core while preserving legacy consumers and raw on-chain truth.

## Owner and reviewers

- Primary: Core data/API engineer
- Reviewers: parser, context projection, enrichment, explorer/product, downstream consumer owners

## Work packages

1. Deliver additive KG schema/indexes for identity, context, artifacts, and resolved projection.
2. Replace duplicated term-ID hashing with thin `@0xintuition/ids` wrappers and parity tests.
3. Stop raw IID from becoming the default final `searchText`/label.
4. Extend atom read APIs with structured raw/identity/classification/context/resolution/display sections.
5. Preserve current legacy fields and define deprecation telemetry.
6. Add supported filters/sorts and query indexes.
7. Build/rebuild search documents from resolved data plus canonical safe hints.
8. Update explorer detail and result cards for raw identity, context, provenance, resolution state, and display data.
9. Render external URIs safely and distinguish evidence from verified links.
10. Add consumer contracts, query-plan/load tests, and cache invalidation behavior.

## Required UI states

- Recognized, awaiting resolution.
- Partially resolved.
- Resolved.
- Retryable provider failure.
- Terminal unsupported/invalid identity.
- Legacy atom with existing structured enrichment.
- Raw unrecognized atom.

## API compatibility rules

- Additive first; do not silently change the meaning of an existing field.
- Raw on-chain bytes/data remain queryable.
- Resolved values carry source/version/freshness.
- Context preserves on-chain order and provenance.
- Missing classification or resolution is a modeled state, not a fabricated fallback.
- Search result labels may fall back gracefully, but the full raw IID remains visible as secondary identity.

## Acceptance

- Golden IID and legacy fixtures render correctly before and after resolution.
- Search uses resolved semantic fields when available and never depends on legacy JSON-LD.
- Context links are safe against injection and unsupported URI schemes.
- Production-scale query plans stay inside agreed SLOs.
- Known consumers pass contract tests against the compatibility shape.

## Handoff

The passing reader gate authorizes Track 6 to begin staging/shadow writes. It does not by itself authorize production IID defaults.
