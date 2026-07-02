# Architecture

Intuition Core is the backend that turns chain events and raw inputs into a
queryable knowledge graph. Two databases, one pipeline, deterministic identity
throughout.

```
                    ┌─────────────────────────────────────────────────┐
   Intuition chain  │  indexer (crates/rindexer-ingestion, Rust)      │
   (any MultiVault) │  decode events → event_store + typed tables     │──► TimescaleDB
                    └──────────────────────┬──────────────────────────┘    (event store,
                                           ▼                                market models)
                    ┌─────────────────────────────────────────────────┐
                    │  projections (crates/projections, Rust)         │
                    │  ~20 checkpointed workers → vaults, terms,      │
                    │  positions, signals, leaderboards               │
                    │  core_entities → atoms/triples into the KG ─────┼──► Postgres-KG
                    └─────────────────────────────────────────────────┘    (kg schema)
                                                                              ▲
   POST /api/atoms ───────────────────────────────────────────────────────────┤
   (API-key gated, attributed)                                                │
                    ┌─────────────────────────────────────────────────┐       │
                    │  workers (services/workers, Bun)                │◄──────┤
                    │  parse → classify → enrich, lease-based claims  │───────┘
                    └─────────────────────────────────────────────────┘
                    ┌─────────────────────────────────────────────────┐
                    │  api (services/api, Hono)                       │◄── Postgres-KG
                    │  read: atoms/triples/predicates/stats           │
                    │  write: atoms/triples (key-gated, attributed)   │
                    └─────────────────────────────────────────────────┘
                    ┌─────────────────────────────────────────────────┐
                    │  atom-services (Hono) — stateless               │
                    │  /v1/classify · /v1/enrich · /v1/process        │
                    └─────────────────────────────────────────────────┘
```

## Deterministic identity (the invariant that matters)

- **Atom ID** = `keccak(ATOM_SALT, keccak(bytes))` — a pure function of the
  atom's data. The ID you derive locally is the exact ID MultiVault registers
  onchain: publishing is a state change, not a migration.
- **Triple ID** = `keccak(TRIPLE_SALT, subject, predicate, object)`.
- Both derivations are parity-locked by known-answer tests
  (`packages/database-kg/src/actions/ids.test.ts`). Changing them forks the
  graph — they are review-gated surfaces.

## The two databases

**Postgres-KG** (`kg` schema, Drizzle-managed): `nodes` (atoms) with the
parse/classify/enrich state machine, `triples` with a **hexastore** (all six
S/P/O permutation indexes → any-direction traversal), `accounts`, `predicates`
(seeded with 14 baseline predicates), `artifacts` (enrichment output),
`node_urls`, `adjacency`, `events` (TimescaleDB hypertable), `api_keys`, plus
stats tables. Runs on `timescaledb-ha` because the KG itself uses hypertables
and (later, Search tier) pgvector.

**TimescaleDB event store** (SQL migrations in `migrations/timescale/`):
append-only `event_store` hypertable + typed per-event tables written by the
indexer; read models (vaults, terms, positions, signals, leaderboards) built by
projections; continuous aggregates for time-series rollups.

There is deliberately **no graph database**: graph reads are served from
Postgres (hexastore + adjacency). Projections' SurrealDB sink is compiled in but
runs as a no-op (`SURREAL_DB_URL` empty), matching Intuition's own production.

## Reliability model

- **Indexer**: Redis leader election (safe multi-instance), per-event-type
  progress metrics, `reorg_safe_distance`, optional bounded ranges
  (`MULTIVAULT_END_BLOCK`) for test runs.
- **Projections**: per-worker checkpoints (`projection_checkpoints`) — restart
  resumes exactly where it stopped; circuit breakers + retry with backoff.
- **Workers**: lease-based stage claims on `kg.nodes` (a crashed worker's lease
  expires and the node is reaped and re-claimed), attempt caps, circuit
  breakers per dependency, heartbeat watchdog.
- **Migrations**: two idempotent one-shot jobs run before services start —
  Drizzle journal + TimescaleDB post-SQL for the KG; filename-tracked
  sequential SQL for the event store.

## Auth model

Infrastructure keys, not user auth: `kg.api_keys` stores SHA-256 hashes of
operator-minted keys, each bound to a KG account. Writes through the API carry
`created_by` attribution automatically. Modes: `open` / `public-read` / `gated`
(see [configuration.md](./configuration.md)). User authentication, billing, and
the social product layer intentionally live outside this repository — a lint
rule fails CI if they're imported.
