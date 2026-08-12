# Intuition Core file and subsystem change map

This is an implementation map, not a substitute for code-level discovery in each PR. Paths name current ownership seams; generated filenames may change after ABI synchronization.

## Contract artifacts and Rindexer

### `packages/contracts`

Current role: exact `@0xintuition/contracts-v2` dependency, local devnet deployment, vendored ABI/bytecode/address artifacts.

Changes:

- Bump the exact contracts artifact to the URI-enabled release.
- Regenerate vendored artifacts; never hand-edit generated ABI.
- Extend devnet deployment/config tests to read `getAtomUriConfig`.
- Add an ABI parity test against the exact public `@0xintuition/protocol` release.
- Document whether activation blocks belong in public deployments or Core-local addresses.

### `scripts/sync-abis.ts` and Rindexer configuration/generated code

Changes:

- Include `AtomContextRegistered` in ABI synchronization and configured events.
- Regenerate handlers/types through the existing workflow.
- Assert event signature, indexed `termId`, creator, and ordered `bytes[]` representation.
- Add fixture decoding against a real encoded log, not only hand-built objects.

## Event store and shared event types

### Event type/model/storage layer

The current event domain models six protocol events. Add `AtomContextRegistered` everywhere the event union is assumed exhaustive:

- shared `EventType` and `ParsedEvent` variants;
- raw event normalization;
- typed event database model/table;
- handler persistence;
- typed event reader used by projections/replay;
- metrics and dead-letter/error reporting.

Create the new typed table with `sequence_number` from its first migration. Preserve raw context entries as hex/bytes and store normalized URI interpretation separately. The event is associated by `termId`; log order or transaction adjacency is never a join key.

## Projections and knowledge graph

### `crates/projections`

Changes:

- Consume the new typed context event.
- Upsert context idempotently using chain/event identity.
- Join to the atom/node through `termId`, tolerating event-before-node projection timing.
- Preserve URI array order and duplicates in raw evidence; expose a normalized deduplicated list separately.
- Requeue/reconcile orphan context rows when the corresponding atom projection arrives.
- Ensure replay from any safe checkpoint converges.

### Knowledge-graph schema/actions

Add or evolve storage for:

- canonical identity (`raw`, `canonical`, `profile`, `scheme`, `value`, parse/version/status);
- atom context (`raw bytes`, normalized URI if valid, ordinal, event provenance);
- resolution artifacts (`provider`, request key, fetched-at, resolver version, raw payload/reference, status);
- resolved node projection (`classification`, label, description, image, links, search text, provenance/version).

Do not overload the existing raw atom `data` column. Identity, evidence, and materialized presentation have different lifecycles.

### `packages/database-kg/src/actions/ids.ts`

Replace duplicate atom/triple hashing logic with thin wrappers over `@0xintuition/ids`. Preserve Core's existing input normalization at the boundary. Add parity tests for IID UTF-8 bytes, hex bytes, legacy JSON bytes, and triples.

### Node creation/search defaults

Audit `ensureNodeWithCreation` and all callers that default `searchText` to raw `data`. For IIDs, initialize search state as unresolved or use safe canonical hints; never promote the opaque raw IID as the final display/search document.

## Atom parser

### `packages/atom-parser`

Changes:

- Add `iid` to the raw type domain and database-compatible enum/check constraint.
- Run IID recognition before generic URL/string handling.
- Delegate validation/canonicalization to `@0xintuition/iid`.
- Return structured identity details and typed parse failures.
- Preserve legacy JSON, HTTP URI, IPFS URI, and string behavior.
- Add fixtures for colon-bearing values and lookalike `int:` strings.

The parser recognizes syntax and identity. It does not fetch providers or guess semantic types.

## Classification worker

### Classification packages/workers

Current behavior primarily classifies structured `@type` values or raw content. Add an IID-first branch:

- consume parsed canonical identity;
- call `@0xintuition/iid-registry`;
- persist inferred classification with source `iid-registry`, package/version provenance, and confidence/totality state;
- leave polymorphic/unmapped classification absent rather than guessing;
- retain the legacy classifier for non-IID atoms.

Classification output should be idempotent and re-projectable when registry versions change.

## Enrichment worker

### `packages/atom-enrichment` and worker services

Current behavior can return no work when there is no structured document/provider URL. Add identifier-first planning:

- derive providers and identifier hints from the registry;
- invoke providers by desired capability and typed identifier;
- persist raw artifacts before projection;
- separate retryable transport/auth/rate-limit failures from terminal unsupported/invalid identities;
- version provider adapters and projection logic;
- generate resolved node fields and search text without mutating canonical identity;
- schedule reconciliation when new provider coverage is deployed.

Remove any local scheme/provider mapping once equivalent public registry behavior exists. The published `classifications` version currently used by Core must be upgraded as part of the coordinated release.

## Database migrations

Migrations must be additive and deployable before code that writes new states.

Required changes:

- extend the atom raw-type constraint/enumeration with `iid`;
- add identity and canonicalization status/version columns or a normalized identity table;
- add atom-context event/evidence storage and indexes on `termId`;
- add artifact/projection provenance and resolution status where absent;
- add partial indexes for IID scheme/value and unresolved/retryable work;
- retain nullability/defaults that let old binaries operate during rolling deployment;
- include forward-only rollback strategy: disable new code, do not drop data.

Backfill should be chunked, resumable, observable, and use the same domain functions as live processing.

## API

### Atom read endpoints

Return an additive shape similar to:

```json
{
  "raw": { "type": "iid", "data": "int:isrc:..." },
  "identity": { "canonical": "int:isrc:...", "profile": "p0", "scheme": "isrc", "value": "..." },
  "classification": { "type": "MusicRecording", "source": "iid-registry" },
  "context": [{ "uri": "https://...", "ordinal": 0, "source": "onchain" }],
  "resolution": { "status": "resolved", "updatedAt": "..." },
  "display": { "name": "...", "image": "..." }
}
```

Keep legacy fields during the compatibility window. Do not silently replace raw data with resolved data. Add filters/search facets for scheme, classification, resolution status, and context presence as justified by consumers.

### Atom write endpoint

The current raw-data POST path is not sufficient as a canonical IID writer. If Core owns atom submission, add a structured builder-backed request that accepts identity inputs plus URI context, returns a dry-run/predicted anchor, and calls the URI-aware protocol method. If Core remains read-only and applications own minting, explicitly deprecate or constrain the existing endpoint so it cannot become a second builder.

## Explorer

Replace raw-data-only presentation with distinct sections:

- raw on-chain atom data;
- parsed/canonical identity and profile;
- inferred classification and its source;
- on-chain context URIs in ordinal order;
- resolution status, provider artifacts, and provenance;
- resolved display fields;
- clear unresolved/retry/error states.

Search results should prefer resolved labels, show a compact IID secondary label, and remain navigable before enrichment succeeds.

## Seed and bulk creation

Core seed/bulk jobs must:

- map source records to typed identity inputs;
- use the public canonical builder;
- validate canonicalization, P0 eligibility, duplicates, URI limits, and atom-ID expectations offline;
- write a reviewable manifest before upload or transaction submission;
- use `createAtomsWithUris` with exactly aligned `atomDatas`, `assets`, and `uris` outer arrays;
- record transaction/batch/atom results in an idempotent resume ledger;
- re-read indexed output as the final acceptance test.

Legacy source documents may remain in seed provenance storage, but they are not the default atom bytes.

## Configuration and observability

Add configuration for:

- IID reader enablement and per-scheme writer allowlists;
- provider credentials, concurrency, rate limits, and circuit breakers;
- resolver and projection versions;
- backfill cursors/chunk sizes;
- URI normalization policy and contract-limit cache;
- emergency writer disable.

Metrics/log dimensions:

- IID parse outcome by scheme/profile/version;
- context events received/projected/orphaned/malformed;
- provider request outcome and latency by provider/scheme;
- resolution and projection status/age;
- search/display fallback use;
- builder validation failure and writer outcome;
- ABI/fixture version deployed.

Never log provider secrets or full sensitive payloads. Raw external artifacts follow explicit retention and redaction policy.
