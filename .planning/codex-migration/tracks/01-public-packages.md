# Track 1 — Public packages and NPM release

## Mission

Publish the reusable IID, semantic registry, canonical builder, and URI-aware protocol interfaces that Core and all atom writers consume.

## Owner and reviewers

- Primary: public packages maintainer
- Reviewers: Core parser/enrichment owner, seed/writer owner, contract owner, release/security owner
- Repository: `/Users/metasudo/workspace/intution/workspace/packages`

## Work packages

1. Implement `iid` grammar/canonicalization and public fixture exports.
2. Reconcile public declarative classification identity ladders with shared IID types.
3. Implement pure `iid-registry` lookup and provider-plan APIs.
4. Add the canonical IID atom anchor/URI-manifest builder in `primitives`.
5. Update `protocol` for URI function, event, and config APIs; preserve old methods.
6. Update `react` only if it is a supported atom writer.
7. Add semantic ABI parity against exact `contracts-v2`.
8. Update publish order, pack dry-run, tarball smoke, and clean-consumer tests.
9. Publish exact prereleases in topological order and verify registry artifacts.
10. Maintain a Core eligibility calendar for the 14-day minimum-age gate.

## Constraints

- Pure packages perform no network I/O.
- No circular dependency between classifications and registry.
- Public exports, not source paths, are the integration contract.
- `ids` remains term hashing; `iid` remains semantic identity.
- Internal dependency versions are exact.
- No `file:` or Git dependency is committed to Core.

## Acceptance

- A clean consumer installed from packed tarballs passes the golden fixture.
- Canonical builder bytes and atom ID match Core and contract fixtures.
- URI transaction encoding and event decoding match the exact contract ABI.
- Every declared scheme has explicit classification/provider/eligibility test behavior.
- NPM artifacts contain all documented exports and provenance.

## Handoffs

- Track 3 consumes `iid` and `iid-registry`.
- Track 4 consumes registry provider plans.
- Track 6 consumes builder and protocol APIs.
- Track 7 owns cross-repo verification and final Core adoption.
