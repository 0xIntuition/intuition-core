# Intuition Core — Open-Source Monorepo Spec

**Status:** Draft v1 — for CTO / Lead Architect sign-off
**Repo:** `intuition-core` (this repository — the new public monorepo)
**Author:** CTO / Lead Architect
**Created:** 2026-06-30
**Source of record (private):** `/Users/metasudo/workspace/intution/workspace/alpha` (`intuition-v2`)
**Builds on:** the 9-document program in `alpha/.planning/open-source/` (00–08). That program is the
*reference detail*; **this document is the actionable spec for standing up `intuition-core`.**

---

## 0. TL;DR

We are extracting the backend that *runs* the Intuition knowledge graph — the Rust indexer, the
projection workers, the atom parse/classify/enrich intelligence, and a query API — out of our private
monorepo and into **this public repo, `intuition-core`**, plus a set of npm packages. The headline
deliverable is **"Intuition in a box": one `docker compose up` stands up the datastores, indexer,
workers, and API with zero paid third-party accounts in the minimal tier.** A companion **hosted
Intuition API** is the same pipeline as a managed endpoint for builders who don't want to self-host.

The work is **scrub, package, and document what already runs in production** — not a rewrite. The
plugin architectures, Dockerfiles, and migrations already exist. The marginal cost is decoupling
(auth/billing/embeddings provider seams), parameterization (no hardcoded RPC/keys), a secret-scan
publish gate, and first-class docs.

---

## 1. Naming: this is "Intuition Core" (decision to confirm)

The marketing site (`intuition-ecosystem-launchpad/src/variants/core.ts`, `api.ts`) brands the
product **"Intuition Core" — "the whole backend, open-source and self-hosted… a database and an API
in a box."** This repo is named `intuition-core`. **The product name is resolved: Core.**

> **Open item N1 — repo slug.** The prior plan (`alpha/.planning/open-source/03`) and the marketing
> *clone commands* still say `0xIntuition/node` (e.g. `git clone 0xIntuition/node && docker compose
> up`). We must pick one and make it consistent everywhere:
> - **Recommendation:** publish as **`0xIntuition/core`** (matches product name + this repo) and update
>   the marketing clone commands from `node` → `core`.
> - npm scope stays `@0xintuition/*`.
> - Action: confirm with marketing; then fix the `core.ts`/`api.ts` clone snippets and the prior
>   plan's repo references.

Throughout this spec, **"Core"** = this repo = the deployable backend-in-a-box.

---

## 2. The two products we ship

| | **Core** (this repo) | **Intuition API** (hosted) |
|---|---|---|
| What | Self-hosted backend: indexer + workers + datastores + query API, `docker compose up` | Same pipeline as a managed, metered endpoint |
| Audience | Sovereignty, privacy, verification, hackathons | Ship fast, scale, don't run infra |
| Cost | Free · your infra · **zero paid accounts (minimal tier)** | Metered · generous free tier |
| Setup | `docker compose up` | An API key |
| Surface | Same deterministic atoms; REST/GraphQL over your shard | Four verbs — Resolve, Enrich, Classify, Query — over the full graph |
| Source | Open (MIT) | Runs *on* Core; the hosted layer (billing/auth/scale) stays private |

Both produce the **same deterministic atoms** — "start hosted, move to self-host, or run both;
nothing migrates." Core is the open artifact this program delivers. The hosted API is Core +
Intuition's private operational layer (auth, billing, scale, managed provider keys), and is **not**
open-sourced — only its public request/response shape is documented.

---

## 3. Scope

### In scope (extract → `intuition-core` + npm)
- **Rust indexing pipeline:** `rindexer-ingestion` (indexer), `projections` (17 workers), `shared`
  crate, `curves` crate (bonding-curve math), the dormant `atom-parser-service` (reference parity),
  and feature-gated `embeddings` (`embed-on-create` + `embeddings-job`).
- **Atom-intelligence TS libraries (→ npm `@0xintuition/*`):** `atom-parser`, `atom-classification`
  (+ `atom-classification-example-plugin`), `atom-enrichment`, `atom-rules-engine`, and the
  shareable subset of `types`.
- **TS services:** `workers` (parse/classify/enrich pipeline), `atom-services` (classify/enrich HTTP),
  `atom-warden` (EIP-712 claim signing), and a **query API** (see §6 — decoupled from auth).
- **Data layer:** `database-kg`, `database-timescale`, `database-surreal` schemas + migrations.
- **Recommendation service** (Rust, Axum + pgvector) — cleanest service in the set.
- **Datastores + one-command stack:** Postgres+TimescaleDB, Postgres-KG, SurrealDB, Redis, wired by
  a top-level `docker-compose.yml`.

### Out of scope (stays private — confirmed against the codebase)
- Frontend apps (`apps/experimental`, `apps/admin`, `apps/funnel`, `apps/atom-warden-portal`).
- **Auth + billing:** `@0xintuition/authentication`, `@0xintuition/database-auth` (Better Auth +
  Stripe billing schemas), `@0xintuition/stripe`, `@0xintuition/email*`. The API must boot without them.
- Internal infra: `gcp-deployment` (kustomize/ArgoCD/Secrets), internal deploy workflows,
  `backend/experimentation` (GrowthBook), internal e2e-financial harnesses.
- Internal provenance: `.planning/`, `.agents/`, Linear refs (ENG-XXXX), all credentials.

### Non-goals
- Not a rewrite. Not a multi-operator/decentralized-sequencer system (that's the later "network"
  phase). Not a support SLA — best-effort, issue-first, community-first.

---

## 4. Grounded codebase inventory (verified 2026-06-30)

Readiness = rough % publishable as-is. Sourced from a direct audit of `backend/` + `packages/`.

### 4a. Rust (the technical centerpiece)
| Component | Path (private) | Prod? | Ready | Blockers |
|---|---|---|---|---|
| `shared` crate | `backend/indexing-services/crates/shared` | dep | 90% | clean |
| `curves` crate | `backend/curves` | dep | 95% | clean; **must travel with indexer** (resolves path-dep) |
| `rindexer-ingestion` | `backend/indexing-services/crates/rindexer-ingestion` | ✅ | 85% | hardcoded `rpc.intuition.systems` fallback; diagnostics hardcode testnet RPC; `.env.example` has Caldera URL + dev Alchemy key; parameterize contract/chain/start-block |
| `projections` (17 workers) | `backend/indexing-services/crates/projections` | ✅ | 90% | **`curves = { path = "../../../curves" }`** path-dep → vendor; strip Linear refs |
| `embed-on-create` + `embeddings-job` | `backend/indexing-services/crates/*` | ✅ | 50% | **hard OpenAI coupling** → feature-gate + provider seam; finish single→dual DB-pool migration |
| `recommendation-service` | `backend/recommendation-service` | ✅ | 90% | none — Timescale-only, no auth/billing. Cleanest. |
| `atom-parser-service` | `backend/atom-parser-service` | dormant | 90% | ship as Rust **reference parity** impl (shared fixtures prove parity) |

**17 projection workers:** 10 PG-only (event_log, account_registry, vault_state, position_tracking,
vault_holders_index, signals_analytics, term_aggregates, protocol_stats, leaderboard_marker,
leaderboard_refresh), 6 SurrealDB-only (atom, triple, deposit, redeem, price, fee), 1 dual-write
(core_entities). Checkpointed via `projection_checkpoints`; exhaustive error classification.

### 4b. Atom intelligence (TS → npm) — the extensibility story
| Package | Prod? | Ready | Notes |
|---|---|---|---|
| `@0xintuition/atom-parser` | ✅ active | 95% | URL/IPFS/ENS/ETH/JSON → typed atom; deps `viem`, `multiformats`; no coupling |
| `@0xintuition/atom-classification` | ✅ active | 95% | deterministic, **15 built-in plugins** (Spotify, X, GitHub, Amazon, Wikipedia/Wikidata…); all provider keys optional |
| `@0xintuition/atom-classification-example-plugin` | example | 100% | the "here's how you extend us" template — keep as marketing |
| `@0xintuition/atom-enrichment` | ✅ active | 90% | provider plugins (Spotify, GitHub, Etherscan, Wikipedia, Brandfetch, Google GenAI) — all optional, degrade gracefully; memory/Upstash cache |
| `@0xintuition/atom-rules-engine` | ✅ active | 95% | pure decision logic; zero external deps |
| `@0xintuition/types` (subset) | ✅ | 90% | shareable classification/enrichment/feed/workflow Zod schemas |

> Marketing numbers to reconcile in copy: site says **"37 classifications," "97 enshrined
> predicates," "~2 dozen source adapters."** The code has **15 built-in classification plugins**.
> These describe different things (classification *types* in `@0xintuition/classifications` vs.
> classifier *plugins*) — confirm the final figures with the published `classifications`/`predicates`
> specs before launch so docs and marketing agree.

### 4c. TS services & data layer
| Component | Prod? | Ready | Blockers |
|---|---|---|---|
| `backend/api` | ✅ | 75% | **`api → trpc → authentication + database-auth` coupling** (see §6); no README; protocol/chain coupling undocumented; OAuth undocumented; `/api/test` correctly gated behind `E2E_API_ENABLED` |
| `backend/workers` | ✅ | 80% | Dockerfile needs full-monorepo workspace copy (standard pattern); ensure all provider keys optional |
| `backend/atom-services` | built, dormant | 85% | clean; auth token already optional |
| `backend/atom-warden-service` | ✅ | 85% | needs signer private keys (env); no classification deps |
| `packages/database-kg` (Drizzle/PG) | ✅ | 90% | KG schema: nodes (parse/classify/enrich state machine), triples, accounts, predicates, artifacts, events, social layer |
| `packages/database-timescale` (Drizzle) | ✅ | 90% | event_store hypertable, typed event tables, read models, continuous aggregates, 39+ migrations |
| `packages/database-surreal` | ✅ | 90% | atom/triple graph read model; isolated from auth |

### 4d. Already public (the precedent — do not re-extract)
`0xIntuition/packages` already publishes the protocol/identity/vocabulary layer to npm `@alpha`:
`protocol`, `primitives`, `cli`, `predicates`, `classifications`, `curves` (TS), `ids`, `periphery`
(+ `react`, `schema-org`). These give us the **license (MIT), `@alpha` dist-tag, release runbook,
validation gate, and `guard:supply-chain`** we reuse. This program **adds sibling packages**, it does
not touch the existing ones.

> Naming overlap to keep straight: the published **TS `@0xintuition/curves`** (bonding-curve SDK) is
> *separate from* the **Rust `curves` crate** we vendor into Core. Same concept, different language.

---

## 5. Target layout of `intuition-core`

```
intuition-core/
├─ README.md                       # "Run your own shard of the graph" — the front door
├─ LICENSE                         # MIT (matches packages)
├─ CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md  CODEOWNERS
├─ docker-compose.yml              # full stack: datastores + all services
├─ docker-compose.datastores.yml   # just Postgres+Timescale, Postgres-KG, SurrealDB, Redis
├─ .env.example                    # placeholders only — zero real keys
├─ Cargo.toml                      # Rust workspace
├─ package.json                    # Bun workspace
├─ turbo.json
├─ crates/
│  ├─ shared/                      # ← indexing-services/crates/shared
│  ├─ curves/                      # ← backend/curves (vendored; resolves the path-dep)
│  ├─ indexer/                     # ← rindexer-ingestion
│  ├─ projections/                 # ← 17 projection workers
│  ├─ embeddings/                  # ← embed-on-create + embeddings-job (feature-gated, OFF by default)
│  ├─ recommendation/              # ← recommendation-service
│  └─ atom-parser-rs/              # ← dormant Rust parity service (reference)
├─ services/
│  ├─ api/                         # query API (decoupled from auth — see §6)
│  ├─ atom-services/               # classify/enrich HTTP (Hono)
│  ├─ atom-warden/                 # EIP-712 claim signing (Hono)
│  └─ workers/                     # background parse → classify → enrich (Bun)
├─ packages/
│  ├─ database-kg/                 # PG KG schema (Drizzle)
│  ├─ database-timescale/          # TimescaleDB schema (Drizzle)
│  └─ database-surreal/            # SurrealDB schema
├─ migrations/                     # numbered SQL + SurrealDB setup
├─ docker/                         # per-service Dockerfiles (sanitized)
├─ scripts/
│  ├─ bootstrap.sh                 # the "one button" — §7
│  └─ oss-sync/{sync,scrub,gate}.sh  # reconciliation tooling — §9
└─ docs/
   ├─ run-your-own-node.md  architecture.md  configuration.md  troubleshooting.md
   ├─ data-model.md
   ├─ services/<one per service>.md
   └─ writing-a-classification-plugin.md  writing-an-enrichment-plugin.md  indexing-another-contract.md
```

**Atom-intelligence libraries do NOT live here** — they ship to npm via `0xIntuition/packages`
(`@0xintuition/atom-parser`, `/atom-classification`, `/atom-classification-example-plugin`,
`/atom-enrichment`, `/atom-rules-engine`, `/types`). Core's TS services consume them as
`@0xintuition/atom-*@alpha`, so the stack composes exactly the way a community builder's would. This
hybrid (npm libs + one deployable monorepo) is the resolved topology (prior plan D1).

**Data packages:** vendored *inside* Core for v1 so the runnable stack is self-contained; publish to
npm later only if external consumers want the schemas standalone (prior plan D7).

---

## 6. The API decoupling — the one real refactor (decision)

This is the single biggest extraction blocker the audit surfaced, and it's deeper than the prior
plan's "make auth optional." The dependency chain is:

```
backend/api  →  @0xintuition/trpc  →  @0xintuition/authentication  →  database-auth + stripe + email
                       └────────────→  database-auth (Better Auth schema)
```

So `backend/api` cannot boot without dragging in auth + billing. Three options:

- **Option A — Ship a clean read API (recommended for v1).** Core's public API exposes the **graph
  read surface** that needs no auth: the existing REST routes (`/api/atoms`, `/triples`, `/stacks`,
  `/market`, `/media`, `/_health`, `/metrics`) plus a GraphQL/query endpoint, reading the datastores
  directly (KG + SurrealDB + Timescale). Leave the auth-coupled tRPC routers out of the public build.
  Lowest risk; matches the "query the graph you built" promise without exporting billing.
- **Option B — Split tRPC.** Refactor `@0xintuition/trpc` into `trpc-core` (graph routers, no auth) +
  `trpc-private` (auth/billing). More work; needed eventually if we want the full tRPC surface public.
- **Option C — Stub auth.** Make `authentication` boot with null secrets. Brittle; still pulls Stripe
  into the dependency graph. Not recommended.

> **Decision N2 — adopt Option A for v1, Option B as a fast-follow.** Confirm with backend lead.
> This keeps the minimal tier truly zero-paid-account and avoids publishing any billing code.

**Marketed verbs vs. real surface.** The Core marketing quickstart shows `POST /index`,
`POST /resolve`, `POST /graphql`, and `query { atoms { id label } }`. The real services expose
`/api/atoms` (REST) and the workers' resolve pipeline separately. **A thin "node facade"** that maps
the four marketed verbs (`/index`, `/resolve`, `/query`, classify) onto the existing services is a
small but necessary deliverable so the README quickstart actually works as written. Track as part of
the API workstream.

---

## 7. The "one button" bootstrap (the core requirement)

The user's hard requirement: *"everything ready to go, basically with the click of a button — databases,
services, APIs, etc."* Design:

**`docker compose up` is the button.** It must, with no flags and no accounts:
1. Start datastores: Postgres+TimescaleDB, Postgres-KG, SurrealDB, Redis (healthchecks gate dependents).
2. Run all migrations automatically (a one-shot `migrate` service that exits 0 before services start):
   Drizzle push for KG/Timescale, SurrealDB setup, Rust SQL migrations.
3. Seed sane defaults (optional `seed` profile with sample atoms so a first query returns data).
4. Start the minimal tier: `indexer` → `projections` → `workers` → `api`.
5. Surface the API on `localhost:3000` with `/_health` green.

**Supporting pieces:**
- `scripts/bootstrap.sh` — preflight (Docker/Bun/Rust present), `cp .env.example .env` if missing,
  `docker compose up`, then poll `/_health` and print the first example query. This is the literal
  "one command" for people who want a wrapper over compose.
- **Tiered compose profiles** so the floor stays low (zero paid accounts) and power is opt-in:

| Tier | Adds | Profile | Paid accounts |
|---|---|---|---|
| **Minimal** | datastores + indexer + projections + workers + api | (default) | **none** |
| **+ Search** | embeddings | `--profile search` | OpenAI **or** pluggable provider |
| **+ Feed** | recommendation-service | `--profile feed` | none (Timescale only) |
| **+ Trust** | atom-warden | `--profile trust` | signer keys; OAuth for GitHub verification |
| **+ Rich enrichment** | enrichment provider plugins | env keys | optional per-provider keys |

The **minimal tier needing zero paid accounts is a hard, testable launch gate** (prior plan P4/G1).

---

## 8. Per-component scrub checklist (the blockers to clear)

**Rust indexer / projections / embeddings**
- [ ] Remove hardcoded `rpc.intuition.systems` fallback in `rindexer-ingestion/src/main.rs`.
- [ ] Parameterize diagnostics binaries (RPC via arg/env, not hardcoded testnet).
- [ ] Remove dev Alchemy key + Caldera URL from `.env.example` → placeholders.
- [ ] Parameterize contract address / chain ID / start block (env-only, sane local defaults).
- [ ] Vendor `curves` crate into `crates/curves` (resolve `../../../curves` path-dep).
- [ ] Feature-gate embeddings; provider seam; OpenAI/Anthropic as default-OFF reference.
- [ ] Resolve/document the single→dual DB-pool split (`DATABASE_KG_URL` / `DATABASE_TIMESCALE_URL`).
- [ ] Strip internal Linear refs (ENG-XXXX) from comments/READMEs.

**TS API / services / workers**
- [ ] Implement the API decoupling (§6 Option A): public read API with no auth/billing in the build.
- [ ] Build the node facade mapping marketed verbs → services (§6).
- [ ] Add `services/api/README.md`; document `@0xintuition/protocol` chain coupling.
- [ ] Confirm `/api/test` stays gated behind `E2E_API_ENABLED`.
- [ ] Standardize the workers Dockerfile workspace-copy pattern.
- [ ] Ensure all classification/enrichment provider keys optional with graceful degradation.

**Every repo / publish**
- [ ] MIT `LICENSE`; `.env.example` placeholders only; no internal hostnames/partner URLs/provenance.
- [ ] `bun.lock` / `Cargo.lock` reviewed for private registry refs.

---

## 9. Reconciliation & security gate (don't destabilize prod, never leak a secret)

**The tension:** prod images build from the private monorepo (`intuition-v2` → GHCR → `gcp-deployment`
→ ArgoCD). We can't fork-and-drift, and we can't stop shipping.

**Model (prior plan D2):** **mirror during transition → cut over at the end.**
- *Phase A:* keep developing in the monorepo; a scrubbed one-way mirror (`scripts/oss-sync/*` —
  subtree-split or filtered export per component) pushes to `intuition-core` on a cadence, every push
  through the security gate + human diff review.
- *Phase B (post-launch):* move each component's build source to `intuition-core` so drift becomes
  structurally impossible. **This touches the prod deploy pipeline and needs explicit CTO + platform
  sign-off before it happens.**

**Security gate — non-negotiable, fail-closed, on every publish:**
1. Secret scan on working tree (`gitleaks` + `trufflehog`) — clean.
2. **Full git-history scan** of any exported path. If history ever held a secret, publish a
   **squashed/fresh-history snapshot**, not a subtree carrying old commits. Default to fresh history
   for each component's first publish.
3. Supply-chain gate — reuse `guard:supply-chain`; `bun install --frozen-lockfile`; no Git-URL deps,
   no lifecycle install scripts, no added `trustedDependencies`.
4. Manual diff review by a named reviewer for the first export of each component.
5. No `pull_request_target` workflows executing untrusted PR code; publish creds isolated to reviewed
   release jobs.

**Determinism freeze (prior plan P1):** anything affecting derived bytes — classification slugs,
predicate keys, parser output shapes, schema URLs, atom/triple ID derivation — is frozen and
review-gated. A change here is an *identity fork* and ships only with an explicit migration note.

---

## 10. Phased execution plan (≈5 weeks + buffer)

Ship in layers, lowest-risk first; each phase independently valuable and gated on the prior being
clean. Embeddings (provider-coupled) and the deploy-source cut-over (prod-touching) are sequenced late
on purpose.

| Phase | Goal | Key exit criteria |
|---|---|---|
| **P0 — Foundations** (~3 days) | decisions locked, repo + gates exist | N1 (name), N2 (API decoupling), D2 (reconciliation) signed off; `intuition-core` branch protection + CODEOWNERS + security-gate CI; `scripts/oss-sync/*` skeleton; owners assigned |
| **P1 — Atom-intelligence libs** (Wk 1) | `@0xintuition/atom-*@alpha` on npm | parser/classification/enrichment/rules-engine/example-plugin/types extracted to `0xIntuition/packages`; provider keys optional; per-package READMEs; hackathon example extended to parse→classify→enrich; published via existing gate |
| **P2 — Core skeleton + data + indexer scrub** (Wk 2) | datastores boot + migrations + indexer builds clean | `docker-compose.datastores.yml` up; `database-*` vendored; migrations apply; indexer/projections scrubbed (RPC/keys/Linear refs) + `curves` vendored |
| **P3 — Indexing + recommendation public** (Wk 3) | chain → queryable graph is public + runnable | `indexer` + `projections` verified against Intuition chain in the public layout; embeddings feature-gated + provider seam; `recommendation-service` published; **independent-reconstruction spike**; begin D2 cut-over *planning* (don't flip prod) |
| **P4 — API + services + workers + full stack** (Wk 4) | the full "run your own shard" experience | API decoupling (§6) shipped; node facade for marketed verbs; `atom-services`, `atom-warden`, `workers` published; top-level `docker-compose.yml`; **minimal tier boots with zero paid accounts**; `run-your-own-node.md` + `architecture.md` + plugin guides |
| **P5 — Hardening & launch** (Wk 5 + buffer) | safe, polished, coordinated launch | external-eyes security review + full-history scan; **docs acceptance gate** (outsider reaches a queried graph unaided); independent-reconstruction check passes; flip public; announcement coordinated with app launch; success metrics instrumented |

**Sequencing:** P1 (libs) and P2 (data+indexer) run in parallel (different teams). P4 needs both.
P5 needs all.

**Workstreams (named ownership, not headcount):** WS-A Libraries (SDK/TS eng), WS-B Indexing/Rust
(Rust eng), WS-C API & Services/TS (backend eng), WS-D Data & Infra (platform/DevOps), WS-E Docs &
DevRel, WS-F Security & Reconciliation (the hard dependency for every publish). Program lead: CTO.

---

## 11. Decisions ledger

| ID | Decision | Recommendation | Status |
|---|---|---|---|
| N1 | Repo slug | `0xIntuition/core` (product = "Intuition Core"); update marketing `node`→`core` | **needs confirm** |
| N2 | API decoupling | Option A: ship clean read API for v1; tRPC split (Option B) as fast-follow | **needs confirm** |
| D1 | Repo topology | Hybrid: extend `packages` (npm libs) + this `core` monorepo (services + datastores + compose) | resolved |
| D2 | Reconciliation / deploy source | Mirror during transition → cut over post-launch (CTO + platform sign-off) | **needs sign-off** |
| D3 | License | MIT (matches `packages`) | resolved |
| D5 | Embeddings provider | optional, feature-gated, provider seam, OFF in minimal tier | resolved |
| D6 | Atom-parser duality | publish both — TS active lib + Rust reference parity service | resolved |
| D7 | Data packages | vendor in `core` for v1; npm later if demand | resolved |
| D8 | Rust crates → crates.io | fast-follow after v1; vendoring `curves` is enough to ship | resolved |

---

## 12. Risks (top of register)

| Risk | Mitigation |
|---|---|
| Secret/credential leak in code or history | Mandatory gitleaks+trufflehog on tree **and full history**; fresh-history snapshots; manual diff review; fail-closed gate (§9) |
| Public/private drift | Mirror cadence + reconciliation tooling; end-state cut-over makes drift structurally impossible |
| API decoupling balloons in scope | Option A (read-only public API) caps it; defer tRPC split (§6) |
| Outsider can't actually run it | Docs acceptance gate — outsider reaches a queried graph unaided before launch (P5) |
| Embeddings/provider coupling forces paid accounts | Feature-gate; all provider keys optional; minimal tier = zero paid accounts (hard gate) |
| Identity fork from a scrub/refactor | Determinism freeze + review on identity-sensitive surfaces; parser parity fixtures |
| Launch slips from app-launch narrative | Layered phases each independently valuable; libs (P1) can ship early; buffer week |

---

## 13. Definition of done (launch gate — all must be true)

- [ ] Minimal stack boots from `intuition-core` with **zero paid third-party accounts**.
- [ ] `docker compose up` → datastores + migrations + indexer + projections + workers + API, `/_health` green.
- [ ] An outsider follows `run-your-own-node.md` from a clean machine and reaches a queried graph **unaided**.
- [ ] Secret-scan gate passing on all published repos **and their history**.
- [ ] Independent-reconstruction check: indexer output matches the hosted view on a sample range.
- [ ] `@0xintuition/atom-*@alpha` packages installable; the example plugin runs.
- [ ] Launch content (announcement, FAQ, demo recording) ready; flip coordinated with the app launch.

---

## 14. Immediate next actions

1. **Confirm N1 (name → `core`) and N2 (API decoupling → Option A).** They shape P0–P4.
2. **CTO + platform sign-off on D2** (reconciliation / eventual deploy-source cut-over).
3. **Scaffold `intuition-core` P0:** workspace manifests (`Cargo.toml`, `package.json`, `turbo.json`),
   `docker-compose.datastores.yml`, `.env.example` (placeholders), MIT `LICENSE`, security-gate CI,
   `scripts/oss-sync/*` skeleton, CODEOWNERS + branch protection.
4. **Kick off WS-A (libs) and WS-B (indexer scrub + `curves` vendor) in parallel.**
5. **Assign WS-F (Security & Reconciliation) owner** — the hard dependency for every publish.

---

*Reference detail for any section lives in the private program docs at
`alpha/.planning/open-source/00…08`. This spec supersedes them as the execution plan for the
`intuition-core` repository.*
