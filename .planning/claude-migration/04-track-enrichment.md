# Track 4 — Enrichment: Identifier-Keyed Providers

**Owner:** 1 engineer (TypeScript; owns `packages/atom-enrichment`, the enrichment worker stage, and `services/atom-services`)
**Repo:** `intuition-core`
**Mission:** enrichment is triggered and keyed by the parsed identifier (`{isrc: 'USSM10007459'}`) instead of by a `sameAs` URL scraped from atom JSON. Providers gain lookup-by-identifier paths; on-chain URIs serve as the secondary URL-shaped path; unenrichable schemes skip cleanly.

**Depends on:** Track 3's `CompactParseResult.identifiers` shape (agree at standup, then develop against hand-built fixtures — don't wait for the parser to merge).

## 1. The inversion in one paragraph

Today: JSON atom → `structured-targets` picks a `sameAs` URL → plugin `supports(request)` matches URL shape → provider scrapes/queries by URL. After: identifier atom → `hints.identifiers = { isrc: '…' }` → plugin `supports()` matches on identifier presence → provider queries its API's *lookup-by-identifier* endpoint (Spotify search `isrc:` filter, MusicBrainz `/recording?query=isrc:…`, OpenLibrary by ISBN, Wikidata by QID, Crossref by DOI). The plumbing hook **already exists**: `packages/atom-enrichment/src/plugins/providers/__shared__/request.ts:65` `getIdentifier(request, ...keys)` reads `request.input.hints.identifiers`, and the **crossref provider already keys off `doi` this way (line 103)** — it is the reference pattern for every provider you touch.

## 2. Work items

### 2.1 Types & request plumbing (`packages/atom-enrichment`)

- `src/types.ts` — extend `enrichmentRequestSchema` (line 213) / hints schema so `identifiers: Record<string,string>` plus `identifierScheme`/`canonical` flow through validation; add an identifier-shaped variant to `classifiedAtomTargetsSchema` where targets are currently URL-only.
- `src/plugin-registry.ts` / presets — register updated providers; ensure `supports()` short-circuit order prefers identifier lookups over URL scraping when both are present.
- Cache keys: canonical IID (stable, byte-exact) — check enrichment cache tests.

### 2.2 Providers (priority order per decision D-8 — match live seed lanes)

| Priority | Provider dir (`src/plugins/providers/`) | Identifier | Lookup path |
|---|---|---|---|
| 1 | `spotify` | `isrc` | `resolveSpotifyTarget` (`index.ts:34`) currently URL-shaped; add ISRC branch → Spotify search `q=isrc:USSM10007459&type=track` |
| 1 | `musicbrainz` | `isrc`, `mbid` (typed) | ISRC lookup + direct MBID fetch per entity type |
| 2 | `isbn` | `isbn` | already ISBN-centric; accept identifier input directly (no URL) |
| 2 | `wikipedia` | `wd` | QID → Wikidata entity + sitelink → Wikipedia summary |
| 2 | `crossref` | `doi` | **already works via `getIdentifier` — verify + fixture, likely zero code** |
| 2 | `ens` / `nft-metadata` / existing ethereum path | `caip10`, `caip19` | address/chain extracted from CAIP value |
| 3 | `apple-music` | `isrc` | iTunes lookup by ISRC (the v2 extraction layer already chains Spotify→iTunes ISRC) |
| 3 | `podcast-index` | `podcastguid` | Podcast Index lookup by feed GUID |
| 3 | `tmdb` | `tmdb:movie/tv`, `imdb` | direct ID fetch / find-by-external-id |
| — | everything else (opengraph, favicon, screenshot, oembed…) | — | unchanged; they run off URL targets — including **on-chain URIs** (see 2.4) |

Schemes with no provider this sprint (`gtin`, `lei`, `geo`, `purl`, `appid`, `acct`, `gen1`, …): enrichment status `skipped` with reason `no-provider-for-scheme` — must be a clean skip, not an error loop.

### 2.3 Worker enrichment stage (`services/workers`)

- `src/core/enrichment.ts` —
  - `deriveEnrichmentPlan` (line 55): currently keyed on `targetUrl` + classification; add identifier-keyed planning (scheme+classification → provider set). Keep URL planning as the fallback chain.
  - `buildClassifiedInputFromPlan` (line 73): **stops synthesizing a JSON-LD envelope from atom data for identifier atoms** — build the engine input from `{identifiers, classificationType, urls}` instead. This is the deepest assumption-break in the file; budget time here.
  - Artifact-type allowlists (lines 11–35) and `isSpotifyTrackUrl` gating (135–138): add identifier-equivalents (an ISRC atom is in scope for MUSIC/SPOTIFY_TRACK artifact kinds without any URL).
- `src/kg/atom-enrichment/index.ts` — runtime input to `engine.enrich(...)` (line 150-152) carries the identifier fields; artifacts written as today (`kg.artifacts.source_uri` = canonical IID for identifier-sourced artifacts).
- Post-enrichment promotion: display name from artifacts must land in `search_text`/`data_resolved` so P0 anchors become renderable (decision D-5) — verify the existing promotion path does this once artifacts exist; fix if it only triggers off structured documents.

### 2.4 On-chain URIs as enrichment inputs

`kg.node_urls` rows with `source='onchain'` (Track 2) + threaded candidates from Track 3: treat them exactly like `sameAs` URL candidates today — they feed opengraph/oembed/provider-URL paths when identifier lookup yields nothing or as supplements. Per decision D-7, `uris` entries that are themselves IIDs are **stored but not enriched** this sprint.

### 2.5 `services/atom-services`

- HTTP schemas for `POST /v1/classify | /v1/enrich | /v1/process | /v1/process/batch` (`src/app.ts:111-185`) accept identifier-shaped input (a bare `int:…` string should be a valid `process` input).
- Runtime wiring `src/service/{runtime,processing,dependencies,persistence,batch-store}.ts` — co-owned with Track 3 where the shared `@0xintuition/atom-services/runtime` interface changes.
- Cache provider config unchanged; confirm keys.
- Shared artifact types: `packages/types/src/enrichment/artifacts.ts` if any provider adds new artifact fields.

## 3. Interfaces to agree at standup

- `identifiers` map shape from Track 3 (scheme-keyed record; compound schemes like `mbid` pre-split into `{ mbid: 'artist:<uuid>' }` vs `{ mbid_artist: '<uuid>' }` — pick one, recommend keeping raw value + separate `inValueType`).
- Engine runtime input schema change (with Track 3 — both stages call `@0xintuition/atom-services/runtime`).
- Which artifact kinds Track 6's smoke test asserts (pick Spotify track fields).

## 4. Definition of done

- [ ] Fixture-level: `{isrc: 'USQX91300108'}` ⇒ Spotify + MusicBrainz artifacts with track metadata, no URL involved anywhere in the request.
- [ ] `int:isbn:9780684832722`, `int:wd:Q42`, `int:doi:10.1000/182` each produce their provider's artifact via identifier lookup.
- [ ] Unenrichable scheme (`int:geo:9q8yyk8y`) ⇒ clean `skipped`, worker lease completes, no retry loop.
- [ ] Legacy JSON-LD atom with Spotify `sameAs` URL enriches exactly as before (regression).
- [ ] End-to-end on devnet with Tracks 1–3: `int:isrc:…` atom reaches `enrichment_status=completed` with artifacts, and `search_text` shows the track name afterward.
- [ ] atom-services `POST /v1/process` with body input `int:isrc:…` returns classification + enrichment.

## 5. Out of scope

- Providers beyond the priority table (add stubs/skips only).
- Enriching secondary identifiers from `uris` (D-7).
- `atom-rules-engine` identifier rules (no in-repo consumer; ticket it for the app teams).
