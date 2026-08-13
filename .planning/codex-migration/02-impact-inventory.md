# Impact inventory

This inventory records the current behavior, why it fails for IID-first atoms, and the required change. Paths are relative to `intuition-core` unless explicitly identified as another repository.

## Contract packages and deployment artifacts

### Current state

- The current Rindexer ABI at `crates/rindexer-ingestion/abi/MultiVault.json` has no `AtomContextRegistered`, `createAtomsWithUris`, or `getAtomUriConfig`.
- `crates/rindexer-ingestion/rindexer.yaml` subscribes to the existing atom, triple, vault, and fee events only.
- Core's generated Rust bindings therefore cannot represent the new event.
- The URI-enabled source exists in `intuition-contracts-v2`, while checked-in copies and older documentation elsewhere may still describe the pre-URI interface.

### Required change

- Publish/sync one authoritative contract artifact and version across Core, SDK, app, and seed tooling.
- Add the new call routes and event to generated clients and bindings.
- Pin the deployed address and start block per network.
- Verify approval semantics when `creator != msg.sender` and decide whether clients use `createAtomsWithUris` directly or `createAtomsWithUrisVia`.
- Add ABI drift checks to CI so a future contract change cannot silently bypass ingestion.

## Rust/Rindexer ingestion

### Current state

- `crates/rindexer-ingestion/src/handlers.rs`, generated event handlers under `src/rindexer_lib`, `crates/shared/src/parsed_event.rs`, storage, and typed readers only cover existing event variants.
- `migrations/timescale/002_create_typed_event_tables.sql` and related Timescale schema code have no atom-context event table.
- Atom creation stores atom data bytes, but there is no durable path for creation-time context.

### Required change

- Regenerate Rindexer output after ABI/config changes; do not hand-maintain generated code.
- Add `AtomContextRegistered` to shared event enums, parsed records, storage, typed readers, and metrics.
- Preserve `bytes[]` losslessly and store transaction/log provenance.
- Join to terms by `term_id`, tolerate context arriving after node projection, and make the projection idempotent.
- Exercise replay, canonical/reorg behavior, empty URI lists, binary/non-UTF-8 bytes, duplicate URIs, and multi-atom batches.

## Atom parser

### Current state

- `packages/atom-parser/src/types.ts` recognizes IPFS, Ethereum address, ENS, JSON, URL, ISBN, and plain strings.
- `packages/atom-parser/src/parse.ts`, `detect.ts`, and `structured.ts` favor JSON-LD and URL discovery.
- A bare IID currently falls through to `plain_string`.
- Structured payload handling knows `@context`, `@type`, and `sameAs`, but not representation profiles.

### Required change

- Add IID detection before generic string detection.
- Parse P0 bare IIDs and P1/P2 JSON `identifier` values with the same validator.
- Return scheme, value, class, typing, profile, canonicality, registry version, and validation errors.
- Keep the exact input bytes/string; do not silently rewrite an invalid on-chain IID.
- Reject unknown/non-canonical IIDs on new API writes while quarantining rather than dropping historical data.
- Add shared golden fixtures for values containing additional colons, maximum-length values, unknown schemes, non-ASCII, and profile eligibility.

## Classification packages

### Current state

- `packages/atom-classification` classifies URL/raw input and exposes URL-oriented plugins.
- Core consumes `@0xintuition/classifications@0.1.0-alpha.0` in `packages/atom-enrichment`, while the IID-enabled implementation is a workspace package in `intuition-v2`.
- Worker classification in `services/workers/src/core/classification.ts` derives directly from structured `@type` or calls the current classification runtime.
- Music routing is based on classification category/schema type and recognized provider URLs.

### Required change

- Publish/pin compatible `@0xintuition/iid` and `@0xintuition/classifications` versions or vendor them through one controlled workspace boundary.
- Make identity ladders and scheme typing the only write-side identifier selection policy.
- Add deterministic `scheme/value -> classification` routing where the mapping is exact.
- Require P1/P2 type evidence for polymorphic schemes; provider-derived typing may enrich or flag a conflict but must not retroactively make an invalid P0 valid.
- Extend classification results with IID source, confidence, and resolution targets.
- Preserve legacy URL/raw classification as a compatibility adapter.
- Add missing taxonomy decisions for schemes such as ISWC and polymorphic provider entities before claiming full registry coverage.

## Enrichment packages and atom services

### Current state

- `packages/atom-enrichment/src/engine.ts`, `plugins.ts`, extraction helpers, and classification registry select work from classified input and URL candidates.
- `services/workers/src/core/enrichment.ts` and `structured-targets.ts` expect a target URL or structured object; a P0 IID provides neither and is skipped.
- `services/atom-services/src/service/processing.ts` follows classify-then-enrich behavior designed for current raw inputs.
- `ClassifiedAtomInput` has limited atom-type hints and does not carry the full IID interpretation/resolver plan.

### Required change

- Introduce identifier resolver targets as first-class inputs.
- Add scheme resolver adapters with explicit provider/version/cache/provenance behavior.
- Implement ISRC as the first required vertical slice: exact `MusicRecording` classification, registry lookup, provider matching, and normalized artifacts.
- Use context URIs as ranked hints. Validate/allowlist them and retain their origin; never treat presence of a Spotify URL as stronger identity than the IID.
- Store resolver outcomes independently so retry, refresh, and provider outages do not re-run or mutate identity.
- Update atom-services `/process` and batch/cache keys for IID input.
- Preserve existing URL enrichment as a legacy resolver target.

## Workers and orchestration

### Current state

- `services/workers/src/kg/atom-parsing`, `atom-classification`, and `atom-enrichment` implement leased, retryable stages.
- `services/workers/src/kg/processing.ts` and reconciliation code carry current stage state.
- The parser promotes structured data into `data_resolved` and search text; classification/enrichment assume payload-derived targets.

### Required change

- Keep the existing lease/retry/reconciliation mechanics.
- Insert profile/IID interpretation into parsing and persist it before classification.
- Make classification deterministic and independently complete even when resolution is pending or failed.
- Queue resolution by stable target key, deduplicate across atoms with the same IID where safe, and fan results back to cluster members.
- Introduce explicit statuses for invalid identity, no resolver, retryable provider failure, permanent provider miss, and completed resolution.
- Ensure search/display projection updates are atomic with artifact selection and are safe to replay.

## Knowledge-graph database

### Current state

- `packages/database-kg/src/schemas/kg/nodes.ts` and initial migration constrain `raw_type` to `string`, `json`, `http_uri`, or `ipfs_uri`.
- Nodes carry `data`, `data_hex`, `data_resolved`, classification/enrichment state, and `search_text`.
- `kg.artifacts` stores enrichment payloads and `kg.node_urls` stores source/provenance/artifact/primary URLs.
- There are no normalized IID, context-event, or identity-cluster structures.

### Required change

- Add normalized node identifiers and context URI projections.
- Either add `iid` to `raw_type` or add a separate profile field; keep old values valid.
- Add indexes for IID lookup, scheme/status queues, context `term_id`, and cluster membership without making IID globally unique.
- Add reversible identity clusters with separate identity-canonical and display-canonical members when Layer 2 is enabled.
- Version the interpretation and display projections.
- Update schema exports, actions, generated Drizzle snapshots, migrations, and migration tests.
- Keep artifact payload/provenance separate from `data_resolved`; use the latter as a compatibility materialization.

## Timescale/event database

### Current state

- The raw event store and typed tables retain chain history and projection checkpoints.
- `term` stores atom data/data hex, but no URI context.

### Required change

- Add a typed context-event table and schema bindings.
- Preserve raw URI bytes or hex plus array ordering.
- Index `term_id`, block/transaction/log identity, and canonical status.
- Add projection checkpoint/dead-letter observability for the new event.
- Backfill/replay only from the contract upgrade/deployment boundary after validating network configuration.

## API and explorer

### Current state

- `services/api/src/app.ts` and schema accept raw atom data and detect existing raw types.
- Atom responses expose current node/classification/enrichment fields.
- `apps/explorer` presents raw data and classification but has no identity/profile/context model.

### Required change

- Validate canonical IIDs on creation endpoints and return actionable errors.
- Add backward-compatible identity, context URI, resolver status, and cluster/canonical fields to reads.
- Define whether APIs return raw event bytes, sanitized decoded URIs, or both; default public output should be safe and size-bounded.
- Update search to index both IID and selected hydrated fields.
- Update explorer cards/details to show the IID/profile and distinguish context sources from enrichment sources.
- Continue rendering legacy atoms with no IID.

## Seed data control plane

Location: `/Users/metasudo/workspace/intution/workspace/intuition-v2/packages/database-seed-control-plane` and related import scripts.

### Current state

- Candidate, processing, enrichment, and write jobs are already separated and resumable.
- `deriveAtomData` builds enriched JSON-LD, calculates the node ID from that description, and writes it as JSON with completed processing stages.
- `WRITE_PROJECTION_VERSION` is currently `atom-v4`.
- Existing identifier projection includes legacy strings such as `isrc:...`, `spotify:track:...`, and other provider IDs that are not necessarily registered IIDs.

### Required change

- Replace ad hoc identifier strings with the registered IID library and classification identity ladders.
- Choose the highest usable rung and record why lower rungs were skipped.
- Emit P0 bare bytes only when anchor-eligible; emit deterministic P1 for Class C/polymorphic cases; keep P2 opt-in.
- Move source/provider URLs to the URI array and/or artifact provenance rather than identity bytes.
- Recompute expected atom/node IDs from final serialized bytes and bump the write projection version.
- Add ledger fields for IID, scheme, identity class, profile, resolver plan/status, context URIs, serializer/library versions, old/new IDs, and dedupe decision.
- Reproject only safe, unwritten/held jobs automatically. Treat already-on-chain atoms as immutable and backfill/cluster them instead.
- Produce a mint-ready manifest even if the current control plane writes only off-chain KG rows; the on-chain submitter must preserve `atomDatas/assets/uris` alignment.

## SDK and application creation

Location: primarily `intuition-v2` application/contracts helpers.

### Current state

- Current create flows still construct descriptive JSON-LD and use the older atom creation helper.
- `buildAtomDataObject` can inject identifiers only as an opt-in and does not by itself implement profile selection.

### Required change

- Introduce a profile builder (`buildAtomAnchor`/equivalent) backed by the pinned IID/classification packages.
- Update simulation, fee estimation, approval, submission, receipt parsing, and batch behavior for the URI-enabled method.
- Validate contract URI limits at runtime and surface per-item errors before wallet confirmation.
- Record exact bytes and expected atom IDs in UI/SDK results.
- Gate IID-default minting independently from dual-read support.

## Observability and operations

Add metrics and dashboards for:

- payload counts by P0/P1/P2/legacy/invalid;
- valid/invalid/canonical IID counts by scheme;
- context events and URIs per atom, decoding failures, and orphan joins;
- resolver queue depth, hit/miss/retry/permanent-failure rate, latency, and provider throttling;
- enrichment freshness and selected display artifact;
- same-IID cluster size and classification conflicts;
- seed profile distribution, deterministic rerun mismatches, and submitted/expected ID mismatches.

