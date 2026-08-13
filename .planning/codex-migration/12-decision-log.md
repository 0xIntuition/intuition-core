# Migration decision log

Status values: **proposed**, **ratified**, or **deferred**. All blocking proposed decisions must be ratified before dependent implementation merges.

## D01 — Public semantic ownership

- Status: proposed, blocking
- Decision: `iid` owns grammar/canonicalization; `classifications` owns declarative ladders; `iid-registry` owns semantic and resolver interpretation.
- Reason: this reconciles the private proven boundary with the public repository's declarative model and eliminates shadow maps.
- Approvers: packages lead, backend/Core lead

## D02 — Canonical builder ownership

- Status: proposed, blocking
- Decision: `@0xintuition/primitives` exports the only supported high-level atom anchor builder; lower-level packages remain composable but application/seed code does not duplicate profile or URI-manifest logic.
- Reason: deterministic bytes and predicted atom IDs must be identical across all writers.
- Approvers: packages lead, seed/application leads

## D03 — P0 eligibility

- Status: proposed, blocking
- Decision: P0 is allowed only for schemes whose classification is total and unambiguous. Polymorphic schemes require a typed P1/P2 representation chosen explicitly.
- Reason: type inference must never depend on an external API guess.
- Approvers: semantic/schema owner

## D04 — Initial scheme outcomes

- Status: proposed, blocking for corresponding schemes
- Decision: carry forward the implemented outcomes: `eidr` -> movie; `iswc` has no inferred classification; MusicBrainz release -> album; MusicBrainz label -> company; CAIP-19 classifies only the canonical supported ERC-20 subtype.
- Reason: these have implementation fixtures but need public semantic approval.
- Approvers: semantic/schema owner, product/domain owner

## D05 — URI ordering and normalization

- Status: proposed, blocking
- Decision: raw contract context preserves exact bytes, ordinal order, and event provenance. A separate normalized view validates supported URI schemes, canonicalizes where safe, and may deduplicate for resolution; raw evidence is never rewritten.
- Reason: ordered on-chain evidence and operational resolver inputs have different requirements.
- Approvers: contract/indexer lead, security lead

## D06 — URI manifest policy

- Status: proposed, blocking for writers
- Decision: the canonical builder orders context deterministically by declared role/priority, removes exact duplicates, validates encoding, and enforces live `getAtomUriConfig` limits before simulation. Policy limits may be stricter than contract limits.
- Reason: prevent mismatched batches, excessive cost, and nondeterministic output.
- Approvers: contract lead, packages lead, seed lead

## D07 — URI security policy

- Status: proposed, blocking for resolver/UI
- Decision: allow only approved URI schemes for automated fetching; block private/link-local network targets, enforce redirects/size/content-type/timeouts, sanitize rendered links, and retain unsupported raw bytes without fetching.
- Reason: on-chain context is untrusted input and creates SSRF/content risks.
- Approvers: security lead, platform lead

## D08 — Identity clustering versus atom identity

- Status: proposed, blocking
- Decision: canonical IID creates an off-chain identity cluster/linkage key but never merges or rewrites distinct on-chain atom IDs automatically.
- Reason: atom IDs are derived from exact bytes; same semantic identity can exist in multiple profiles or legacy encodings.
- Approvers: data model owner, protocol owner

## D09 — API compatibility

- Status: proposed, blocking
- Decision: add structured `raw`, `identity`, `context`, `resolution`, and `display` fields while retaining existing raw/resolved fields for a measured compatibility window.
- Reason: downstream consumers need a non-breaking transition and provenance-preserving model.
- Approvers: API owner, consumer representatives

## D10 — Public ABI source and parity

- Status: proposed, blocking
- Decision: `contracts-v2` is the Solidity/deployment artifact source; public `protocol` is the consumer ABI/helper source; Core maintains devnet artifacts. CI semantic-ABI parity among exact versions is mandatory.
- Reason: prevent the current three representations from drifting.
- Approvers: contract lead, packages lead, Core indexer lead

## D11 — Package release-age strategy

- Status: proposed, blocking for production adoption
- Decision: publish prereleases early, integrate packed tarballs in clean temporary environments, and wait for Core's 14-day eligibility before committing NPM dependencies. Emergency exceptions require explicit approval and expiry.
- Reason: preserve supply-chain policy without stalling implementation.
- Approvers: Core maintainer, security/release owner

## D12 — Writer ownership

- Status: proposed, blocking
- Decision: enumerate the supported production atom writers. Every supported writer consumes the canonical builder and URI-aware protocol API; Core's existing raw POST endpoint is either upgraded to that contract or explicitly scoped away from production atom creation.
- Reason: an ambiguous second writer would immediately reintroduce drift.
- Approvers: Core API owner, application owner, seed owner

## D13 — Resolution artifacts and retention

- Status: proposed, blocking for database migration
- Decision: store canonical identity separately from provider artifacts and materialized display projection. Define payload/reference retention, redaction, maximum sizes, and refresh policy per provider class.
- Reason: external data changes and may contain licensed or sensitive content; identity must remain stable.
- Approvers: data owner, legal/security as applicable

## D14 — Retry taxonomy

- Status: proposed
- Decision: throttling, network errors, provider 5xx, and credential outages are retryable with bounded backoff/circuit breaking; invalid canonical identity and unsupported scheme/provider pairs are terminal until registry/version changes.
- Reason: prevents permanent data loss during external outages and endless retry loops for invalid work.
- Approvers: enrichment owner, platform owner

## D15 — Backfill scope

- Status: proposed, blocking for cutover
- Decision: backfill all existing syntactically valid IID atoms and all URI context events from the protocol activation block. Do not automatically rewrite legacy atom bytes into new atoms.
- Reason: readers need complete history; creating new atoms is a separate intentional operation.
- Approvers: data owner, protocol owner

## D16 — Compatibility exit criteria

- Status: proposed
- Decision: remove legacy write paths only after telemetry shows zero unapproved callers for the agreed period. Legacy read support remains for immutable historical atoms.
- Reason: on-chain history cannot be migrated away.
- Approvers: program lead, API/product owners

## D17 — Atom embeddings

- Status: proposed
- Decision: this program adds resolved lexical/search fields and schema future-proofing but does not create a new atom semantic-embedding pipeline in Core.
- Reason: no such Core subsystem exists today; importing the private application design would expand scope without a proven Core requirement.
- Approvers: search/data owner, program lead

## D18 — First production canary

- Status: proposed
- Decision: use one deterministic, unambiguous P0 scheme—provisionally ISRC—with a small internal allowlist and representative context URIs.
- Reason: isolates infrastructure correctness from polymorphic classification decisions.
- Approvers: program lead, domain owner, operations

## D19 — Forward-compatible event-store type boundary

- Status: ratified for the Core migration
- Decision: `event_store.event_type` is no longer governed by a closed-world PostgreSQL `CHECK` whitelist. Event admission is governed by the exact contract ABI and generated Rindexer decoder; typed reconstruction is governed by the Rust `EventType`/`ParsedEvent` exhaustiveness checks and per-event typed tables. Unknown raw events remain observable instead of requiring a schema migration for every new protocol event.
- Reason: on a real TimescaleDB instance with compressed chunks, extending the existing table constraint is not an online-safe operation: adding the replacement check failed against columnstore chunks, `ALTER TABLE ONLY` was unsupported, and disabling columnstore required decompression. Dropping the obsolete whitelist succeeded without decompressing or rewriting historical chunks. Keeping the whitelist would make ordinary additive protocol events operationally destructive.
- Guardrails: ABI drift CI, generated decoder review, raw/typed dual-write parity, typed-table constraints, exhaustive Rust conversions, dead-letter handling, and bounded unknown-event metrics replace the brittle database whitelist. This decision does not weaken per-event payload validation or typed-table constraints.
- Approvers: Core data/indexing architecture; security/release owner to review before production rollout
