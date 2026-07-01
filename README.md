<div align="center">
  <h1>Intuition Core</h1>
  <p><strong>The open backend, in a box.</strong></p>
  <p>A self-hosted indexer, atom intelligence pipeline, four datastores, and one query API —<br/>run your own shard of the world's knowledge graph.</p>
</div>

---

Intuition Core is the whole backend that runs the Intuition knowledge graph, open-source and
self-hostable. Index anything into **atoms** and **triples** with deterministic IDs, classify and
enrich it, keep it local and private, and publish onchain only when a record earns a market.

The data was always permissionless. Core makes the **machinery** permissionless too: point the
indexer at the chain and reconstruct the graph yourself — verify, don't trust.

> **Status:** early extraction from Intuition's production monorepo. Being assembled package by
> package. See [`.planning/intuition-core-open-source-spec.md`](./.planning/intuition-core-open-source-spec.md)
> for the full plan.

## What's in the box

```
  chain ──► indexer ──► projections ──► [ Postgres-KG · TimescaleDB · SurrealDB · Redis ]
                                              │
                              workers (parse → classify → enrich)
                                              │
                                         query API  ◄── you read the graph you built
```

| Layer | What it is | Language |
| --- | --- | --- |
| **indexer** | decode MultiVault chain events | Rust |
| **projections** | event workers → typed tables + graph | Rust |
| **workers** | parse → classify → enrich | TypeScript |
| **api** | query the graph you built (no auth required) | TypeScript |

The parse / classify / enrich intelligence ships as pure-TypeScript libraries on npm
(`@0xintuition/atom-parser`, `/atom-classification`, `/atom-enrichment`, `/atom-rules-engine`), so the
same code that runs in your node runs in your app.

## Quick start

> Datastores + schema migrations work today. Backend services (indexer, workers,
> api) are being layered in — track progress in `.planning/`.

```bash
# 1. Prerequisites: Docker, Bun (>= 1.3), and (later) Rust for the indexer.
cp example.env .env
bun install

# 2. One button: datastores come up, then schema migrations auto-apply.
docker compose up            # postgres-kg, timescale, surrealdb, redis + migrate

# — or, datastores only (apply migrations yourself) —
bun run datastores:up                                   # the four datastores
bun --filter @0xintuition/database-kg run db:migrate    # drizzle DDL + TimescaleDB hypertables
```

### Migrations

The KG schema is managed with Drizzle (versioned, checked-in SQL) plus a custom
post phase for the TimescaleDB features Drizzle can't express:

```bash
# from packages/database-kg
bun run db:generate    # regenerate drizzle/ SQL from the schema (commit it)
bun run db:migrate     # apply: drizzle journal, then migrations/post/*.sql
```

The runner detects TimescaleDB and skips the hypertable step on plain Postgres,
so the schema applies either way.

## Tiered configuration

The minimal tier needs **zero paid accounts**. Capabilities are opt-in.

| Tier | Adds | Paid accounts |
| --- | --- | --- |
| **Minimal** | datastores + indexer + projections + workers + api | **none** |
| **+ Search** | embeddings | OpenAI *or* a pluggable provider |
| **+ Feed** | recommendation service | none (TimescaleDB only) |
| **+ Trust** | claim signing (atom-warden) | signer keys; OAuth for verification |
| **+ Rich enrichment** | provider plugins | optional per-provider keys |

## Repository layout

```
intuition-core/
├─ packages/        # data layer — database schemas (Drizzle)
├─ services/        # deployable TypeScript services (api, workers, …)
├─ crates/          # Rust services (indexer, projections, …)   [coming]
├─ tooling/         # shared build config
├─ docker-compose.datastores.yml   # the four datastores
└─ docs/            # run-your-own-node, architecture, plugin guides   [coming]
```

## Boundaries

Core is the **open, auth-free backend**. Authentication, billing, and the social product layer stay
in Intuition's private monorepo — a Biome lint rule enforces that they are never imported here. The
API exposes the graph read surface; bring your own front end.

## License

MIT © Intuition Systems
