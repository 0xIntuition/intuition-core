# Configuration reference

Every variable, its consumer, default, and which tier needs it. `example.env`
carries the local-dev defaults; docker-compose wires container-network DSNs
automatically.

## Datastores

| Variable | Used by | Default (local) | Notes |
| --- | --- | --- | --- |
| `DATABASE_KG_URL` | api, workers, kg migrate, projections (optional) | `postgresql://intuition:intuition@localhost:5432/intuition_kg` | knowledge graph |
| `DATABASE_TIMESCALE_URL` | database-timescale tests | `postgresql://…@localhost:5433/intuition_timescale` | TS-package tests skip cleanly when unset |
| `DATABASE_URL` | indexer, projections, timescale migrate | container DSN → `timescale:5432` | the event store |
| `REDIS_URL` | indexer | `redis://localhost:6379` | leader election |
| `REDIS_LEADER_KEY` / `REDIS_LEADER_TTL_SEC` | indexer | `ingestion_leader_lock` / `15` | multi-instance coordination |

## Chain / indexer (`--profile indexing`)

| Variable | Required | Notes |
| --- | --- | --- |
| `INTUITION_RPC_URL` | yes | chain RPC; the Intuition testnet endpoint is public and keyless |
| `CHAIN_ID` | yes | **read at runtime by the generated typings too** — must be in the environment, not only in the manifest |
| `MULTIVAULT_CONTRACT_ADDRESS` | yes | the deployment to index |
| `MULTIVAULT_START_BLOCK` | yes | first block to index |
| `MULTIVAULT_END_BLOCK` | no | bound the range for cheap test runs; empty = sync to head |
| `RINDEXER_MANIFEST_PATH` | no | default `./rindexer.yaml` (container: `/rindexer/rindexer.yaml`) |
| `METRICS_PORT` / `RINDEXER_HEALTH_PORT` | no | `9091` / `8080` |

## Projections

| Variable | Default | Notes |
| --- | --- | --- |
| `SURREAL_DB_URL` | *(empty)* | **keep empty** — selects the no-op graph sink; Core is Postgres-only |
| `DATABASE_KG_URL` | unset | when set, `core_entities` writes atoms/triples into the KG |
| `ENABLED_PROJECTIONS` / `DISABLED_PROJECTIONS` | — / `funnel_tracker,user_activity_batch,vault_state:dual,vault_holders_index:dual` | CSV allow/deny lists |
| `PROJECTIONS_BATCH_SIZE` / `PROJECTIONS_POLL_INTERVAL_MS` | `500` / `1000` | throughput tuning |
| `PROJECTIONS_METRICS_PORT` | `9092` | health: `/health/live` |

## Query API (`services/api`)

| Variable | Default | Notes |
| --- | --- | --- |
| `API_PORT` | `3000` | |
| `API_AUTH` | `public-read` | `open` \| `public-read` \| `gated` — see run-your-own-node.md |
| `API_ALLOWED_ORIGINS` | *(empty = allow all)* | comma-separated CORS origins |

## Workers (`services/workers`)

| Variable | Default | Notes |
| --- | --- | --- |
| `WORKERS_PORT` | `4110` | health `/healthz`; use distinct ports per worker locally |
| `WORKERS_CONCURRENCY` | `4` | |
| `WORKERS_LEASE_MS` | `60000` | processing-stage lease; stuck leases are reaped automatically |
| `WORKERS_MAX_ATTEMPTS` | `5` | per stage |
| `WORKERS_PARSE_REMOTE_FETCH` | `true` | fetch remote URLs during parse |
| `WORKERS_PARSE_ALLOW_HTTP` | `false` | plain-http fetches off by default |
| `WORKERS_PARSE_IPFS_GATEWAY_BASE_URL` | unset | optional IPFS gateway |

## Atom services (`services/atom-services`)

| Variable | Default | Notes |
| --- | --- | --- |
| `ATOM_SERVICES_PORT` | `4010` | health `/health` |
| `ATOM_SERVICES_AUTH_TOKEN` | unset | optional bearer gate for the service |

## Optional provider keys (enrichment/classification)

All optional. Missing keys → the plugin degrades or skips; public sources
(Wikipedia, Wikidata, OpenGraph, favicons, GitHub public data) work keyless.

`SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET`, `GITHUB_TOKEN`,
`ETHERSCAN_API_KEY`, `BRANDFETCH_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`,
`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` (reserved for the Search tier).
