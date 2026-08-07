# Executive overview

## The change in one sentence

Atom data is moving from being the descriptive record to being a deterministic identity anchor; description and display data become a versioned, provenance-bearing projection produced by resolvers and claims around that anchor.

The new flow is:

```text
on-chain atom bytes + AtomContextRegistered URIs
                         |
                         v
             profile-aware IID parser
                         |
              +----------+----------+
              |                     |
       deterministic type      resolver plan
       and identity facts       (networked, retryable)
              |                     |
              +----------+----------+
                         |
         normalized artifacts + provenance
                         |
        API/search/display projections and clusters
```

For an ISRC-backed recording, the canonical anchor is a valid value such as:

```text
int:isrc:USRC17607839
```

The example `int:src:132456798` should not enter code or fixtures: `src` is not a registered scheme and the sample value is not a canonical 12-character ISRC.

## What changed at the protocol boundary

The URI-enabled contract introduces:

- `createAtomsWithUris(address creator, bytes[] atomDatas, uint256[] assets, bytes[][] uris)`
- `AtomContextRegistered(bytes32 indexed termId, address indexed registrant, bytes[] uris)`
- URI configuration exposed through `getAtomUriConfig()`; current defaults are five URIs per atom and 700 bytes per URI
- a fee-proxy path, `createAtomsWithUrisVia`

URIs are opaque event bytes. They are not stored in contract state and are excluded from atom-ID calculation. The event is only emitted when a non-empty URI list is supplied. In a batch, all atom/deposit events are emitted before context events, so log adjacency is not a valid correlation strategy.

## What changes in the data model

The backend currently treats atom bytes as the descriptive source of truth:

1. parse JSON/IPFS/URL data;
2. infer `@type` or classify a URL;
3. choose enrichment plugins from the type/URL;
4. store the parsed/enriched result on the node.

That fails for a P0 IID. Today a bare `int:isrc:...` is a plain string, has no URL, cannot select the Spotify/music resolver path, and is normally skipped by enrichment.

The new backend must represent four distinct concepts:

| Concept | Meaning | Mutability |
| --- | --- | --- |
| Atom payload | Exact on-chain bytes and detected profile | Immutable |
| Identity | Canonical IID, scheme, class, and cluster membership | Derived deterministically; cluster edges are reversible |
| Context | URI event evidence supplied at creation | Immutable event, mutable processing status |
| Enrichment | Provider responses and normalized display/search data | Refreshable and versioned |

`data_resolved` can remain as a compatibility projection, but it must stop pretending to be the atom's identity or the only source of provenance.

## The work that must land

1. **Freeze the shared interpretation contract.** Every consumer needs the same profile detection, IID validation, scheme typing, classification result, and resolver target structure.
2. **Sync the contract surface.** Update ABI/package artifacts, Rindexer event declarations, Rust event types/handlers/readers, and URI projections.
3. **Add IID parsing before generic strings.** Support P0, P1, P2, and legacy payloads, with a quarantine path for malformed or unknown IIDs.
4. **Split classification from resolution.** Classification must remain deterministic; network calls produce enrichment artifacts through scheme-specific resolvers.
5. **Add identity/context persistence.** Keep exact bytes, normalized identifiers, context-event provenance, resolver state, and identity-cluster membership separately.
6. **Move seed output to identity ladders and profiles.** Derive the highest usable canonical IID, choose P0/P1/P2, compute the atom ID from the final bytes, and submit aligned URI arrays.
7. **Update writes and reads together.** SDK/app creation, API ingestion, search, and explorer display all need dual-format support.
8. **Backfill without rewriting history.** Compute identifiers for legacy atoms off-chain, cluster related atoms, and only mint new anchors under an explicit policy.

## Critical path

The parallel work starts only after a 60–90 minute interface freeze covering:

- spec/package version and registry hash;
- the shared `AtomInterpretation` and resolver contracts;
- P0/P1/P2 selection policy;
- URI allowlist, ordering, decoding, and retention policy;
- database table/column names and API compatibility shape;
- contract address, deployment block, ABI version, and supported write route.

After that freeze, Tracks A–D can work in parallel against the same golden fixtures. Track E integrates in this order:

```text
additive DB migration
  -> ABI and context-event ingestion
  -> IID parsing/classification/resolution
  -> API/read compatibility
  -> seed and mint writers
  -> replay/backfill
  -> IID-default flag
```

## What fits in one to two days

A focused switch can deliver the minimum safe vertical slice:

- valid P0/P1 detection and IID persistence;
- scheme-driven classification and an ISRC resolver path;
- URI event indexing and API exposure;
- profile-aware seed output;
- dual-read compatibility and end-to-end fixtures;
- feature-flagged rollout with additive schema and rollback.

It should not pretend to finish the entire equivalence product. Candidate generation, attestation thresholds, union-find dispute behavior, broad resolver coverage for all 26 schemes, and opportunistic re-minting are follow-up phases. The minimum slice should create stable extension points for them rather than implementing partial heuristics in the hot path.

## Success criteria

The switch is successful when one golden P0 ISRC atom can be minted with context URIs, indexed after replay, classified as `MusicRecording` without reading JSON-LD, enriched through the selected resolver(s), searched and rendered through the API, and joined to any legacy atom carrying the same derived IID—with repeat processing producing no duplicate state.

