<div align="center">
  <h1>Intuition Core</h1>
  <p><strong>The open backend, in a box.</strong></p>
  <p>A self-hosted indexer, atom intelligence pipeline, two Postgres databases, and one query API —<br/>run your own shard of the world's knowledge graph.</p>
</div>

---

Intuition Core is the whole backend that runs the Intuition knowledge graph, open-source and
self-hostable. Index anything into **atoms** and **triples** with deterministic IDs, classify and
enrich it, keep it local and private, and publish onchain only when a record earns a market.

The data was always permissionless. Core makes the **machinery** permissionless too: point the
indexer at the chain and reconstruct the graph yourself — verify, don't trust.

## What's in the box

```
  chain ──► indexer ──► projections ──► [ Postgres-KG · TimescaleDB · Redis ]
                                              │
                              workers (parse → classify → enrich)
                                              │
                                         query API  ◄── you read the graph you built
```

| Layer | What it is | Language | Where |
| --- | --- | --- | --- |
| **indexer** | decode MultiVault chain events → event store | Rust | `crates/rindexer-ingestion` |
| **projections** | event workers → typed read models + graph | Rust | `crates/projections` |
| **workers** | parse → classify → enrich pipeline | TypeScript | `services/workers` |
| **api** | auth-free, read-only REST over the graph | TypeScript | `services/api` |
| **atom intelligence** | parser · 17 classification plugins · enrichment · rules | TypeScript | `packages/atom-*` |
| **data layer** | KG + TimescaleDB schemas, versioned migrations | TypeScript/SQL | `packages/database-*`, `migrations/` |

## Quick start

```bash
# Prerequisites: Docker + Bun (>= 1.3). Rust only if you build the crates natively.
cp example.env .env
bun install

# One button: datastores → schema migrations → workers → query API.
docker compose up            # postgres-kg, timescale, redis, migrations, workers, api

curl localhost:3000/health
curl "localhost:3000/api/atoms?limit=5"
```

### Index the chain

Set the chain config in `.env` (a public RPC endpoint works — no API key needed
for the Intuition testnet), then start the indexing tier:

```bash
# .env
#   INTUITION_RPC_URL=https://testnet.rpc.intuition.systems/http
#   CHAIN_ID=13579
#   MULTIVAULT_CONTRACT_ADDRESS=0x...
#   MULTIVAULT_START_BLOCK=...
#   MULTIVAULT_END_BLOCK=        # optional: bound the range for a cheap test run

docker compose --profile indexing up
```

Chain events flow into the TimescaleDB event store, projections fan them out into
typed read models and the graph, and the API serves what you indexed.

## Query API

Reads are open; writes are gated by operator-minted API keys and attributed to
the key's account (`API_AUTH=open|public-read|gated`). Only `active` + `public`
records are served.

| Endpoint | What it does |
| --- | --- |
| `GET /health` | liveness + database reachability |
| `POST /api/atoms` 🔑 | create an atom from any URL/string/JSON — deterministic ID, idempotent, `created_by` attributed |
| `GET /api/atoms` | atoms; filters: `classification_type`, `q`, `limit`, `offset` |
| `GET /api/atoms/:id` | one atom |
| `GET /api/atoms/:id/triples` | every triple touching an atom, any position |
| `POST /api/triples` 🔑 | create a claim between terms — deterministic ID, idempotent, attributed |
| `GET /api/triples` | triples; filters: `subject_id`, `predicate_id`, `object_id` |
| `GET /api/triples/:id` | one triple |
| `GET /api/predicates` | the predicate registry (14 baseline predicates seeded) |
| `GET /api/stats` | atom / triple / account / predicate counts |

Mint keys with `bun run keys:create -- --name partner --account 0x…` (hashes
only are stored). Stateless classify/enrich lives on `atom-services` (`:4010`):
`POST /v1/classify`, `/v1/enrich`, `/v1/process`.

**Docs:** [run-your-own-node](./docs/run-your-own-node.md) ·
[architecture](./docs/architecture.md) · [configuration](./docs/configuration.md) ·
[troubleshooting](./docs/troubleshooting.md)

## Migrations

Two migration systems, both applied automatically by `docker compose up`:

- **KG (Postgres):** Drizzle-generated SQL in `packages/database-kg/drizzle/` plus custom
  TimescaleDB post-migrations (hypertable + continuous aggregates). `bun run db:generate` /
  `bun run db:migrate` from the package.
- **Event store (TimescaleDB):** sequential SQL in `migrations/timescale/`, tracked in a
  `schema_migrations` table so each file applies exactly once.

## Tiered configuration

The minimal tier needs **zero paid accounts**. Capabilities are opt-in.

| Tier | Adds | Paid accounts |
| --- | --- | --- |
| **Minimal** | datastores + workers + api | **none** |
| **+ Indexing** | `--profile indexing`: indexer + projections | none (public RPC works) |
| **+ Rich enrichment** | provider plugins | optional per-provider keys (Spotify, GitHub, Etherscan, …) |
| **+ Search** | embeddings *(coming)* | OpenAI *or* a pluggable provider |
| **+ Feed** | recommendation service *(coming)* | none (TimescaleDB only) |

## Repository layout

```
intuition-core/
├─ crates/          # Rust: shared, rindexer-ingestion, projections, curves
├─ packages/        # TypeScript libraries: atom-* intelligence, database schemas, types
├─ services/        # deployable TypeScript services: api, workers, atom-services
├─ migrations/      # event-store SQL migrations (TimescaleDB)
├─ docker/          # per-service Dockerfiles
├─ tooling/         # shared build config
├─ docker-compose.yml              # the one button
└─ docker-compose.datastores.yml   # datastores only
```

## Development

```bash
bun install               # Bun only — enforced by preinstall
bun run typecheck         # all workspaces
bun run test              # bun:test suites
bunx @biomejs/biome check .
cargo check --workspace   # the Rust crates
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the ground rules — notably that
deterministic IDs, classification output, and schema are identity-sensitive
surfaces with required review.

## Boundaries

Core is the **open, auth-free backend**. Authentication, billing, and the social product layer stay
in Intuition's private monorepo — a Biome lint rule enforces that they are never imported here. The
API exposes the graph read surface; bring your own front end.

## License

MIT © Intuition Systems
