# Track 5 — Seed Data Pipeline (intuition-v2)

**Owner:** 1 engineer (TypeScript; knows the seed control plane / import-data scripts)
**Repo:** `intuition-v2` (this is the only track outside intuition-core)
**Mission:** the seed pipeline emits atoms in the new shape — P0 bare IID strings (or P1 JSON where required) derived through the classification ladders via `@0xintuition/iid` — with URI context carried alongside, before any upload/write.

**Reality check from research:** the current seed path is **DB-first** — no IPFS pinning (`packages/ipfs-pinata` has zero consumers), no transactions, no wallets. It computes `calculateAtomId(atomData)` locally and writes straight into KG Postgres. Nothing in `packages/`, `scripts/`, `backend/`, or `apps/` imports `@0xintuition/iid` yet — the spec shipped but the pipeline never adopted it (checklist Phase 3, unstarted). That's this track.

## 1. Current shape (what you're changing)

- **Atom assembly:** `scripts/import-data/prepare-data-seed-enrichment.ts` — `deriveAtomData()` at **line 1945** builds the JSON-LD string (`{"@context":"https://schema.org/","@type":…,"name":…,"url":…}`); node ID = `calculateAtomId(derivedAtomData)` (line 1596); node rows written `rawType:'json'`, `is_onchain:false` (line 2385).
- **Control plane:** `packages/database-seed-control-plane/src/` (`cli.ts` stages `import-csv` → `claim-source-tasks` → `process-claimed-jobs` → `write-ready-jobs`, `staged-enrichment.ts`, `identifier-projection.ts`, `relations.ts`).
- **Identifier extraction already exists** and computes the right raw values in the wrong format: `identifier-projection.ts` emits ad-hoc `spotify_track → isrc + spotify:track`, `openlibrary_book → isbn`, `wikipedia_article → wd:{QID}`, `coingecko_coin → eip155:…`, `google_place → gplace:…`; plus `packages/atom-enrichment/src/extraction/isrc.ts` (incl. Spotify→iTunes chaining) and `wikidata-claims.ts`.
- **Writers:** `packages/database-kg/scripts/write-ledger.ts` (plan-first, `--execute`, batching, non-local guard) and control-plane `write-ready-jobs`; stack/perspective writers alongside.

## 2. Work items

### 2.1 Derivation swap (the core change)

In `prepare-data-seed-enrichment.ts` and the control-plane equivalent (`staged-enrichment.ts` job processing):

1. After classification+enrichment, assemble the field set and call `deriveIntuitionId(ladder, values)` from `@0xintuition/iid` with the classification's `identity` ladder (from `intuition/classifications`). The ladder walks rungs highest-first; you get `{iid, scheme, class, tag?}`.
2. Replace `deriveAtomData()` output per decision D-4:
   - **Class A/B unambiguous scheme ⇒ P0**: atom data = the bare IID string; node `rawType:'string'` → **coordinate: intuition-core is introducing `'intuition_identifier'`** — write that value if the shared kg schema (Track 2) lands first; also populate the new `identifier_scheme`/`identifier_value` columns.
   - **Class C (`gen1`) or polymorphic scheme ⇒ P1**: JSON `{ "@context", "@type", "identifier": "<iid>", …recipe fields…, "sameAs": […] }` — recipe fields are the hash preimage evidence and are **required** (all-or-nothing rungs, D5); `rawType:'json'`.
   - No P2 for new seeds; display metadata stays in enrichment artifacts / `data_resolved` (already written by this path).
3. Node ID remains `calculateAtomId(newAtomData)` — **IDs change for the whole corpus** (see §4).
4. D28 discipline: wherever one value is selected from a set (multiple `sameAs`, multiple ISRCs), select the lexicographically smallest canonical value — pure function of the set, never first-seen.

### 2.2 Converge `identifier-projection.ts` onto the canonical registry

Replace the ad-hoc scheme strings with `@0xintuition/iid` canonicalizers: `isrc:{v}` → `int:isrc:{canonical}`, `wd:{QID}` → `int:wd:Q…`, `eip155:{chain}:{addr}` → `int:caip10`/`caip19` (lowercased address), `openlibrary → int:isbn`/`int:olid`. **Drop `gplace:{placeId}` as a primary identifier** — Google Place IDs are explicitly rejected from the registry (licensing); places floor at `gen1{name, geo7}` per the local-business ladder (keep the place ID in enrichment artifacts only). Spotify/Steam provider IDs are not registry schemes: they become **URI context** (§2.3) and enrichment keys, not primary IIDs.

### 2.3 URI context (the future `createAtomsWithUris` payload)

Source per atom, capped at the contract limits (**5 URIs × 700 bytes**, deterministic priority order so truncation is stable):
1. canonical provider URL (`canonical_url` / Spotify track URL),
2. manifest `Same As` column entries,
3. enrichment `sameAs` harvest (Wikidata claims etc.).

DB-first today: persist as `kg.node_urls` rows (`source` value TBD with core Track 2 — suggest `'seed'` vs `'onchain'`) and/or `data_resolved.sameAs` as currently. Also emit the URI list into the ledger/control-plane row so the future on-chain mint (`createAtomsWithUris`) can replay it without recomputation. **No on-chain seed path exists yet — do not build one this sprint**; just make the data shape mint-ready.

### 2.4 Writers & validation

- `write-ledger.ts` / `write-ready-jobs`: write the new `rawType`, identifier columns, URI rows; keep plan-mode diffs meaningful (they'll show 100% ID churn — add an explicit summary line "N nodes re-keyed by IID migration").
- Update co-located tests (`prepare-data-seed-enrichment.*.test.ts`, control-plane tests), and `buildNodeSearchText` — `name` no longer lives in atom data for P0; search text comes from enrichment (mirror core's D-5 rule).
- Add a validation gate before write: every P0 atom data must pass `validateIntuitionId`; every P1 must contain a valid `identifier` consistent with its recipe fields (re-derive and compare — catches recipe/normalization drift).

### 2.5 Dry run (day-1 deliverable, feeds PE-Q3 evidence)

Run the music lane (`spotify-music-seed-candidates`, strongest identifier coverage) through the new derivation **in plan mode** and produce a report: % reaching Class A (`isrc`), % falling to `mbid`/`gen1`, byte sizes, dedupe collisions (same ISRC from multiple candidate rows now collapsing to one atom — that's the feature working), URI-cap truncations. This is the go/no-go artifact for flipping `--execute`.

## 3. Identifier feasibility by lane (from research — sets expectations)

| Lane | Primary IID | Strength |
|---|---|---|
| Spotify music | `int:isrc:` (from spotify/apple/musicbrainz artifacts) | Strong (Class A) |
| Crypto (CoinGecko) | `int:caip19:` / `int:caip10:` | Strong |
| Books (OpenLibrary) | `int:isbn:` / `int:olid:` | Strong |
| Wikipedia | `int:wd:` | Strong (polymorphic ⇒ P1) |
| GitHub / arXiv | `int:url:` / `int:purl:` / `int:doi:` | Good |
| Podcasts | `int:podcastguid:` / `int:rssitem:`; Spotify show IDs only as URI context | Medium — needs feed-GUID resolution; UUIDv5-from-feed-URL fallback is offline-derivable |
| Places | `int:gen1:local-business:…{name, geo7}` (Place ID rejected) | Weak by design (Class C) — expect heavy reliance on the future equivalence layer; geohash-7 boundary forking is a known 23.6% issue, don't fight it this sprint |
| Movies/TV (TMDB, planned lane) | `int:wd:` → `int:tmdb:movie:` per ladder | Good when lane activates |

## 4. The ID-churn decision (raise at standup, lead decides)

New atom data ⇒ new `calculateAtomId` for every seeded node. Options: **(a) wipe-and-reseed** the target environment with the new corpus (recommended for the sprint — clean, exercises the whole new pipeline); (b) side-by-side corpora reconciled later by the equivalence layer (spec Layer 2.5/3, unbuilt). Old JSON-LD seed atoms and new IID atoms will NOT auto-cluster until that layer exists — don't promise dedupe across the migration boundary.

## 5. Definition of done

- [ ] `@0xintuition/iid` + `intuition/classifications` identity ladders wired into both seed paths (legacy script + control plane); no ad-hoc identifier formats remain in `identifier-projection.ts`.
- [ ] Music-lane dry-run report produced (§2.5) and reviewed.
- [ ] P0/P1 selection matches D-4 exactly; validation gate green over the full music lane.
- [ ] One lane written `--execute` into a local stack running Tracks 1–4's code: seeded `int:isrc:` nodes parse/classify/enrich in intuition-core without special-casing (proves seed output == on-chain-equivalent shape).
- [ ] URI context persisted and mint-ready (≤5 × ≤700 bytes, deterministic order).
- [ ] Tests updated; write-ledger plan mode reports ID churn explicitly.

## 6. Out of scope

- On-chain minting of seeds (`createAtomsWithUris` batch tooling) — future project once the seed→chain path is prioritized; the data shape from this sprint feeds it directly.
- IPFS pinning (still unconsumed — the P0 model makes it less relevant, not more).
- Backfill/equivalence for the old JSON-LD corpus (Q5 / Phase 4–5 follow-up).
- Held lanes (OpenLibrary bulk hydrate, TMDB, Steam) — migrate the *code paths*, don't activate new lanes.
