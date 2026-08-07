# 00 — Overview: What Changed and What It Touches

## 1. The two upstream changes

### 1a. Contracts: `createAtomsWithUris` + `AtomContextRegistered` (additive)

Commit `a402fad` in `intuition-contracts-v2` ("Feat: Add URIs to Atom Create (#155)"). Crucial facts for the backend — **this is an additive ABI change, nothing existing was renamed or removed**:

- New entrypoint on MultiVault:
  ```solidity
  createAtomsWithUris(address creator, bytes[] atomDatas, uint256[] assets, bytes[][] uris)
  ```
  `uris` is **per-atom** (`uris[i]` for atom `i`, inner list may be empty). Limits: default max **5 URIs/atom, 700 bytes each** (`getAtomUriConfig()`, timelock-settable, `AtomUriConfigUpdated` event).
- New event — **the only place URIs exist; they are not stored on-chain**:
  ```solidity
  event AtomContextRegistered(bytes32 indexed termId, address indexed registrant, bytes[] uris)
  ```
  Emitted at most **once per atom, only at creation, only when the URI list is non-empty**, in the same tx *after* the standard `AtomCreated` + `Deposited` pair. If the indexer misses it, the data is gone short of re-reading logs.
- `AtomCreated(creator, termId, atomData, atomWallet)` is **byte-identical** to before. So are `TripleCreated`, `Deposited`, `Redeemed`, and triple creation generally.
- **Atom ID computation is unchanged and URIs do not affect it**: `keccak256(ATOM_SALT ‖ keccak256(atomData))`.
- **URIs are write-once.** No setter, no append, no edit event. Model them as immutable creation-time context.
- FeeProxy gained a matching `createAtomsWithUrisVia` pass-through (emits the same `CreatedAtomsVia`; URI context still surfaces only via `AtomContextRegistered`).

> ⚠️ The `.planning/intuition-id` docs predate this contract change ("None of it requires a protocol or contract change"). The URIs field is the on-chain realization of what the docs model as `sameAs` evidence / additional context. See "Decisions to lock" below — we must pin down what goes in `uris` before the sprint.

### 1b. Data model: atoms become Intuition Identifiers

From the ratified IID spec (`intuition-v2/.planning/intuition-id/spec.md` and friends):

- **Grammar:** `int:<scheme>:<value>` — ASCII, ≤256 bytes, parse on first two colons only, byte-exact comparison after per-scheme canonicalization.
- **Scheme registry (25 schemes):** Class A registered authorities (`isbn`, `isrc`, `iswc`, `isni`, `orcid`, `lei`, `gtin`, `doi`, `eidr`, `wd`, `mbid`, `olid`, `imdb`, `tmdb`, `podcastguid`), Class B intrinsic keys (`url`, `caip10`, `caip19`, `hash`, `appid`, `purl`, `geo`, `acct`, `rssitem`, `termset`), Class C derived (`gen1:<classification>:r<N>:<keccak16>`).
- **Representation profiles (D29–D31):**
  - **P0 anchor** — atom data **is** the bare IID string (`int:isrc:USQX91300108`, ~21 bytes). Only for schemes with unambiguous typing. `atomId = calculateAtomId(iid)` ⇒ protocol-level zero-coordination dedupe.
  - **P1 identity context** — JSON with `@type` + `identifier` + recipe fields. Required floor for Class C (`gen1` preimage must be verifiable) and polymorphic schemes (`wd`, `url`, `doi`, `hash`, `geo`, `caip10`, `imdb`, `tmdb`, `isni`, `orcid`).
  - **P2 enriched** — today's full JSON-LD, now opt-in.
- **Scheme ⇒ classification** is deterministic for unambiguous schemes (`isrc` → MusicRecording, `isbn` → Book edition, `gtin` → Product, `lei` → Organization, `podcastguid` → PodcastSeries, `rssitem` → PodcastEpisode, `caip19` → EthereumERC20/asset, `appid` → MobileApplication, `purl` → Software, `acct` → SocialMediaAccount, …). `mbid` and `gen1` carry the type **in-value** (`mbid:artist:…`, `gen1:music-recording:…`). Polymorphic schemes get `@type` from the P1 payload.
- **Profile detection needs no marker (PE-Q6):** P0 iff `validateIntuitionId(rawPayload)` succeeds (the `int:` prefix distinguishes it from legacy bare-URL atoms); otherwise JSON-parse and look for `identifier`.
- **Enrichment direction inverts:** instead of *parsing* stored JSON to find a `sameAs` URL and scraping it, we *resolve* the identifier against the scheme's home registry/API (ISRC → Spotify/MusicBrainz, ISBN → OpenLibrary, QID → Wikidata, DOI → Crossref, CAIP → on-chain, …). Display metadata (name, image) comes from enrichment/claims, not from atom bytes.
- **Reference implementation already shipped:** `@0xintuition/iid` (in `intuition-v2/intuition/iid`) — `norm1()`, all per-scheme canonicalizers/validators with checksums, `gen1` derivation, `parseIntuitionId`/`validateIntuitionId`/`isIntuitionId`, `SCHEME_TYPING` + `isAnchorEligible`, 92 golden tests. Ladders live as `identity` blocks on all 37 `ClassificationSpec`s in `intuition/classifications`. **We are wiring, not inventing.**

## 2. Current pipeline and where it changes

```
Chain (MultiVault)
  │  AtomCreated (unchanged) + AtomContextRegistered (NEW)
  ▼
crates/rindexer-ingestion ─ Rust, ABI-generated typings          ← Track 1
  │  event_store + typed tables (Timescale)
  ▼
crates/projections ─ term rows, kg.nodes, kg.events, Surreal     ← Track 2
  │  kg.nodes (raw_type, data, data_resolved…)  + kg.node_urls
  ▼
services/workers (TS)
  ├─ parse           packages/atom-parser                        ← Track 3
  ├─ classification  packages/atom-classification               ← Track 3
  └─ enrichment      packages/atom-enrichment / atom-services   ← Track 4
  ▼
services/api (Hono REST) → apps/explorer                         ← Track 6

intuition-v2 seed pipeline (DB-first, no IPFS/tx today)          ← Track 5
```

Per-layer impact, in one line each:

| Layer | Today | After |
|---|---|---|
| Ingestion | Decodes `AtomCreated` only | Also decodes `AtomContextRegistered`; stores URIs in a typed table |
| Projections | Materializes `atom_data` into `term`/`kg.nodes` with `raw_type ∈ {string,json,http_uri,ipfs_uri}` | Adds `intuition_identifier` raw_type; projects on-chain URIs into `kg.node_urls` |
| Parse | Detect cascade: ipfs → eth addr → ens → json → url → isbn → plain_string (an `int:` atom falls to `plain_string` today) | New `intuition_identifier` kind (checked **first**), scheme/value extracted and validated via `@0xintuition/iid`; no remote fetch needed |
| Classification | `@type` read out of the JSON-LD document; URL-domain plugins | Scheme→type lookup for unambiguous schemes (no fetch, `recognized` instantly); payload `@type` for P1/P2; legacy path retained |
| Enrichment | Keyed by `hints.url` / `sameAs` targets; plugins match on URL shape | Keyed by `hints.identifiers` (`{isrc: …}`, `{isbn: …}`); providers gain lookup-by-identifier paths; on-chain URIs feed the URL path as before |
| Database | `kg.nodes` has no identifier columns; `node_urls` has no on-chain source | `identifier_scheme`/`identifier_value` (or equivalent), `raw_type` CHECK extended, `node_urls.source='onchain'`, Timescale `atom_context_registered_events` |
| API | `detectRawType` knows 4 kinds; serialization has no identifier fields | Identifier detection + new response fields; OpenAPI/docs updated |
| Seed pipeline (v2) | `deriveAtomData()` emits JSON-LD; ad-hoc identifier projection (`isrc:{…}` strings) | Ladder-driven `deriveIntuitionId()`; P0 strings / P1 JSON per class; URIs sourced from `sameAs` harvest |

Detailed file-level inventories live in each track doc.

## 3. Dependency graph & sequencing

```
        ┌──────────────────────────┐
        │ PRE-SPRINT: decisions +  │
        │ contracts npm pin exists │
        └───────────┬──────────────┘
     ┌──────────────┼───────────────────────┬─────────────────┐
     ▼              ▼                       ▼                 ▼
 Track 1        Track 3 (parser/class)   Track 4 (enrich)  Track 5 (seed, other repo)
 ingestion      — independent of 1/2     — depends on 3's  — independent; only shares
     │            once contracts pin       parse-result      the iid package + decisions
     ▼            is bumped                shape (agree on
 Track 2                                   interface at
 projections/DB ◄── raw_type/columns ────  standup, then
     │              agreed with 3          parallel)
     └────────────┬────────────────────────┘
                  ▼
             Track 6 — API/explorer/devnet/QA (integrates everything; starts
             on independent pieces day 1, integration day 2)
```

Hard dependencies (everything else is parallel):

1. **The bumped `@0xintuition/contracts-v2` npm package must exist before the sprint** (Track 1's first step is `bun run abis:sync`). If it isn't published, vendoring the ABI JSON manually is the day-1 fallback.
2. **`@0xintuition/iid` must be consumable from intuition-core** (Tracks 3, 4, 5, 6). Decide publish vs. vendor before the sprint — see decisions below.
3. Track 2 needs Track 1's typed-table shape (agree in the morning standup; it's one table definition).
4. Tracks 3/4 share the `CompactParseResult`/hints interface — agree on the `{ scheme, value, canonical, identifiers }` shape at standup, then work in parallel against fixtures.
5. Track 6's end-to-end verification is the last thing to run (day 2 afternoon): devnet → `createAtomsWithUris` with `int:` atoms → indexer → parse → classify → enrich → API → explorer.

### Suggested schedule

**Day 0 (before the sprint, lead):** lock the decisions in §4; confirm contracts npm pin + deployed contract address for devnet/testnet; publish or vendor `@0xintuition/iid`; share this plan.

**Day 1 morning:** 30-min standup — walk the interface agreements (typed table shape, raw_type value, parse-result shape, node_urls source enum). Then all tracks start.

**Day 1 target:** Tracks 1–2 code-complete (Rust compiles, migrations run, devnet event lands in Timescale + kg). Track 3 parser done, classification mapping in review. Track 4 first two providers (Spotify-by-ISRC, MusicBrainz) working against fixtures. Track 5 derivation swapped, dry-run diff produced. Track 6 devnet acceptance updated + smoke-test scaffold.

**Day 2:** integration. Wire workers end-to-end on devnet, fix interface drift, remaining enrichment providers, API/explorer surface, docs, run full smoke. End with the checklist in `06-track-api-explorer-qa.md` §5 green.

## 4. Decisions to lock BEFORE the sprint

These are the things that will cause mid-sprint thrash if left open. Recommended defaults included so the lead can just ratify.

| # | Decision | Recommendation |
|---|---|---|
| D-1 | **What goes in the on-chain `uris` field?** The planning docs predate it. | Additional-context URLs (the old `sameAs` payload: Spotify links, Wikipedia URLs…) and/or secondary `int:` identifiers. Indexer treats each entry as an opaque string: if it validates as an IID → record as secondary identifier; if it parses as a URL → `kg.node_urls`; else keep raw. Don't over-model on day 1. |
| D-2 | **`raw_type` value name** for identifier atoms (kg.nodes CHECK + API + explorer). | `'intuition_identifier'`. |
| D-3 | **How does intuition-core consume `@0xintuition/iid`?** It lives in intuition-v2. | Publish to npm (it's already a clean package with golden tests). Fallback: vendor into `packages/` as a temporary copy with a tracking issue to swap to the npm dep. Do **not** hand-port canonicalizers. |
| D-4 | **Seed pipeline default profile (PE-Q3):** P0-only, P0+P1, or P2+anchor? | P0 bare anchors for Class A/B unambiguous schemes; P1 JSON for Class C and polymorphic schemes (spec-required floor). No P2 for new seeds — display data goes to enrichment artifacts, which the DB-first seed path already writes. |
| D-5 | **Rehydration/search floor (PE-Q4):** a P0 atom is unrenderable until enriched. | `search_text` and display label come from enrichment artifacts (`data_resolved`), falling back to the raw IID string. Explorer shows the IID + scheme badge while unenriched. Accept the loading state for the sprint. |
| D-6 | **Legacy atom backfill (Q5)** — indexer-computed IIDs for existing atoms, `sameAs` clustering, equivalence layer. | **Out of scope for the sprint.** The additive design means legacy atoms keep working through the old parse path. Schedule backfill (checklist Phase 5) + equivalence layer (Phase 4) as the follow-up project. |
| D-7 | **Do secondary identifiers from `uris` trigger their own enrichment?** | Not in the sprint. Store them; enrich off the primary identifier only. |
| D-8 | **Which schemes must be enrichable by end of sprint?** | Match live seed lanes: `isrc` (Spotify/MusicBrainz), `isbn` (OpenLibrary/ISBN provider), `wd` (Wikipedia/Wikidata), `doi` (Crossref — already keys off identifiers today), `caip10`/`caip19` (existing ethereum providers), `url` (existing path). Everything else: parse + classify correctly, enrichment `skipped` status, add providers later. |
| D-9 | **Processing-scope semantics** (`music`/`podcast` domains) for identifier atoms. | Map scheme → domain (`isrc`,`mbid`,`iswc` → music; `podcastguid`,`rssitem` → podcast) in the same place classification maps scheme → type. |

Open questions from the spec that do **not** block the sprint (park them): Q1 formal ratification, Q2 equivalence thresholds, AL-Q1/Q2 type-as-a-claim predicates, Q10 pipeline signer identity, cross-chain Q9.

## 5. Risks / gotchas surfaced during research

- **The `AtomContextRegistered` event is fire-and-forget.** URIs exist only in logs. The indexer handler must be in place before real `createAtomsWithUris` traffic, or we'll need a log-backfill job. (Backfill-from-logs is possible — note it as the recovery path, don't rely on it.)
- **Atom IDs change for seeded data.** Same entity, new atom data string ⇒ new `calculateAtomId`. The DB-first seed corpus will mint *different* node IDs than the JSON-LD run. Decide whether to wipe-and-reseed the target environment (recommended for the sprint) or run both corpora side by side pending the equivalence layer.
- **`int:` atoms currently fall through to `plain_string`** in `packages/atom-parser/src/detect.ts` — the detection cascade must check `int:` **before** other branches (cheap prefix check, then validate).
- **Case sensitivity:** IID comparison is byte-exact; canonicalization is per-scheme (e.g. ISRC uppercase, DOI lowercase). Never lowercase an IID wholesale anywhere in the pipeline — always go through `@0xintuition/iid` canonicalizers.
- **Multi-valued selection (D28):** anywhere we pick one value from a set (e.g. choosing which `sameAs` URL becomes a `url`-scheme IID), selection must be a pure function of the set (lexicographically smallest canonical value), never first-seen order. A real bug shipped from getting this wrong once already (audit F1).
- **`mbid` requires the entity-type segment** (`int:mbid:artist:<uuid>`), and `tmdb`/`appid`/`acct` are similarly compound — parse values per-scheme, don't assume `value` is atomic.
- **Deploy acceptance uses `parseEventLogs` with the full MultiVault ABI** — the event addition is additive so it won't break, but the acceptance script should start exercising `createAtomsWithUris` so the whole new path is covered on every deploy.
- **Do not gut the legacy path.** IPFS/JSON-LD parsing, `structured.ts`, URL-domain classification plugins all stay — the chain has existing atoms and D29 makes profiles additive. This is an *add-a-path* migration, not a replace.
