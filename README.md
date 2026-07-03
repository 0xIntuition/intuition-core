<div align="center">

# Intuition Core

**The open backend, in a box.**

Run your own shard of the world's knowledge graph — a self-hosted indexer,
atom intelligence pipeline, and query API, stood up with one command.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Runtime: Bun](https://img.shields.io/badge/runtime-Bun-000000?logo=bun&logoColor=white)](https://bun.sh)
[![Indexer: Rust](https://img.shields.io/badge/indexer-Rust-B7410E?logo=rust&logoColor=white)](./crates)
[![Language: TypeScript](https://img.shields.io/badge/language-TypeScript-3178C6?logo=typescript&logoColor=white)](./packages)
[![Databases: Postgres + TimescaleDB](https://img.shields.io/badge/databases-Postgres%20%2B%20TimescaleDB-336791?logo=postgresql&logoColor=white)](./docs/architecture.md)

[Quick start](#quick-start) ·
[How it works](#how-it-works) ·
[API](#the-query-api) ·
[Docs](./docs) ·
[Contributing](./CONTRIBUTING.md)

</div>

---

The data was always permissionless. **Core makes the machinery permissionless
too.** Until now, the indexer that turns the chain into a queryable graph, the
pipeline that classifies and enriches it, and the API everyone reads it through
ran in one place. Core hands you the whole machine:

- **Index anything** into atoms and triples with **deterministic IDs** — the ID
  you derive locally is the exact ID the protocol registers onchain. Publishing
  is a state change, not a migration.
- **Classify URLs** with 17 built-in plugins (GitHub, Spotify, Wikipedia, X, …)
  and a [plugin API](./docs/writing-a-classification-plugin.md) for domains we
  will never staff.
- **Enrich atoms** with metadata from 36 provider plugins — OpenGraph, JSON-LD,
  Wikipedia, Wikidata work with **no API keys**; [add keys](./docs/enrichment-providers.md)
  for Spotify, TMDB, Etherscan, and more. [Write your own](./docs/writing-an-enrichment-plugin.md).
- **Verify, don't trust** — point the indexer at the chain and reconstruct the
  graph yourself.

The minimal stack needs **zero paid accounts**, including chain indexing (the
Intuition testnet RPC is public and keyless).

## Quick start

> Prerequisites: [Docker](https://docs.docker.com/get-docker/) and
> [Bun](https://bun.sh) ≥ 1.3.

```bash
git clone https://github.com/0xIntuition/intuition-core && cd intuition-core
scripts/bootstrap.sh
```

The bootstrap script checks Docker, Bun, free disk space, creates `.env` from
`example.env` when needed, installs dependencies, starts Docker Compose, waits
for the API health check, then prints the first useful API commands.

Prefer Make?

```bash
make bootstrap
```

### Your first 5 minutes

Start the local stack:

```bash
scripts/bootstrap.sh
# or: make bootstrap
```

Expected shape:

```text
OK Docker and Docker Compose are available
OK Created .env from example.env
==> Installing workspace dependencies
==> Starting Docker Compose
OK API is healthy
Try the API:
  curl http://localhost:3000/health
  curl http://localhost:3000/api/stats
  curl http://localhost:3000/api/predicates
```

Check that the read API is live:

```bash
curl http://localhost:3000/health
curl http://localhost:3000/api/stats
curl http://localhost:3000/api/predicates
```

Expected response shapes:

```json
{ "status": "ok" }
```

```json
{ "data": { "atoms": 0, "triples": 0, "accounts": 0, "predicates": 14 } }
```

```json
{ "data": [{ "slug": "created-by", "label": "Created By", "...": "..." }] }
```

Mint a write key. Prefer the Make target because it supplies the host Postgres
connection string that the key script requires:

```bash
make keys ACCOUNT=0x0000000000000000000000000000000000000001 KEY_NAME=me
```

Expected shape:

```text
created key_... (me) -> account 0x0000000000000000000000000000000000000001, write=true, rpm=default

  ik_...

Store this key now - it is not recoverable.
```

Create an atom with the printed `ik_...` key:

```bash
API_KEY=ik_...

curl -X POST http://localhost:3000/api/atoms \
  -H "Authorization: Bearer $API_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"input":"https://github.com/oven-sh/bun"}'
```

Expected shape:

```json
{
  "data": {
    "id": "0x...",
    "created": true,
    "createdBy": "0x0000000000000000000000000000000000000001"
  }
}
```

Read it back:

```bash
ATOM_ID=0x...

curl "http://localhost:3000/api/atoms/$ATOM_ID"
curl "http://localhost:3000/api/atoms?limit=5"
```

Expected single-atom shape:

```json
{
  "data": {
    "id": "0x...",
    "rawType": "http_uri",
    "classificationType": "...",
    "parseStatus": "completed",
    "classificationStatus": "completed",
    "enrichmentStatus": "completed"
  }
}
```

Expected list shape:

```json
{
  "data": [{ "id": "0x...", "rawType": "http_uri", "...": "..." }],
  "pagination": { "limit": 5, "offset": 0, "count": 1 }
}
```

Workers may briefly show `pending` before those statuses become `completed`.

If the first run fails, check these five things first:

1. `curl http://localhost:3000/health` returns `{"status":"ok"}`.
2. Writes returning `401 api_key_required` need a key from `make keys`.
3. Port conflicts on `3000`, `4010`, or `4110` need the other process stopped
   or `API_PORT` / `ATOM_SERVICES_PORT` / `WORKERS_PORT` overrides.
4. Postgres `TimeZone` errors usually mean a corrupt Timescale Docker image;
   see [troubleshooting](./docs/troubleshooting.md#invalid-value-for-parameter-timezone-utc-from-postgres).
5. Empty indexed tables usually mean the indexing profile has not run yet, or
   the configured block window does not contain MultiVault events.

Verify the local stack end to end:

```bash
make smoke        # API key → atom → workers → triple → stats
make smoke-index  # 500-block public testnet indexing window → projections → API stats
```

Smoke commands run their own disposable Compose projects with random host ports,
so they can run while your normal `docker compose up` stack is still running.

Explore the local database after bootstrapping or indexing:

```bash
make explore      # table counts, recent atoms, pipeline status, predicates, artifacts
bun run explore
```

Raw commands still work:

```bash
cp example.env .env
bun install
docker compose up        # databases → migrations → seeds → workers → API
```

Prefer native services with a TUI? Install
[`process-compose`](https://f1bonacc1.github.io/process-compose/installation/)
and run the local profile:

```bash
bun run dev:local -- standard
```

This keeps datastores in Docker, then runs KG migrations, Timescale migrations,
the API, workers, and atom-services as local processes with logs under
`.logs/process-compose/`.

To add the Rust indexing tier, set the chain variables in `.env` (see
[run your own node](./docs/run-your-own-node.md#5-index-the-chain)), then run:

```bash
bun run dev:local -- indexing
```

Use `bun run dev:local:dry-run -- indexing` to validate the merged
Process Compose config without starting services. Dry-run does not check native
indexing prerequisites; starting `indexing` also needs Rust/Cargo, `envsubst`
(`brew install gettext` on macOS), and valid chain variables.

**Create your first atom** (mint a key once, then post anything — a URL,
string, or JSON):

```bash
make keys ACCOUNT=0x0000000000000000000000000000000000000001 KEY_NAME=me
# → ik_… (printed once — store it)

curl -X POST localhost:3000/api/atoms \
  -H "Authorization: Bearer ik_…" -H 'Content-Type: application/json' \
  -d '{"input":"https://github.com/oven-sh/bun"}'
```

```json
{ "data": { "id": "0x951d18ba…", "created": true, "createdBy": "0xYourWallet" } }
```

Seconds later the workers have parsed, classified, and enriched it:

```bash
curl localhost:3000/api/atoms/0x951d18ba…
# → "classificationType": "SoftwareSourceCode",
#   parse/classify/enrich: "completed", artifacts: opengraph · favicon · github-repo
```

**Or skip the database entirely** — stateless classify/enrich over HTTP:

```bash
curl -X POST localhost:4010/v1/classify -H 'Content-Type: application/json' \
  -d '{"input":"https://github.com/vercel/next.js"}'
# → { "domain": "github", "subtype": "repo", "confidence": 0.97 }
```

**Index the chain** — add the chain config to `.env`
([details](./docs/run-your-own-node.md#5-index-the-chain)), then:

```bash
docker compose --profile indexing up
```

A bounded test window (`MULTIVAULT_END_BLOCK`) indexes 2,000 blocks of real
events in under a second once synced — atoms land in your graph, classified and
queryable, with full market read models alongside.

Full walkthrough: **[docs/run-your-own-node.md](./docs/run-your-own-node.md)**.

Data reference: **[docs/data-model.md](./docs/data-model.md)**.
SQL cookbook: **[docs/example-queries.md](./docs/example-queries.md)**.

## How it works

```
                     ┌──────────────────────────────────────────────┐
   Intuition chain   │  indexer (Rust) — decode MultiVault events   │──► TimescaleDB
   (any MultiVault)  └──────────────────┬───────────────────────────┘    event store
                                        ▼
                     ┌──────────────────────────────────────────────┐
                     │  projections (Rust) — ~20 checkpointed       │──► market read models
                     │  workers; core_entities → atoms into the KG ─┼──► Postgres-KG
                     └──────────────────────────────────────────────┘         ▲
   POST /api/atoms ────────────────────────────────────────────────────────────┤
                     ┌──────────────────────────────────────────────┐          │
                     │  workers (Bun) — parse → classify → enrich   │──────────┘
                     └──────────────────────────────────────────────┘
                     ┌──────────────────────────────────────────────┐
                     │  api (Hono) — query the graph you built      │◄── Postgres-KG
                     └──────────────────────────────────────────────┘
```

| Component | Where | What it does |
| --- | --- | --- |
| **indexer** | `crates/rindexer-ingestion` | chain events → append-only event store (bounded ranges supported) |
| **projections** | `crates/projections` | events → vaults, positions, signals + atoms/triples into the KG |
| **workers** | `services/workers` | lease-based parse → classify → enrich over every new atom |
| **api** | `services/api` | REST reads + key-gated, attributed writes |
| **atom-services** | `services/atom-services` | stateless `POST /v1/classify` · `/v1/enrich` · `/v1/process` |
| **atom intelligence** | `packages/atom-*` | the parser, 17 classification plugins, enrichment adapters, rules engine |
| **data layer** | `packages/database-*`, `migrations/` | schemas + versioned, auto-applied migrations |

Deep dive: **[docs/architecture.md](./docs/architecture.md)**.

## The query API

Reads are open. Writes need an operator-minted API key and are **attributed to
the key's account** (`created_by`). Three modes via `API_AUTH`:
`public-read` (default) · `gated` · `open`.

| Endpoint | | 
| --- | --- |
| `POST /api/atoms` 🔑 | any URL/string/JSON → deterministic, idempotent atom |
| `POST /api/triples` 🔑 | claim between terms → deterministic, idempotent triple |
| `GET /api/atoms` · `/api/atoms/:id` | list (filter/search) and fetch atoms |
| `GET /api/atoms/:id/triples` | every triple touching an atom, any position (hexastore) |
| `GET /api/triples` · `/api/triples/:id` | filter by subject / predicate / object |
| `GET /api/predicates` · `/api/schema` · `/api/stats` · `/health` | registry, KG schema metadata, counts, liveness |

Requests, responses, and error shapes: **[docs/api-reference.md](./docs/api-reference.md)**.
OpenAPI 3.1 spec: **[docs/openapi.yaml](./docs/openapi.yaml)**.

## Configuration tiers

Capabilities are opt-in; the floor is free.

| Tier | Adds | Paid accounts |
| --- | --- | --- |
| **Minimal** (`docker compose up`) | databases + workers + api + atom-services | **none** |
| **+ Indexing** (`--profile indexing`) | indexer + projections | none — public RPC |
| **+ Rich enrichment** | provider plugins | optional keys (Spotify, Etherscan, …) |
| **+ Search** *(coming)* | embeddings | OpenAI or pluggable provider |

Every variable: **[docs/configuration.md](./docs/configuration.md)**.

## Repository layout

```
intuition-core/
├─ crates/          Rust — shared · rindexer-ingestion · projections · curves
├─ packages/        TypeScript libraries — atom-* intelligence · database schemas · types
├─ services/        deployable services — api · workers · atom-services
├─ migrations/      event-store SQL migrations (TimescaleDB)
├─ docker/          per-service Dockerfiles
├─ docs/            guides — start with run-your-own-node.md
└─ docker-compose.yml           ← the one button
```

## Development

```bash
bun install                    # Bun only — enforced by preinstall
bun run typecheck              # all workspaces
bun run test                   # bun:test suites (14 packages)
bunx @biomejs/biome check .    # lint + format
cargo check --workspace        # the Rust crates
node scripts/guard-supply-chain-policy.mjs
```

Read [CONTRIBUTING.md](./CONTRIBUTING.md) first — especially the parts about
**deterministic IDs being identity-sensitive** and the enforced auth boundary.
Something broken? [docs/troubleshooting.md](./docs/troubleshooting.md) covers
the failure modes we've actually hit.

## What stays out

Core is the open, auth-free backend. User authentication, billing, and the
social product layer live in Intuition's private monorepo — a lint rule fails
CI if they're ever imported here. Bring your own front end; the graph is yours.

## License

MIT © [Intuition Systems](https://intuition.systems)
