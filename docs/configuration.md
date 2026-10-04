# Configuration reference

Every variable, its consumer, default, and which tier needs it. `example.env`
carries the local-dev defaults; docker-compose wires container-network DSNs
automatically.

## Datastores

| Variable | Used by | Default (local) | Notes |
| --- | --- | --- | --- |
| `DATABASE_KG_URL` | api, workers, kg migrate, projections (optional) | `postgresql://intuition:intuition@localhost:5432/intuition_kg` | knowledge graph; projections use it for canonical nodes and atom-context evidence |
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
| `DATABASE_KG_URL` | unset | when set, `core_entities` writes atoms/triples and `atom_context:dual` writes immutable URI/evidence rows into the KG |
| `USE_TYPED_READER` | `true` in Core Compose | use the per-event typed tables, including the byte-preserving `AtomContextRegistered` table; the standalone binary retains its legacy default of `false` |
| `ENABLED_PROJECTIONS` / `DISABLED_PROJECTIONS` | — / `funnel_tracker,user_activity_batch,vault_state:dual,vault_holders_index:dual` | CSV allow/deny lists; `atom_context:dual` is intentionally enabled by default after migration because it records chain truth |
| `PROJECTIONS_BATCH_SIZE` / `PROJECTIONS_POLL_INTERVAL_MS` | `500` / `1000` | throughput tuning |
| `PROJECTIONS_METRICS_PORT` | `9092` | health: `/health/live` |

## Query API (`services/api`)

| Variable | Default | Notes |
| --- | --- | --- |
| `API_PORT` | `3000` | |
| `API_AUTH` | `public-read` | `open` \| `public-read` \| `gated` — see run-your-own-node.md |
| `API_ALLOWED_ORIGINS` | *(empty = allow all)* | comma-separated CORS origins |
| `API_ATOM_SEMANTIC_READS_ENABLED` | `false` | expose additive `raw`, `identity`, `classification`, `context`, `resolution`, and `display` atom fields; existing fields remain present |

## Explorer (`apps/explorer`)

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:3000` | query API base URL |
| `VITE_ATOM_SEMANTIC_READS_ENABLED` | `false` | independently consume semantic atom fields and show identity/context UI; this is a Vite build/start setting |

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
| `WORKERS_PROCESSING_SCOPE` | `full` | `full`, `music`, `podcasts`, or `music-and-podcasts`; scoped modes gate enrichment only |
| `WORKERS_IID_READ_ENABLED` | `false` | enable IID parse/classification reads after package and persistence compatibility is verified |
| `WORKERS_IID_RESOLUTION_ENABLED` | `false` | independently enable IID provider resolution; keep off until IID reads are enabled and stable |

The IID adapters consume injected `@0xintuition/iid`, `@0xintuition/iid-registry`,
and `@0xintuition/iid-ladder` modules with exact installed manifest versions.
The third module owns primary-rung and alias-only policy. Classification fails
closed when `WORKERS_IID_READ_ENABLED` is enabled without an `iidLadder` adapter.
Rung projections persist in `classificationResult`; a policy-admitted primary
fills `nodes.iid` only when it is null. With the flag off, the legacy path is unchanged.
The ladder adapter also receives the injected IID inspector to enforce alias-only,
URL exclusion, and plain-Wikidata admission across canonical input paths. Legacy
identity metadata does not establish admission. Malformed persisted rung projections
are ignored while the remaining classification record is retained.

Typed Wikidata IIDs are handled entirely by the injected `iid` module, including validity, typing, and anchor eligibility. Core's Rust path stores them opaquely as strings with `Unknown` classification; the TS parse worker persists the module's identity even when it is not anchor-eligible.

### Worker maintenance commands

Run maintenance commands from `services/workers` with the configured KG connection:

```sh
bun run command kg-reconcile-iid --limit=100 --after=0xNODE
bun run command kg-backfill-identifiers --limit=100 --after=0xNODE
bun run command kg-backfill-identifiers --yes --limit=100 --after=0xNODE
```

Both verbs default to a dry run. `kg-reconcile-iid --yes` requeues parse with
classification/enrichment cascaded; its optional `--parse-version`,
`--registry-version`, and `--resolver-version` values record package provenance.
`--force` explicitly overrides processing eligibility for reconciliation.

`kg-backfill-identifiers` materializes only supplied IIDs from stored
`classificationResult.identityRungs`; it does not derive identities. Each invocation
handles one ascending `nodes.id` page. `--limit` is an integer from 1 to 1000
(default 100); `--after` is the exclusive cursor. Both `--limit=100` and
`--limit 100` forms (likewise `--after`) are accepted. Repeat with the printed
`nextAfter` until `count` is zero. `aliases` counts rows after primary-ownership filtering, including
existing rows whose inserts are ignored on conflict; it is not a new-insert count.

Both dry-run and apply use one transaction per page, with `SET LOCAL lock_timeout = '5s'` and
`statement_timeout = '30s'`. Dry-run takes no row locks and inserts nothing.
In apply mode, candidate rows take `FOR NO KEY UPDATE` locks so
classification cannot change the projection or primary while aliases are inserted.
The verb only adds aliases; classification completion reconciles removed rungs.
Primary IID and same-primary-scheme rungs are excluded; alias-only rungs are retained,
duplicates are removed, and at most 32 alias rows are projected per node.
One bounded ownership query over the page's candidate IIDs excludes primaries held by
other nodes, including draft/private nodes (R38, proposed default). A concurrent
node creation or primary promotion after that query can still claim the same IID;
Core has no create-reservation path to prevent this accepted race.
Malformed or absent projections are skipped. Classification completion preserves
existing aliases for those inputs; a well-formed empty projection clears rung aliases.
Drizzle 0005 must be applied through Core's regular migration runner first.

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
