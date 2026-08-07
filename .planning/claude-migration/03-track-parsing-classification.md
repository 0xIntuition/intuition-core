# Track 3 — Atom Parser & Classification Packages

**Owner:** 1 engineer (TypeScript; owns `packages/atom-parser`, `packages/atom-classification`, the parse/classification worker stages, and the shared `@0xintuition/iid` adoption)
**Repo:** `intuition-core` (+ coordination on publishing `@0xintuition/iid` from intuition-v2)
**Mission:** an `int:` atom is detected as a first-class `intuition_identifier` kind, validated/canonicalized via `@0xintuition/iid`, and classified instantly from its scheme with no network fetch. Legacy JSON-LD/URL/IPFS paths keep working untouched.

## 1. Foundation: `@0xintuition/iid`

Everything in this track consumes the already-shipped package from `intuition-v2/intuition/iid` (`parseIntuitionId`, `validateIntuitionId`, `isIntuitionId`, per-scheme canonicalizers, `SCHEME_TYPING`, `isAnchorEligible`, 92 golden tests). Per decision D-3: publish it to npm (preferred) or vendor it into `packages/`. **Do this first — Tracks 4, 5, 6 also depend on it.** Do not re-implement canonicalizers.

Key semantics to respect (from the spec):
- Parse on the **first two colons only**; values may contain `:` and `/` (`mbid:artist:<uuid>`, `caip10:eip155:1:0x…`, `doi:10.1000/182`).
- Byte-exact comparison after per-scheme canonicalization; never case-fold an IID wholesale.
- Malformed IIDs (bad checksum, unknown scheme, bad casing) → **quarantine as invalid, never merge/classify on them** (spec D7). Parse status `failed` with a reason, not silent `plain_string` fallback.

## 2. `packages/atom-parser`

- `src/detect.ts:6` `detectLocal` — add `intuition_identifier` detection **first** in the cascade (before ipfs/ethereum/ens/json/url/isbn/plain_string; cheap `int:` prefix guard, then `validateIntuitionId`). An `int:`-prefixed string that fails validation → explicit invalid-identifier parse failure (see quarantine above), not fall-through.
- `src/types.ts:1` — extend `ParsedKind` union; add
  ```ts
  interface IntuitionIdentifierParseResult {
    kind: 'intuition_identifier'
    scheme: string          // e.g. 'isrc'
    value: string           // canonical value, e.g. 'USSM10007459'
    canonical: string       // full canonical IID, e.g. 'int:isrc:USSM10007459'
    inValueType?: string    // for mbid/tmdb/appid/acct/gen1 compound values, e.g. 'artist'
  }
  ```
  (exact shape = the standup interface agreement with Track 4).
- `src/remote.ts` — identifier atoms need **no remote fetch**; short-circuit before fetch-policy logic.
- **P1/P2 JSON payloads:** `src/structured.ts` already extracts from JSON-LD; extend it to surface a top-level `identifier` field when present (per spec, positioned after `@type`) and validate it — a JSON atom with a valid `identifier` gets `identifiers`/scheme hints populated too, while keeping `kind: 'json'`.
- Fixtures: `__tests__/fixtures/atom-parser-contract-fixtures.json` + local-detection/parity/integration suites — add P0 anchors for a spread of schemes (`isrc`, `isbn`, `wd`, `caip10`, `mbid:artist`, `gen1:…:r4:…`), a P1 payload, invalid cases (bad ISRC checksum-free format, unknown scheme, uppercase scheme), and the legacy-bare-URL-vs-IID disambiguation case.

## 3. Worker parse stage (`services/workers`)

- `src/core/parse.ts:3` `CompactParseResult` — add the identifier branch in `toCompactParseResult`: `canonicalId` = canonical IID; `identifiers` = `{ [scheme]: value }` (this is what Track 4's enrichment keys off — e.g. `{ isrc: 'USSM10007459' }`); `hints` carries scheme/inValueType.
- `src/kg/atom-parsing/index.ts` — promote `identifier_scheme`/`identifier_value` to `kg.nodes` on parse completion (column names from Track 2); `resolveSearchText` for identifier atoms: fall back to the raw IID string (per decision D-5, enrichment later overwrites the display label via `data_resolved`).
- Also fold in **on-chain URIs**: node_urls rows with `source='onchain'` (written by Track 2) should be visible to downstream stages the same way `sameAs`-derived URL candidates are today — check `src/core/structured-targets.ts` and thread them into the candidate/hints flow so Track 4 can use them as a fallback enrichment path.

## 4. Classification

### `packages/atom-classification`

- **Scheme→type mapping — the heart of this track.** Add a plugin (or registry-level short-circuit) that maps identifier schemes to `TYPE_DEFINITIONS` entries in `src/plugins/type-profiles/index.ts`, sourced from `SCHEME_TYPING` in `@0xintuition/iid` rather than a hand-written table:
  - Unambiguous: `isrc`→MusicRecording, `isbn`→Book, `iswc`→(composition — nearest existing type or add), `gtin`→Product, `lei`→Organization, `eidr`→Movie/TVSeries, `podcastguid`→PodcastSeries, `rssitem`→PodcastEpisode, `caip19`→EthereumERC20, `appid`→SoftwareApplication, `purl`→SoftwareSourceCode, `acct`→SocialMediaAccount, `olid`→Book, `termset`→DefinedTerm.
  - In-value typing: `mbid:artist`→MusicGroup, `mbid:recording`→MusicRecording, `mbid:release-group`→MusicAlbum, `tmdb:movie`→Movie, `tmdb:tv`→TVSeries, `gen1:<classification-slug>`→that classification.
  - Polymorphic (`wd`, `url`, `doi`, `hash`, `geo`, `caip10`, `imdb` bare, `isni`, `orcid`): type comes from the P1 payload `@type` when present; otherwise classify as the scheme's broadest sensible type or `Thing`, status `ambiguous` — do **not** guess.
  - Gap check: some ladder classifications have no existing `TYPE_DEFINITION` (e.g. composition/iswc). Add minimal definitions rather than mis-mapping.
- Existing URL-domain plugins (`spotify`, `imdb`, `isbn`, …) untouched — legacy path.
- Cache keys (`src/cache.ts`): canonical IID string is the natural stable key.
- Update `packages/atom-classification-example-plugin` + `docs/writing-a-classification-plugin.md` if the plugin interface gains an identifier input shape.

### Worker classification stage

- `src/core/classification.ts:39` `deriveClassificationPlan` — new branch: `kind === 'intuition_identifier'` → scheme lookup → status `recognized`, zero runtime fetch. P1 JSON atoms flow the existing `structuredDocument`/`schemaType` path (line 180) but cross-check payload `@type` against the scheme's typing when the scheme is unambiguous (mismatch ⇒ scheme wins, flag in metadata).
- `resolveClassificationType` (line 124) unchanged mechanically — writes `kg.nodes.classification_type`.
- **Processing scope (D-9):** `src/shared/processing-scope.ts` — map schemes to `ProcessingDomain` (`isrc`/`mbid`/`iswc`→`music`, `podcastguid`/`rssitem`→`podcast`) so scoped deployments pick up identifier atoms. Mirror anything needed in `packages/graph-flags` / `crates/shared/src/graph_flags.rs` only if scope filtering happens there too (check with Track 2).
- `src/kg/atom-classification/index.ts` — `engine.classify({input})` currently takes a URL/string `runtimeInput`; thread the parsed identifier through (interface change coordinated with `@0xintuition/atom-services/runtime` — Track 4 co-owns runtime wiring).
- Shared types: `packages/types/src/classification/index.ts` re-exports.

## 5. API-side detection duplicate

- `services/api/src/app.ts:91` `detectRawType` + `services/api/tests/detect-raw-type.test.ts` — add `intuition_identifier` (used by `POST /api/atoms` offchain create, app.ts:237/259). Small; do it here since it must match the parser's semantics exactly. Track 6 owns the rest of the API surface.

## 6. Definition of done

- [ ] `@0xintuition/iid` consumable in intuition-core (published or vendored), goldens passing in CI.
- [ ] Parser: all new fixtures green; `int:isrc:USSM10007459` ⇒ kind `intuition_identifier` with scheme/value/canonical; invalid IIDs ⇒ explicit failure; every legacy fixture unchanged.
- [ ] Worker parse on devnet promotes scheme/value + search_text to `kg.nodes`.
- [ ] Classification: `int:isrc:…` ⇒ `MusicRecording`/`recognized` with no network call; `int:mbid:artist:…` ⇒ MusicGroup; `int:wd:Q42` without payload ⇒ ambiguous-but-classified path per the mapping rules; JSON-LD fixture atoms classify exactly as before.
- [ ] `detectRawType` parity test between API and parser.
- [ ] Interface handoff to Track 4 honored: `identifiers` map populated in `CompactParseResult` for enrichment keying.

## 7. Out of scope

- Enrichment providers (Track 4).
- Equivalence clustering on the identifier index (follow-up project).
- Backfilling classifications for legacy atoms.
