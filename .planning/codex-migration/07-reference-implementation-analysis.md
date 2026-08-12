# Reference implementation analysis

## Why the private implementation matters

The private application monorepo demonstrates the semantic half of this migration across real application surfaces. Its useful architecture is a sequence of explicit stages:

```text
DERIVE -> RECOGNIZE -> RESOLVE + INDEX -> RENDER -> EMIT -> OPERATE
                    PUBLISH and DEPRECATE run alongside the sequence
```

Core should preserve these boundaries. They make it possible to turn on readers before writers, retry external resolution without changing identity, and validate each handoff independently.

## Proven patterns to carry into Core

### A pure IID grammar package

The implemented `@0xintuition/iid` module establishes the correct low-level boundary: parsing, canonicalization, profile handling, and deterministic serialization are pure operations. They do not make network calls and do not own provider routing.

Core should consume this implementation rather than grow another parser. All language implementations must share golden fixtures, especially for values containing colons, mixed-case identifiers, Unicode, and invalid closed-registry schemes.

### A semantic bridge between identity and classifications

The implemented `@0xintuition/iid-registry` boundary owns questions such as:

- Which classification, if any, follows from this IID?
- Which providers can resolve this scheme or typed profile?
- Which identifier hints can be extracted without a network call?
- Is the scheme unambiguous enough for P0?

This is the most important reusable boundary. Core parser, classification, enrichment, seed, and UI code must not each maintain their own scheme maps.

The private implementation also proved several decision outcomes that should be ratified for public packages: `eidr` maps to movie, `iswc` remains unclassified, MusicBrainz release maps to album, MusicBrainz label maps to company, and CAIP-19 maps only for the supported ERC-20 subtype.

### Identifier-first enrichment

The private backend stopped requiring a legacy JSON-LD document or provider URL as the entry point. It creates a resolution plan from the IID, invokes providers, stores artifacts with provenance, and projects a stable resolved view. This is the target for Core workers.

Important details to copy:

- Provider routing means desired semantic capability, not merely a matching hostname.
- Authentication, throttling, and transient provider failures remain retryable.
- A source URI may be derived from the IID when the provider supports it, but it is not the identity.
- Projection populates display/search fields from resolved artifacts and classification hints; it never substitutes raw `int:...` text as the user-facing label.
- Worker handoffs carry an explicit identity object rather than reparsing ad hoc strings.

### Read-before-write deployment

The private plan correctly treated search and display as part of the read path. “The backend parses IID” is not enough. Core's read gate includes parsing, database representation, resolution, API shape, explorer rendering, search purity, failure handling, replay, and observability.

### Golden-fixture integration

The private implementation has a cross-layer golden fixture. Core should extend that model to include the on-chain URI event and the public package tarballs. One fixture must be executable in each repository and assert the same canonical bytes, classification, provider plan, atom ID, and normalized context.

## What does not port directly

### The public classification model is different

The private IID code uses executable source callbacks. The public `classifications` repository now contains declarative `IdentitySpec` ladders (`ladder`, `IdentityValueSource`, and recipe fields). The public design is preferable as the source of semantic metadata, but the two representations must be reconciled deliberately. Copying the private package wholesale would create two classification models.

The target is:

1. `iid` owns grammar and canonicalization types.
2. `classifications` declares identity ladders using those shared types.
3. `iid-registry` interprets those declarations and exposes stable lookup APIs.
4. Builders and Core consume the registry, not declaration internals.

### URI context was outside the private migration

The private plan explicitly treated contract URI support as separate future work. Core is the first system that must integrate it end to end. None of the private backend tables, event workers, or frontend seams should be assumed to cover `AtomContextRegistered`.

### Core is an event-indexed platform, not the same application backend

Core's chain flow is Rindexer -> event store/typed tables -> projections -> knowledge graph/API. The private backend model cannot be transplanted directly. The semantic contracts port; the persistence and replay implementation must follow Core's event architecture.

### Core does not currently have atom semantic embeddings

The private search/embedding work includes application-specific semantic embedding paths. Core currently uses vector infrastructure for other domains, not atom semantic embeddings. This migration should add lexical/search/display guards and a future-safe resolved schema, but must not invent an atom embedding subsystem merely for parity.

### The private canonical builder is not yet a public contract

The private plan proposed a single `buildAtomAnchor` seam, but the currently inspected implementation still contains local derivation and identifier injection. Core should not depend on that incomplete seam. The public package track must define, test, and publish the canonical builder first.

## Reference-to-Core mapping

| Private concept | Core destination | Adaptation required |
| --- | --- | --- |
| IID parser/canonicalizer | public `iid`; Core atom parser | publish package and share fixtures |
| IID registry | public `iid-registry`; classification/enrichment workers | interpret public declarative ladders |
| Identifier-first enrichment | atom enrichment workers | use Core queues, artifacts, retries, and projections |
| Raw/resolved split | KG identity/context/artifact tables and node projection | preserve event replay and legacy rows |
| Search/display guards | API and explorer | Core-specific queries and UI states |
| Golden fixture | package CI + Core integration suite | add ABI/event/URI assertions |
| Writer migration | seed and atom creation services | use URI-aware contract method and public builder |

## Review method for future changes

When the private implementation advances, classify each change as one of:

- **semantic contract** — consider upstreaming to public packages;
- **application adapter** — port only its interface expectation;
- **private product behavior** — do not copy into Core;
- **bug fixture** — add to the shared conformance corpus.

This keeps the private monorepo useful as a proving ground without allowing it to become an undeclared second source of truth.
