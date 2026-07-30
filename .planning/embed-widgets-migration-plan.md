# Embed Widgets — Migration Plan (alpha → intuition-core)

**Status:** Draft v1 — for review
**Created:** 2026-07-23
**Source (private):** `alpha/backend/widget-api`, `alpha/apps/embed`, `alpha/apps/embed-template`
**Destination:** this repo (`intuition-core`), as open-source embed-widget functionality
**Directive:** the Intuition Core Query API (`services/api`, :3000) becomes the data-fetching layer.

---

## 0. TL;DR

We are migrating the prototyped embeddable-widget stack (~4.4k LOC across three workspaces) into
intuition-core as two new workspaces plus one new service, re-pointing its data layer from
direct private-DB access to the Core Query API. The prototype is unusually clean for this: the
frontend embed package has **zero runtime dependencies**, the API has **no secrets, no auth, no
chain-specific code**, and both already follow Bun + Hono + Biome conventions that match this repo.

The real work is not the port — it's (a) rebuilding the widget API's data layer on top of the Core
API, (b) filling two data gaps in the Core API (market/trust aggregates and price history are not
exposed today), and (c) deciding what to do about **stacks**, a concept that exists in alpha's
schema but not in core at all.

Proposed landing spots:

| Source (alpha) | Destination (core) | Role |
|---|---|---|
| `apps/embed` | `apps/embed` (`@0xintuition/embed`) | The embeddable widget bundle: iframe loader (`v1.js`), web component (`v1.mjs`), renderers, styles |
| `apps/embed-template` | `apps/embed-playground` | Demo host site + interactive embed builder / snippet generator |
| `backend/widget-api` | `services/embed-api` (`@0xintuition/embed-api`) | Thin read-only BFF: composes Core API responses into widget DTOs, serves the static embed assets, permissive CORS, CDN cache headers |

---

## 1. What we're migrating (findings summary)

### 1.1 `backend/widget-api` (~1.1k LOC, Bun + Hono)
Read-only, no-auth REST API serving pre-shaped DTOs for three widget kinds:
`GET /v1/item/:id`, `GET /v1/stack/:id`, `GET /v1/claim/:id`, plus `/health`.
Every DTO carries `source: 'live' | 'sample'` — on any DB miss/error it falls back to
deterministic hash-seeded sample data, so a widget never renders empty.

- Data today: direct Drizzle queries against alpha's KG Postgres (`kg.nodes`, `kg.artifacts`,
  `kg.triples`, `market.vaults`, `intuition.stacks`, `intuition.stack_entries`) and optional
  TimescaleDB (`sharePriceHistory`) for sparklines / 24h delta.
- Private couplings: `@0xintuition/database-kg`, `@0xintuition/database-timescale`
  (`workspace:*`), `@0xintuition/tsconfig`, `catalog:` pins, monorepo-shaped Dockerfile.
  **These all disappear** when the data layer moves to the Core API.
- CORS `*` by default (deliberate — the main gateway's credentialed allowlist CORS is exactly why
  this service exists separately), no rate limiting (CDN-absorption strategy), cache headers
  `public, max-age=60, s-maxage=300, stale-while-revalidate=86400`.
- No secrets, no API keys, no chain IDs, no contract addresses. 2 unit test files.

### 1.2 `apps/embed` (~2.6k LOC, vanilla TS + Vite/Bun builds)
The product. **Zero runtime dependencies**, no framework — imperative DOM via a 24-line `el()`
helper. Two delivery mechanisms sharing one rendering core and one stylesheet-as-TS-string:

1. **iframe + loader** (`dist/v1.js`, IIFE): host page adds
   `<div class="intuition-widget" data-type=… data-id=…>` + `<script async src=…/v1.js>`.
   Loader builds `embed.html?type=…&id=…&theme=…&embedId=…` iframes, resizes them via a
   `{type:'intuition:resize', embedId, height}` postMessage protocol with a per-embedId registry,
   MutationObserver rescan for SPA hosts, idempotent mounting.
2. **web component** (`dist/v1.mjs`, ESM): `<intuition-widget type=… id=…>`, open shadow root,
   reactive attributes.

Widget types/variants: `item` (badge/compact/market/card), `stack`
(stack/spread/ledger/shuffle/deck/shelf), `claim` (claim) — 11 variants. Theming via HSL custom
properties (`--ew-*`), dark/light/auto. API base resolution: global override →
`VITE_EMBED_API_URL` → localhost sniff → prod URL. Any fetch failure falls back to deterministic
mock data. No tests, no deploy config; `dist/` committed (stale — exclude).

### 1.3 `apps/embed-template` (~0.7k LOC)
Misleading name: it's a **demo host site + embed builder** (pick type/id/variant/theme → live
preview → copy the production snippet), not a widget-authoring scaffold. Sole dependency:
`@0xintuition/embed` via `workspace:*`. Contains real alpha-testnet preset IDs that must be
replaced with locally-seeded data.

### 1.4 What intuition-core offers today
- Query API (`services/api`, :3000, Hono): `GET /api/atoms`, `/api/atoms/:id` (with graph-degree
  stats), `/api/atoms/:id/artifacts` (opengraph images etc.), `/api/atoms/:id/triples`,
  `/api/triples[/:id]?expand=terms`, `/api/events`, `/api/predicates`, `/api/schema`,
  `/api/stats`. Reads open by default; `API_ALLOWED_ORIGINS` CORS; `{data, pagination}` envelope.
- Own `@0xintuition/database-kg` / `database-timescale` packages; Rust `projections` crate builds
  market read models into KG from the Timescale event store.
- Conventions: Bun-only installs, Turborepo, Biome (tabs, single quotes, 100 cols), strict shared
  tsconfig, `catalog:` pins for typescript/zod, `bun:test`, per-service `docker/Dockerfile.<name>`
  + compose entry + published-image overlay + `publish-images.yml` matrix row + CI
  compose-assertion, 14-day supply-chain policy, Biome-enforced auth-free import boundary.
- **No widget/embed code exists anywhere in core.** Ports taken: 3000, 3100, 4010, 4110-4112.

---

## 2. Key decisions

### D1 — Data layer: Core API over HTTP (per directive), not direct DB
The embed-api service becomes a thin BFF that composes Core Query API responses into widget DTOs.

Why this over the repo-idiomatic direct-Drizzle approach (which `services/api` itself uses):
- It dogfoods the public API — the widget service is a worked example of building on Core.
- It keeps embed-api deployable against **any** Core API endpoint (self-hosted or the hosted
  API), not just a co-located database. Third parties can run just the embed tier.
- It preserves the CORS separation: `services/api` keeps its allowlist + rate limits;
  `embed-api` keeps permissive `*` CORS and CDN cache headers.
- The private-package coupling problem evaporates instead of being ported.

Cost: one extra HTTP hop (mitigated by the existing 60s/300s cache headers and `?expand=terms`
batch endpoints), and the Core API must actually expose the data widgets need → D2.

Config: `EMBED_API_CORE_URL` (default `http://api:3000` in compose, `http://localhost:3000`
native), optional `EMBED_API_CORE_KEY` pass-through for gated deployments (reads are open by
default, so normally unset).

### D2 — Fill the Core API market-data gap (net win for the whole API)
Widget DTOs need: trust staked (vault totalAssets aggregated across curves), market cap, share
price, holder count, sparkline series + 24h delta. **None of this is exposed by the Core API
today**, even though the Rust projections build market read models and Timescale holds the event
history. Plan: add to `services/api`:

- `GET /api/atoms/:id/market` — aggregated vault stats (totalAssets, marketCap, holderCount,
  currentSharePrice per curve + aggregate), from the market read models.
- `GET /api/atoms/:id/market/history?window=24h&points=40` — downsampled share-price series from
  Timescale; 404/empty cleanly when Timescale isn't running (embed falls back to
  `hasHistory:false`, exactly as the prototype does).
- (Option) `?expand=market` on `GET /api/triples/:id` to keep the claim widget to one request.

These endpoints are useful to every API consumer (explorer included), not just widgets — they
should be specced in `docs/openapi.yaml` and added to `docs/api-reference.md` like any other
public-API change (issue-first per CONTRIBUTING).

### D3 — Stacks: ship sample-only, defer live data
Alpha's `intuition.stacks` / `stack_entries` tables have **no counterpart in core**. Rather than
block the migration or invent a stacks projection now:
- Port all six stack variants with their sample-data path intact (`source:'sample'`).
- Document stack widgets as "preview — live data pending the Stacks/Lists concept in core".
- Open a tracking issue for a core-native stacks/lists model; wire `GET /v1/stack/:id` to it when
  it exists.

### D4 — One deployable "embed" service serves both DTOs and static assets
`services/embed-api` serves `/v1/*` DTO routes **and** the built embed artifacts
(`/v1.js`, `/v1.mjs`, `/embed.html` + assets) from one container. One new compose service, one
image (`ghcr.io/0xintuition/intuition-core-embed-api`), one origin for third parties. A separate
CDN in front is a deployment concern, not a repo concern. Port: **3200** (host var
`EMBED_API_HOST_PORT`).

### D5 — Adopt core conventions wholesale during the port (not after)
- Biome formatting (tabs/single quotes — the prototype will reformat cleanly).
- `@0xintuition/tsconfig` **strict** base — the prototype is `strict:false`; expect and fix a
  batch of strictness errors during the port (mostly in `queries.ts`-descended code and DOM
  helpers). This is the single largest mechanical task.
- `catalog:` for typescript/zod; pin `hono`; Vite 7 already matches explorer. No new runtime deps
  anticipated (embed has none; embed-api needs only hono + zod).
- `bun:test`; DB-independent tests only (the BFF mocks Core API responses with fixtures).

---

## 3. Phases

### Phase 1 — Port `apps/embed` + `apps/embed-playground` (sample-data mode)
No backend required — the mock fallback means widgets render fully offline. Ships visible value
immediately and lets design iteration start in the open repo.

1. Copy `apps/embed` source (exclude `dist/`, `.turbo/`, `.cache/`); rename config surface:
   `VITE_EMBED_API_URL` / `VITE_EMBED_ORIGIN` kept, defaults re-pointed (localhost:3200; prod
   origin TBD → D-open-3).
2. Copy `apps/embed-template` → `apps/embed-playground`; replace alpha-testnet preset IDs with
   IDs from core's seed/smoke data; keep sample-trigger presets (`nextjs`, `ether`, …).
3. Convention pass: Biome format, strict tsconfig fixes, uniform scripts
   (`ci`/`lint`/`typecheck`/`test`/`clean`), workspace manifests (`"private": true`, MIT).
4. Scrub pass:
   - Replace hotlinked mock images (Wikimedia, Spotify CDN, `i.pravatar.cc`, `loremflickr.com`)
     with local/inline assets (SVG placeholders or committed thumbnails). Third-party hotlinks in
     an embed that runs on other people's sites are a reliability + privacy liability.
   - Replace Google Fonts loads in `embed.html`/playground with self-hosted or system font stack
     (GDPR: Google Fonts on third-party sites is a known problem; the CSS already has fallbacks).
   - Deduplicate the 3× inline brand SVG + `INTUITION_URL` constant into one module; keep
     "Powered by Intuition" as the default footer (it's the open-source attribution story).
5. Port the two existing widget-api unit tests' analogues where relevant; add pure-function tests
   for `params.ts`, `format.ts`, mock determinism.
6. Docs: `apps/embed/README.md` rewritten for core (usage snippets, both delivery paths,
   postMessage protocol, theming); "adding a widget variant" contributor guide (the 6-file
   checklist: types → params → mount → render switch → styles → loader WIDTHS).

**Exit criteria:** `bun run dev` in embed + playground renders all 11 variants in both themes
from sample data; typecheck/lint/test green in CI.

### Phase 2 — `services/embed-api` BFF on today's Core API
1. Scaffold `services/embed-api` from the prototype's `app.ts`/`config.ts`/`dto.ts`/`sample.ts`
   (these port nearly verbatim); replace `db.ts`/`queries.ts` with a `core-client.ts` (typed
   fetch functions + zod `looseObject` schemas, modeled on `apps/explorer/src/lib/api.ts`).
2. Implement with existing endpoints only:
   - `item`: `GET /api/atoms/:id` (label/classification via dataResolved) +
     `GET /api/atoms/:id/artifacts` (imageUrl) → trust/marketCap/sparkline fields served as
     sample-derived until Phase 3 (`source` stays honest: introduce `source:'partial'` or keep
     `'sample'` for market figures — decide in PR).
   - `claim`: `GET /api/triples/:id?expand=terms` → subject/predicate/object labels + images.
   - `stack`: sample-only (D3).
3. Static serving of `apps/embed` build output (`v1.js`, `v1.mjs`, `embed.html`) with long-lived
   immutable cache headers for hashed assets; turbo task dependency `embed#build → embed-api#build`.
4. Tests: fixture-driven — recorded Core API JSON → DTO snapshot tests; sample-fallback tests;
   config-parsing tests (port `config.test.ts`).
5. Env (add to `example.env`): `EMBED_API_PORT=3200`, `EMBED_API_CORE_URL`,
   `EMBED_API_ALLOWED_ORIGINS` (default `*`), `EMBED_API_CACHE_MAX_AGE`,
   `EMBED_API_CACHE_S_MAXAGE`, `EMBED_API_TRUST_DECIMALS`.

**Exit criteria:** widgets on the playground render live titles/images/claim terms from a
`docker compose up` stack; sample fallback verified by stopping the API.

### Phase 3 — Core API market endpoints, live market data
1. Issue-first spec for `GET /api/atoms/:id/market` and `/market/history` (D2); implement in
   `services/api` against the projections' read models + Timescale; OpenAPI + api-reference docs.
2. Wire embed-api item/claim DTOs to them: real trust, marketCap, sharePrice, stakers
   (document the holderCount approximation as the prototype README does), sparklines, 24h delta,
   `hasHistory`/`hasDelta` flags degrade gracefully without the `indexing` profile.
3. Verify `EMBED_API_TRUST_DECIMALS` against the deployed TRUST token (open prototype TODO).

**Exit criteria:** `make smoke-index`-style flow where a staked atom shows live market figures in
a widget; `source:'live'` end-to-end.

### Phase 4 — Full repo integration & publishing
1. `docker/Dockerfile.embed-api` (two-stage bun-alpine: build embed bundle → run service;
   HEALTHCHECK `/health`, non-root, matching existing Dockerfile patterns).
2. `docker-compose.yml` service entry (`depends_on: api: service_healthy`), published overlay
   entry, `publish-images.yml` matrix row (+ smoke command: curl `/health` + `/v1/item/x` returns
   JSON), **CI compose-assertion list update** (required — CI fails without it).
3. `process-compose.yaml` entry for native dev mode; Makefile targets (`make embed`,
   smoke additions); README section ("Embed widgets" quickstart with the two snippets).
4. `docs/embed-widgets.md`: embedding guide for third parties (snippet, attributes table,
   theming, CSP notes for host pages, self-hosting the embed origin).
5. Deploy to Railway (superb-quietude) alongside existing services; pick and configure the
   public embed origin (D-open-3); smoke on a real external page.

### Phase 5 — Open-source polish & growth (post-migration backlog)
- Stacks live data (tracking issue from D3).
- npm publishing question for the web component (core currently publishes zero npm packages —
  GHCR-only; revisit if demand appears; the script-tag path needs no npm).
- Rate limiting / abuse posture beyond CDN absorption (documented stance for self-hosters).
- Visual regression harness for the 11 variants (screenshot smoke via playground).
- Port design lineage: decide whether `lab/card-playground` (the declared design source of truth
  the renderers were ported from) comes over, gets summarized into docs, or is dropped — the
  README comments referencing it must be rewritten either way.

---

## 4. Open questions (need owner decisions)

1. **Stacks (D3)** — confirm sample-only shipping is acceptable, and whether a core-native
   stacks/lists concept is on any roadmap.
2. **`source` honesty in Phase 2** — is `'sample'` acceptable for market figures on otherwise-live
   items, or do we add `'partial'` to the DTO contract before third parties depend on it?
3. **Public embed origin** — keep `embed.intuition.systems` / `embed-api.intuition.systems`
   (currently hardcoded in the prototype) or new names? Needed for Phase 1 defaults and Phase 4
   deploy.
4. **Naming** — `services/embed-api` + `apps/embed` + `apps/embed-playground` as proposed, or
   fold DTO routes into `services/api` (rejected in D1/D4 for CORS/cache separation, but cheap to
   revisit before code lands).
5. **Trust field naming** — DTOs bake in `trust`/`trustFor`/`trustAgainst`; fine for Intuition
   branding, but this is the wire contract third parties will build against. Confirm before v1.

---

## 5. Effort & sequencing estimate

| Phase | Scope | Rough size |
|---|---|---|
| 1 | Port embed + playground, scrub, conventions | 2–3 days (strictness fixes are the bulk) |
| 2 | embed-api BFF on existing endpoints | 2–3 days |
| 3 | Core API market endpoints + live wiring | 3–5 days (touches services/api + Rust read models understanding) |
| 4 | Docker/CI/publishing/docs/deploy | 1–2 days |
| 5 | Backlog | ongoing |

Phases 1 and 2 are independent enough to parallelize; Phase 3 is the only one touching
`services/api` and should go issue-first per CONTRIBUTING. Total: roughly two focused weeks to a
fully integrated, documented, deployed open-source embed stack.
