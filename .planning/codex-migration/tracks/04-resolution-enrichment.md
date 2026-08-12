# Track 4 — Resolution and enrichment

## Mission

Resolve canonical identity through registered provider capabilities, preserve artifacts and provenance, and project stable display/search data without changing identity.

## Owner and reviewers

- Primary: enrichment engineer
- Reviewers: IID registry owner, database owner, search/API owner, security owner

## Work packages

1. Accept the Track 3 identity contract in worker messages/jobs.
2. Produce provider plans and identifier hints exclusively through `iid-registry`.
3. Implement/adapt provider clients by desired capability.
4. Store raw artifacts or durable references before materialization, with provider, request key, fetch time, resolver version, license/retention metadata, and status.
5. Define retryable, terminal, partial, stale, and unsupported outcomes.
6. Project classification-compatible label, description, image, links, and search fields.
7. Merge multiple provider results using deterministic precedence and field-level provenance.
8. Add refresh TTLs, circuit breakers, concurrency/rate limits, and credential outage handling.
9. Add version-change reconciliation and targeted re-resolution.
10. Preserve the existing URL/JSON enrichment path for legacy atoms.

## Security and reliability

- Treat context URIs and provider responses as untrusted.
- Enforce network egress/SSRF controls, redirect limits, timeouts, response-size limits, and content-type validation.
- Avoid placing full payloads or credentials in logs/dead-letter queues.
- A provider outage never invalidates the canonical identity.
- Projection failure is retryable independently of refetching where possible.

## Acceptance

- A canonical IID without a legacy document schedules the correct provider plan.
- Each artifact and each projected field has traceable provenance/version.
- Rate-limit/auth/network failures remain recoverable; invalid/unsupported identities do not loop forever.
- Replaying the same artifacts is idempotent.
- Registry/provider version changes can be reconciled without rewriting identity.

## Handoff

Track 5 consumes explicit resolution status and resolved projection. Track 7 monitors provider and projection SLOs during canary/cutover.
