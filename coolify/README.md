# Deploy Intuition Core with Coolify

A standalone Docker Compose entry point for [Coolify](https://coolify.io/),
without changing the regular local-development Compose files.

## Why a separate Compose file?

The upstream `docker-compose.yml` uses `include:` to load
`docker-compose.datastores.yml`. Docker Compose supports `include:`, but on
Coolify **4.0.0-beta.463** the generated deployable Compose was observed to
contain `api`, `migrate`, workers and their `depends_on` references **without**
`postgres-kg`, `timescale`, or `redis`. Only Anvil's optional volume was shown.
In that state the stack cannot start successfully. This file declares the
services and named volumes directly so that Coolify can parse the entire stack.

This is an **operator workaround**, not a claim that all Coolify versions have
this limitation, and not a replacement for improving `include:` support there.

This file uses the published, verified `v0.1.0-rc.2` Core images by default:
see the [upstream operator guide](../docs/releases/v0.1.0-rc.2.md). It does **not**
build the source of the Git checkout. It is suitable for testing that release;
read its release-candidate limitations before using it in production.

## 1. Add the Git repository as a Coolify Application

1. In Coolify, create an **Application** from the Git repository (public URL,
   deploy key, or GitHub App).
2. Set **Build strategy** to **Docker Compose** (not Docker Compose Empty).
3. Select the branch you want to deploy. Set **Base Directory** to `/` and
   **Docker Compose Location** to `/coolify/docker-compose.yml`.
4. Save/reload the Compose configuration. Check that **all 12** services appear
   in the generated/deployable Compose, including `postgres-kg`, `timescale`,
   and `redis`, and that the three named volumes are declared. **Do not deploy
   if any datastore is missing or if a `depends_on` target is unresolved.**
5. Keep **Raw Compose deployment** disabled, so Coolify can provide the
   resource network and optional HTTP proxy routing.

## 2. Configure secrets and domains

Set these two **required** Coolify Environment Variables before the first
start (generate each value separately and store it in Coolify, not Git):

```sh
openssl rand -hex 32 # CORE_KG_DB_PASSWORD
openssl rand -hex 32 # CORE_TS_DB_PASSWORD (run again)
```

Only hexadecimal passwords should be used with this file: they are embedded
in PostgreSQL connection URIs, where unescaped reserved characters can make
credentials invalid. Keep the values unchanged after the databases have been
initialized; updating `POSTGRES_PASSWORD` alone **does not rotate** an existing
PostgreSQL user's password.

Optional variables: `API_AUTH` (default `public-read`),
`API_ALLOWED_ORIGINS`, `API_RATE_LIMIT_RPM`, `WORKERS_PROCESSING_SCOPE`,
provider API keys and the six `INTUITION_CORE_*_IMAGE` references. See
[configuration](../docs/configuration.md) for Core's other defaults.

For browser access, assign a Coolify **Domain** to the **`api`** service and
select container port **3000**, e.g. `https://core.example.org:3000` in the
Coolify domain field. The external HTTPS URL has no `:3000` port; this suffix
selects the internal container port for proxy forwarding. No datastore,
worker or metrics service needs a public host port. Do not expose the internal
`atom-services` service unless you secure it separately.

With `API_AUTH=public-read`, graph reads are public and writes require API
keys. Use `API_AUTH=gated` if the API must be private. Review the network
security and remote-fetch controls before accepting untrusted inputs:
`WORKERS_PARSE_ALLOW_PRIVATE_NETWORKS` and `WORKERS_PARSE_ALLOW_HTTP` are
fixed to `false` here, but outbound firewall restrictions are also recommended.

## 3. First start and verification

Deploy the application **without** the `indexing` profile first. The default
services are `postgres-kg`, `migrate`, `api`, `atom-services` and the three
workers. The `migrate` service should finish with **exit code 0**; that is a
successful one-shot migration, not a continuously running service.

Check the API endpoint after Coolify reports healthy services:

```sh
curl --fail --show-error https://core.example.org/health
curl --fail --show-error https://core.example.org/api/stats
curl --fail --show-error https://core.example.org/api/predicates
```

The health endpoint should return `{"status":"ok"}`. To write data, create
an API key using Core's [operator instructions](../docs/run-your-own-node.md#auth--api-keys).
Do **not** set `API_AUTH=open` on an Internet-accessible deployment.

## 4. Optional blockchain indexing

The `indexing` profile includes `timescale`, `redis`, `timescale-migrate`,
`indexer` and `projections`. Only enable it after the API and its migration
have been verified and you have provided these required variables:

```dotenv
INTUITION_RPC_URL=<trusted RPC endpoint>
CHAIN_ID=<chain ID>
MULTIVAULT_CONTRACT_ADDRESS=<verified contract address>
MULTIVAULT_START_BLOCK=<deployment start block>
# Optional: bound the test to a small range
MULTIVAULT_END_BLOCK=
```

Set **`COMPOSE_PROFILES=indexing`** in the Coolify application environment and
inspect its deployable Compose before deployment. Check that the five indexing
services are enabled. The profile and the chain settings must be passed to the
actual Docker Compose command and containers; if your Coolify version doesn't
honor `COMPOSE_PROFILES`, use an explicitly profiled operator deployment rather
than silently assuming indexation is active.

The [run-your-own-node guide](../docs/run-your-own-node.md#5-index-the-chain)
contains a tested **Intuition testnet** contract and bounded block range.
Verify network parameters against the applicable contract deployment before
indexing mainnet or a different chain. An indexer with a nonempty end block
is expected to stop after completing the range; `restart: on-failure` avoids
restarting it after a successful bounded run.

## Storage, updates and backups

Three named volumes persist data independently of the containers:

| Volume | Container mount | Purpose |
| --- | --- | --- |
| `postgres_kg_data` | `/home/postgres/pgdata/data` | Knowledge graph |
| `timescale_data` | `/home/postgres/pgdata/data` | Blockchain event store |
| `redis_data` | `/data` | Redis persistence |

Coolify may prefix their actual Docker names with a resource identifier. A
normal rebuild/redeploy retains named volumes when their identity is preserved.
**Do not** run `docker compose down -v`, rename the volumes, remove the resource
and assume data will be retained, or change the PostgreSQL major version in
place. Volumes are **not backups**: arrange regular PostgreSQL dumps and/or
consistent snapshots and test recovery separately.

The Core image references are pinned by digest to the six RC.2 verified images
from the upstream release guide. They can each be overridden through their
`INTUITION_CORE_*_IMAGE` variable, including to use a custom fork's published
images. Upgrade all six images together only after checking release notes,
migration compatibility and backups. **Pushing code to a fork does not change
what this published-image Compose executes.** Developing a modified Core means
building/publishing the corresponding service images and updating these
references, or using a separately tested source-build configuration.

This file deliberately does **not** include the optional local Anvil/devnet
stack or the Explorer web UI. The devnet deployer is source-built and uses a
bind mount, while the Explorer is a separate application. Use upstream
instructions to run those components if needed.

## Validate locally before opening a pull request

With Docker Compose v2 installed (no Docker daemon required for configuration
validation), run from the repository root:

```sh
CORE_KG_DB_PASSWORD=0123456789abcdef CORE_TS_DB_PASSWORD=fedcba9876543210 \
  docker compose -f coolify/docker-compose.yml config --quiet

CORE_KG_DB_PASSWORD=0123456789abcdef CORE_TS_DB_PASSWORD=fedcba9876543210 \
  docker compose -f coolify/docker-compose.yml --profile indexing config --quiet
```

Also check **Coolify's deployable Compose** after saving the file. YAML parsing
or `docker compose config` alone cannot establish that Coolify will produce the
correct services and volumes. A live deployment with migrations, health checks
and a subsequent redeploy is needed to demonstrate end-to-end success.

## References

- [Intuition Core's normal Compose](../docker-compose.yml)
- [Datastore configuration](../docker-compose.datastores.yml)
- [Verified RC.2 image digests](../docs/releases/v0.1.0-rc.2.md)
- [Coolify Docker Compose documentation](https://coolify.io/docs/applications/builds/docker-compose)
- [Docker Compose include specification](https://docs.docker.com/reference/compose-file/include/)
