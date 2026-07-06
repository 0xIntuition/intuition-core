# 02 — Codebase Inventory & OSS-Readiness Audit

> The "understand the monorepo" deliverable. Every backend component, what language it is, whether
> it's actually used in production, the Rust/TypeScript duality, and what blocks open-sourcing it.
> Sourced from a direct audit of `backend/` and `packages/` plus the live deploy manifest.

---

## 0. How to read this

- **Used in prod?** is grounded in the deploy manifest (`.agents/docs/deploy.md`). Prod-active
  services: `api`, `embed-on-create`, `embeddings-job`, `intuition-workers`, `projections`
  (3 overlays), `recommendation-service`, `rindexer-ingestion`. `atom-parser` and `atom-services`
  have **no active testnet-dev Application** (ENG-12059) — their logic runs inside `workers`.
- **Readiness** is a rough % of "publishable as-is" vs. "needs scrub/extraction work."
- Blockers are detailed in [04](./04-extraction-reconciliation-security.md); this doc inventories them.

---

## 1. Already public (the precedent) — `0xIntuition/packages`

10 published npm packages, MIT, `@alpha` dist-tag: `schema-org`, `classifications`, `predicates`,
`ids`, `primitives`, `protocol`, `deployments`, `periphery`, `curves` (TS), `react`. These are the
**identity + protocol + vocabulary** layer. This program does **not** touch them except to *add*
sibling packages (the atom-intelligence libs, §3). They establish the license, release runbook,
dist-tag policy, validation gate, and "generated-from-spec / public-repo-is-canonical" model we
reuse.

> Note a naming overlap to resolve: a TS `@0xintuition/curves` is already published; the backend has
> a **separate Rust `curves` crate** (§2). Different language, same concept. See D6 / [03](./03-target-architecture.md).

---

## 2. Rust backend — `backend/indexing-services/` and friends

The technical centerpiece. A complete blockchain-event → queryable-graph pipeline.

**Pipeline:** RPC → `rindexer-ingestion` (decodes MultiVault events, dual-writes to an append-only
`event_store` hypertable + typed per-event tables) → **17 projection workers** → PostgreSQL/TimescaleDB
(vaults, positions, PnL leaderboards, term aggregates, signals) **and** SurrealDB (atoms/triples graph)
→ optional embeddings (OpenAI) → Prometheus metrics.

| Component | Lang | Kind | Used in prod? | Readiness | Notes / blockers |
|---|---|---|---|---|---|
| `crates/shared` | Rust | lib | yes (dep) | 90% | Domain types, sealed `ParsedEvent`, DB + metrics helpers. Clean. |
| `rindexer-ingestion` | Rust | service | **yes** | 85% | Core indexer. Blockers: hardcoded fallback RPC `rpc.intuition.systems`; diagnostics hardcode testnet RPC; `.env.example` has Caldera URL + a dev Alchemy key; assumes MultiVault ABI/contract. All fixable by parameterization. |
| `projections` (17 workers) | Rust | service | **yes** (3 overlays: pg, core-entities, analytics) | 90% | Excellent: checkpointed, exhaustive error classify, dual-write. **Blocker:** path-dep `curves = { path = "../../../curves" }` must be vendored or published. |
| `embed-on-create` | Rust | service | **yes** | 50% | Synchronous embed worker. **Hard-coupled to OpenAI** (`OPENAI_API_KEY`, model hardcoded). Needs feature-gate + provider seam. Also expects dual DB pool (`DATABASE_KG_URL` + `DATABASE_TIMESCALE_URL`). |
| `embeddings-job` | Rust | lib + backfill bin | **yes** | 50% | Batch OpenAI embeddings. Same coupling as above. |
| migrations / surreal-migration | Rust/SQL | tooling | yes | 95% | 39+ numbered migrations; generic, well-documented. |
| `backend/curves/` | Rust | lib (crate) | yes (dep of projections) | 95% | Bonding-curve math mirroring Solidity. Fully clean, no internal coupling. Must travel with the indexer. |
| `backend/recommendation-service/` | Rust | service | **yes** | 90% | Axum + SQLx + pgvector, 4-stage plugin ranking pipeline. Reads TimescaleDB only; **no auth/user/Stripe coupling**. Self-contained Dockerfile. Cleanest service in the set. |

**Datastores:** PostgreSQL/TimescaleDB (event store, dimensions, continuous aggregates, leaderboard
cache), SurrealDB (atom/triple graph), Redis (ingestion leader election).

**Cross-cutting Rust blockers:** OpenAI coupling (embeddings only), hardcoded RPC/contract values,
`curves` path dependency, dev API key in `.env.example`, internal Linear ticket refs in
comments/READMEs, partial single→dual DB-pool migration.

---

## 3. Atom intelligence — the Rust/TS duality

This is the area the brief specifically flagged. The parser exists in **both** Rust and TS; the
classification/enrichment/rules layers are **TS only**.

| Component | Lang | Kind | Used in prod? | Readiness | Notes |
|---|---|---|---|---|---|
| `@0xintuition/atom-parser` (`packages/atom-parser`) | TS | lib | **yes (active)** | 95% | Parses raw input (URL/IPFS/ENS/Ethereum/JSON) → typed atom. Used by `workers`. Deps: `viem`, `multiformats`. No provider coupling. |
| `backend/atom-parser-service` | Rust | service | **dormant** | 90% | Axum service with **exact semantic parity** to the TS lib (mirrored `detect.rs`/`detect.ts`, `remote.rs`/`remote.ts`, shared fixtures). Has a Dockerfile but **no active deploy** (ENG-12059). Publish as the *reference parity implementation*. |
| `@0xintuition/atom-classification` | TS | lib | **yes (active)** | 95% | Deterministic, plugin-first classifier. **15 built-in plugins** (Spotify, X, GitHub, Amazon, …). Stateless. The flagship extensibility story. |
| `@0xintuition/atom-classification-example-plugin` | TS | example | example | 100% | Minimal external plugin (classifies `idea:*`). The "here's how you extend us" template — keep it; it's marketing for the plugin model. |
| `@0xintuition/atom-enrichment` | TS | lib | **yes (active)** | 90% | Plugin-based metadata enrichment (images, descriptions, provenance). Provider plugins (Spotify, GitHub, Etherscan, Wikipedia) need optional API keys; degrade gracefully. Memory/Upstash cache. |
| `@0xintuition/atom-rules-engine` | TS | lib | **yes (active)** | 95% | Pure decision logic: classification + enrichment → UI presentation variant. Zero external deps. |
| `backend/atom-services` | TS (Hono) | service | built, **not actively deployed** (ENG-12059) | 85% | HTTP wrapper over classify+enrich (`/v1/classify`, `/v1/enrich`, `/v1/process`, batch). Self-contained. The logic ships today via `workers`, but the service is the clean "run classification as an API" artifact. |
| `backend/atom-warden-service` | TS (Hono) | service | **active** | 85% | EIP-712 claim signing + verification (DNS / GitHub-OAuth / historical-creator). Needs signer private keys (env). No classification deps. |

**Duality resolution (D6):** publish **both** parser implementations. TS is the active library and the
default builders reach for; Rust is the reference service kept in parity (and the path to a
high-throughput Rust-native indexer that classifies inline). The shared fixtures are the proof of
parity and should ship as part of the story.

---

## 4. API & workers (TypeScript)

| Component | Lang | Kind | Used in prod? | Readiness | Notes |
|---|---|---|---|---|---|
| `backend/api` (`@0xintuition/api-app`) | TS (Hono + Bun) | service | **yes** | 75% | The public gateway: tRPC passthrough (`@0xintuition/trpc`) + REST (`/api/atoms`, `/triples`, `/stacks`, `/market`, `/media`, health/metrics). Reads KG (SurrealDB + Postgres), Timescale, auth. **Blockers:** no README; `@0xintuition/protocol` chain coupling undocumented; Stripe pulled in via `@0xintuition/authentication` (make truly optional); OAuth setup undocumented; semantic search needs OpenAI (degrades to keyword). Test routes correctly gated behind `E2E_API_ENABLED`. |
| `backend/workers` (`@0xintuition/workers`) | TS (Bun) | service | **yes** (`intuition-workers`) | 80% | Background pipeline: parse / classify / enrich workers (KG + SurrealDB variants) via the atom-intelligence libs. **Blocker:** Dockerfile needs the whole monorepo for Bun workspace resolution — solvable with the standard workspace-copy pattern. No auth coupling. |

## 5. Shared schema / data packages (TypeScript)

| Package | Lang | Datastore | Readiness | Notes |
|---|---|---|---|---|
| `packages/database-kg` | TS (Drizzle) | PostgreSQL | 90% | KG schema: atoms (with parse/classify/enrich state machines), triples, accounts, artifacts, events, predicates + social layer (posts, communities, stacks). `createKgConnection()`. |
| `packages/database-timescale` | TS (Drizzle) | TimescaleDB | 90% | Time-series: events, user-activity, positions, leaderboard, vaults, signals, experiments. Hypertable verification built in. |
| `packages/database-surreal` | TS | SurrealDB | 90% | Atom/triple graph schema, setup, seed generators. Isolated from auth. |
| `packages/types` | TS + Zod | — | 90% | Shared classification/enrichment/timescale/feed/workflow schemas. Imports the atom-intelligence libs. Publish the shareable subset. |

These are the "contract" between the indexer, workers, API, and any community consumer. They must be
published (npm and/or vendored into the `node` repo) for the services to be runnable externally.

## 6. Stays private (in-scope-adjacent but excluded)

| Component | Why it stays private |
|---|---|
| `backend/experimentation` | GrowthBook + Mongo internal A/B infra; coupled to internal product metrics. Expose only the frontend client key. |
| `backend/e2e-tests`, `e2e-financial.yml` | May reference internal testnet addresses/URLs; audit and parameterize before any subset ships. Default: private. |
| `gcp-deployment` (separate repo) | Kustomize overlays, ArgoCD, Image Updater, Secrets. We publish Dockerfiles + docker-compose, not cluster wiring. |
| Internal deploy workflows (`deploy-*.yml`, `_deploy-build.yml`) | Tie to our GHCR/ArgoCD. Publish a sanitized CI reference only. |
| `@0xintuition/authentication` + Stripe/billing | Product/auth/billing concerns; the API must run with auth optional rather than exporting our billing flows. |
| `.planning/`, `.agents/`, internal Linear refs | Internal provenance — kept out per the `packages` "public repo hygiene" precedent. |

## 7. Consolidated blocker list (feeds the checklist)

1. **OpenAI coupling** in `embed-on-create` / `embeddings-job` → feature-gate + provider seam (D5).
2. **Hardcoded RPC/contract/chain** values in `rindexer-ingestion` + diagnostics → parameterize.
3. **Dev Alchemy key + Caldera URL** in `.env.example` → remove/replace with placeholders.
4. **`curves` path dependency** → vendor the crate into the `node` repo (and/or publish to crates.io).
5. **Partial single→dual DB-pool** migration (`DATABASE_KG_URL` vs `DATABASE_TIMESCALE_URL`) → finish or document.
6. **API: missing README + Stripe/OAuth/protocol coupling** undocumented → docs + make auth optional.
7. **Workers Dockerfile** needs full-monorepo workspace copy → standard pattern, document.
8. **Internal Linear ticket refs** in Rust comments/READMEs → scrub.
9. **Provider keys** for classification/enrichment plugins (X, Spotify, Etherscan, Brandfetch, Google
   GenAI) → ensure all are optional env with graceful degradation.

---

Continue to [`03-target-architecture.md`](./03-target-architecture.md).
