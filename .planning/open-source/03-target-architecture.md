# 03 — Target Architecture: Repos, Mapping & the "Run Your Own Node" Stack

> Which GitHub repos we create, what goes where, and how a community developer runs the whole thing.

---

## 1. The decision: hybrid topology (D1)

We split by **artifact type**, not by service boundary:

- **Reusable libraries** (pure, deterministic, no infra) → published to **npm via the existing
  `0xIntuition/packages` repo**. They are siblings of what's already there and reuse its release
  machinery.
- **Deployable services + their data contracts + a one-command stack** → a **new polyglot monorepo,
  `0xIntuition/node`**, with a top-level `docker-compose` that boots the whole backend.

### Why hybrid (and not the alternatives)

| Option | Verdict | Reason |
|---|---|---|
| **A. One mega-repo for everything** | ✗ | Mixes npm-publishable libs with deployable services; pollutes the clean SDK story; forces service-CI concerns onto libraries. |
| **B. One repo per service** (`indexer`, `api`, `atom-services`, …) | ✗ for v1 | Fragments the "run your own node" experience (the headline value), multiplies CI/reconciliation overhead 6×, and no service yet has independent community traction to justify its own repo. Split out *later* if one does. |
| **C. Hybrid: extend `packages` + new `node` monorepo** | ✓ | Libraries land where the ecosystem already looks (npm `@0xintuition/*`); deployables get one coherent home with one docker-compose. Matches the existing precedent and the polyglot shape of the monorepo today. |

The current monorepo is already a Bun + Cargo polyglot, so extracting a polyglot `node` repo is a
natural slice, not a new pattern.

## 2. Repo map

### Repo 1 — `0xIntuition/packages` (existing, extend)

Add the **atom-intelligence libraries** as new npm packages, following the existing publish-order and
`@alpha` dist-tag rules:

- `@0xintuition/atom-parser`
- `@0xintuition/atom-classification`
- `@0xintuition/atom-classification-example-plugin`
- `@0xintuition/atom-enrichment`
- `@0xintuition/atom-rules-engine`
- `@0xintuition/types` (shareable subset — the classification/enrichment/feed/workflow schemas)

Rationale: all are pure TS, plugin-architected, no infra coupling, and directly continue the SDK
narrative ("now derive *and* classify/enrich atoms locally"). The `database-*` packages *may* also be
published here later (they're npm-shaped), but for v1 they live in `node` next to the services that
consume them (§3) to keep the runnable stack self-contained.

### Repo 2 — `0xIntuition/node` (new, polyglot monorepo)

> Working name. Product name "Intuition Node" / "run your own node." Alternatives: `infra`, `indexer`,
> `backend`. Marketing to confirm (D4). Note the marketing subdomain is `unchained.intuition.systems`
> but site copy uses "onchain or off," so "unchained" is **not** an established product term — don't
> assume it for the repo name.

Proposed layout:

```
0xIntuition/node/
├─ README.md                      # "Run your own Intuition node" — the front door
├─ docker-compose.yml             # full stack: datastores + all services
├─ docker-compose.datastores.yml  # just Postgres+Timescale, Postgres-KG, SurrealDB, Redis
├─ .env.example                   # placeholders only, zero real keys
├─ Cargo.toml                     # Rust workspace
├─ package.json                   # Bun workspace
├─ crates/
│  ├─ shared/                     # from indexing-services/crates/shared
│  ├─ curves/                     # vendored from backend/curves (resolves the path-dep blocker)
│  ├─ indexer/                    # rindexer-ingestion
│  ├─ projections/                # 17 projection workers
│  ├─ embeddings/                 # embed-on-create + embeddings-job (feature-gated, optional)
│  ├─ recommendation/             # recommendation-service
│  └─ atom-parser-rs/             # the dormant Rust parity service (reference)
├─ services/
│  ├─ api/                        # backend/api (TS/Hono)
│  ├─ atom-services/              # classify/enrich HTTP service (TS/Hono)
│  ├─ atom-warden/                # EIP-712 claim signing (TS/Hono)
│  └─ workers/                    # background parse/classify/enrich (TS/Bun)
├─ packages/
│  ├─ database-kg/                # PostgreSQL schema (Drizzle)
│  ├─ database-timescale/         # TimescaleDB schema (Drizzle)
│  └─ database-surreal/           # SurrealDB schema
├─ migrations/                    # numbered SQL migrations + surreal setup
├─ docker/                        # the per-service Dockerfiles (sanitized)
└─ docs/
   ├─ run-your-own-node.md
   ├─ architecture.md
   ├─ writing-a-classification-plugin.md
   └─ services/<one per service>.md
```

The TS services depend on the atom-intelligence libraries via npm (`@0xintuition/atom-*@alpha`), so
the published Repo-1 packages and the Repo-2 services compose exactly the way a community builder's
would.

### Repo 3 — crates.io (optional, later)

Publish `curves` and `shared` as crates if external Rust developers want to build their own indexers
against Intuition primitives. **Not blocking for v1** — vendoring `curves` into `node` is enough to
ship. Track as a fast-follow.

## 3. The minimal "run your own node" stack

The thing a hackathon team runs:

```
                         ┌────────────────────────────────────────────┐
   Intuition chain  ──►  │  indexer (rindexer-ingestion)               │
   (or any EVM            │    decode MultiVault events                │
    MultiVault)          │    dual-write event_store + typed tables    │
                         └───────────────┬────────────────────────────┘
                                         ▼
                         ┌────────────────────────────────────────────┐
                         │  projections (17 workers)                   │
                         │    → PostgreSQL/TimescaleDB (markets,        │
                         │       positions, leaderboards, signals)     │
                         │    → SurrealDB (atom/triple graph)          │
                         └───────────────┬────────────────────────────┘
                                         ▼
                         ┌────────────────────────────────────────────┐
                         │  workers (parse → classify → enrich)        │
                         │    @0xintuition/atom-parser /-classification│
                         │    /-enrichment plugins                     │
                         └───────────────┬────────────────────────────┘
                                         ▼
                         ┌────────────────────────────────────────────┐
                         │  api (Hono)  ── query the graph you built   │
                         └────────────────────────────────────────────┘

   optional, off by default: embeddings (OpenAI), recommendation-service, atom-warden
```

**Datastores** (one `docker-compose.datastores.yml`): PostgreSQL+TimescaleDB, PostgreSQL-KG,
SurrealDB, Redis.

**Tiered configuration** so the barrier is low:

| Tier | What runs | Third-party accounts needed |
|---|---|---|
| **Minimal** | datastores + indexer + projections + workers + api | **none** |
| **+ Search** | add embeddings | OpenAI key (or pluggable provider) |
| **+ Feed** | add recommendation-service | none (uses Timescale) |
| **+ Trust** | add atom-warden | signer keys; OAuth for GitHub verification |
| **+ Rich enrichment** | enrichment provider plugins | optional per-provider keys (Spotify, Etherscan, …) |

The minimal tier needing **zero paid accounts** is a hard requirement (principle P4).

## 4. How this maps to the live deploy pipeline

Today, prod images build from the private monorepo (`intuition-v2`) → GHCR → `gcp-deployment`
kustomize → ArgoCD. The `node` repo's Dockerfiles are the **same** Dockerfiles (sanitized), so:

- The docker-compose in `node` is the community/local path.
- Intuition's own production continues via GHCR/ArgoCD — and over time, the **build source** for
  those images moves from `intuition-v2` to `node` (see D2 in [04](./04-extraction-reconciliation-security.md)),
  so we dogfood the public repo. That cut-over is the end-state that keeps public and private from
  drifting.

## 5. Naming & branding notes for marketing (D4)

- Repo/product name candidates: **`node`** ("run your own node" — strongest), `infra`, `indexer`,
  `backend`.
- npm scope stays `@0xintuition/*`; new packages slot into the existing org.
- Rust crates (if published): `intuition-curves`, `intuition-shared`, or scoped names per crates.io
  conventions.
- Keep the public framing consistent with the site: "onchain or off," "permissionless," "deterministic,"
  "build on" — a builder-empowerment voice, not heavy ideology.

---

Continue to [`04-extraction-reconciliation-security.md`](./04-extraction-reconciliation-security.md).
