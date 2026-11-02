# Railway testnet QA

Core's shared QA deployment lives in the **Intuition Systems** Railway workspace.
It indexes public testnet activity and exposes Explorer plus the query API.

- [Project dashboard](https://railway.com/project/d49ad569-f6b0-4a04-9ee9-8821a1c70737?environmentId=7ba53362-a951-4ffd-9ebd-0f5785fabb25)
- Environment: `testnet-qa`
- [Explorer](https://explorer-testnet-qa.up.railway.app)
- [API health](https://api-testnet-qa.up.railway.app/health)
- Repository: `0xIntuition/intuition-core`
- Deployment branch: `feat/intuition-core-v2-replace-packages`

## Network

| Setting | Value |
| --- | --- |
| Network | Intuition testnet |
| Chain ID | `13579` |
| RPC | `https://testnet.rpc.intuition.systems/http` |
| MultiVault | `0xF76d6976DeBFbB012ebc53e925BC4AEFCaA7C6c6` |
| First contract block | `9345311` |
| End block | Unset; continue following the chain |

The address is the testnet deployment exported by the pinned
`@0xintuition/deployments@0.1.0-alpha.1` package. The
[documentation page](https://www.docs.intuition.systems/docs/quick-start/deployments)
still lists the older `0x2Ece8D4dEdcB9918A398528f3fa4688b1d2CAB91` deployment,
which reverts on `getAtomUriConfig`. The selected deployment supports that call
and reports a maximum of five URIs, each up to 700 bytes. Its chain ID, bytecode,
and creation block were verified through RPC on 2026-11-02. This environment
does not hold a signing key or deploy contracts.

## Services

All services run in Railway's US East region with one replica and sleeping disabled.
The shared Bun workspace requires the repository root as the build context.
Each application service selects its own Dockerfile; do not set a subdirectory
as its Railway root directory.

| Service | Dockerfile / image | Port | Readiness | Public |
| --- | --- | --- | --- | --- |
| `explorer` | `docker/Dockerfile.explorer` | 3000 | `/` | Yes |
| `api` | `docker/Dockerfile.api` | 3000 | `/health` | Yes |
| `atom-services` | `docker/Dockerfile.atom-services` | 4010 | `/ready` | No |
| `workers-parse` | `docker/Dockerfile.workers` | 4110 | `/readyz` | No |
| `workers-classification` | `docker/Dockerfile.workers` | 4112 | `/readyz` | No |
| `workers-enrichment` | `docker/Dockerfile.workers` | 4111 | `/readyz` | No |
| `indexer` | `docker/Dockerfile.ingestion` | 9091 | `/health` | No |
| `projections` | `docker/Dockerfile.projections` | 9092 | `/health/ready` | No |
| `postgres-kg` | `timescale/timescaledb-ha:pg17` | 5432 | PostgreSQL | No |
| `timescale` | `timescale/timescaledb-ha:pg17` | 5432 | PostgreSQL | No |
| `redis` | `redis:7-alpine` | 6379 | Redis | No |

The worker start commands are `bun src/index.ts kg-parse-worker`,
`bun src/index.ts kg-classification-worker`, and
`bun src/index.ts kg-enrichment-worker`. Railway overrides Docker ENTRYPOINT,
so a bare worker mode is not a sufficient start command.

Both PostgreSQL services need TimescaleDB; the knowledge graph also needs
pgvector. Their separate persistent volumes mount at `/home/postgres/pgdata`,
with `PGDATA=/home/postgres/pgdata/data`. Redis uses an AOF on `/data`.
Database passwords are independently generated and stored only in Railway.
No database has a public TCP proxy.

Redis is provisioned to match the Compose datastore stack. The current Rust
ingestion implementation does not acquire a Redis leader lock; keep the indexer
at one replica. Its custom handlers deduplicate replayed chain events in
PostgreSQL. Ingestion checkpoints persist in TimescaleDB
(`rindexer_internal`); `disable_create_tables: true` prevents rindexer from
creating duplicate event tables. Projection checkpoints also persist in TimescaleDB.

## Wiring and startup

The data path is RPC → indexer → Timescale event tables → projections →
knowledge graph → parse/classification/enrichment workers → API → Explorer.

- `DATABASE_KG_URL` references `${{postgres-kg.DATABASE_URL}}` in the API,
  projections, and all workers.
- The indexer and projections use `${{timescale.DATABASE_URL}}` as `DATABASE_URL`.
- The API runs `bun /repo/packages/database-kg/src/migrate.ts` as a pre-deploy
  command, with a 300-second timeout.
- The indexer runs `sh /run-migrations.sh` before deployment, with a 900-second
  timeout. The image includes PostgreSQL's client and the versioned SQL files.
- On a fresh environment, finish both migrations before starting projections
  and workers. Railway does not implement Compose's `depends_on` ordering.
- `USE_TYPED_READER=true`; the disabled projections match Compose's lean default:
  `funnel_tracker,user_activity_batch,vault_state:dual,vault_holders_index:dual`.
- Application healthchecks have a 300-second startup window. Failed processes
  use Railway's `ON_FAILURE` restart policy with ten retries.

Explorer's `VITE_API_URL` is the **public HTTPS API URL**, embedded at build time.
Changing it requires rebuilding Explorer. Its `EXPLORER_STATUS_TARGETS` uses
private Railway service domains for the seven backend readiness probes.
`GET /api/status` on Explorer reports those probes without exposing health ports.

The API uses `API_AUTH=public-read`: reads are public; mutations require a key.
Its CORS allowlist contains only Explorer, and its default rate limit is 240/min.
`API_TRUST_PROXY` is left unset; anonymous requests share the socket-based limit
when proxied. Enable proxy trust only after verifying trusted header handling.

QA enables `API_ATOM_SEMANTIC_READS_ENABLED`,
`VITE_ATOM_SEMANTIC_READS_ENABLED`, `WORKERS_IID_READ_ENABLED`, and
`WORKERS_IID_RESOLUTION_ENABLED`. Processing scope is `full`.
Paid enrichment provider credentials and embedding credentials are not populated.
Keyless providers run; credential-dependent providers remain unavailable until
QA-specific credentials are added to `workers-enrichment` and `atom-services`.
Do not copy unrelated production secrets into this project.

## Deployments and verification

Each application source is set to the feature branch. Automatic deploy-on-push
requires the Railway GitHub integration to have access to the repository. Until
that authorization is connected, use `railway redeploy --from-source --yes` with
an explicit service and environment to deploy new commits. Service watch patterns
limit rebuilds to its code, Dockerfile, and shared dependencies; documentation
changes do not rebuild the stack. Check the deployment's commit and status in
Railway, since different services can correctly run different commits when
unrelated changes are skipped.

Useful non-browser checks:

```sh
railway service list --project d49ad569-f6b0-4a04-9ee9-8821a1c70737 --environment testnet-qa --json
curl --fail https://api-testnet-qa.up.railway.app/health
curl --fail https://explorer-testnet-qa.up.railway.app/api/status
```

Service readiness alone does not prove ingestion has caught up. Inspect indexer
progress logs and projection checkpoints, then check API atom and pipeline
responses. Provider errors for unsupported inputs or missing credentials are
separate from worker process health. UI review is manual.

## Switch to main after merge

After the deployment changes have merged into `main`, change the source branch
of **all eight application services** to `main` in this project's `testnet-qa`
environment and deploy them. Keep the same testnet variables, database volumes,
Dockerfile paths, and migration commands. Do not recreate the project or switch
it to mainnet. Verify each deployment reports a commit from `main`, then repeat
the health and indexing checks above.

The datastore services follow Docker images, so they have no Git branch to switch.
