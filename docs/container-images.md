# Container Images

Core services are distributed as source today and are being prepared for public
container publishing. Week 1 hardens Docker contexts and metadata; Week 2 adds
the registry workflow and artifact verification.

## Registry Choice

Use GHCR first:

- The package namespace follows the GitHub org that owns the source.
- GitHub Actions can publish with repository-scoped permissions.
- Release pages, source links, provenance, and image packages stay together.

Docker Hub remains a reasonable mirror later, but it adds credentials,
namespace management, and another artifact surface to verify.

## Image Matrix

| Image | Dockerfile | Runtime user | Publish status |
| --- | --- | --- | --- |
| `intuition-core-api` | `docker/Dockerfile.api` | `bun` | prepared |
| `intuition-core-workers` | `docker/Dockerfile.workers` | `bun` | prepared |
| `intuition-core-atom-services` | `docker/Dockerfile.atom-services` | `bun` | prepared |
| `intuition-core-rindexer-ingestion` | `docker/Dockerfile.ingestion` | `indexer` | prepared |
| `intuition-core-projections` | `docker/Dockerfile.projections` | `projections` | prepared |
| `intuition-core-timescale-migrations` | `docker/Dockerfile.timescale-migrations` | inherited Postgres image user | prepared |
| `intuition-core-devnet-deployer` | `docker/Dockerfile.devnet` | root | local-only; writes a bind-mounted `/state` file |

## OCI Labels

Public images should carry:

- `org.opencontainers.image.title`
- `org.opencontainers.image.description`
- `org.opencontainers.image.source`
- `org.opencontainers.image.url`
- `org.opencontainers.image.documentation`
- `org.opencontainers.image.licenses`
- `org.opencontainers.image.version`
- `org.opencontainers.image.revision`
- `org.opencontainers.image.created`

Build args should be supplied by the publish workflow:

```bash
docker build \
  --build-arg VERSION=vX.Y.Z \
  --build-arg VCS_REF="$(git rev-parse HEAD)" \
  --build-arg CREATED="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -f docker/Dockerfile.api \
  -t ghcr.io/0xintuition/intuition-core-api:vX.Y.Z .
```

## Context Rules

The root `.dockerignore` must exclude secrets, local dependency trees, build
outputs, caches, logs, local databases, scratch files, and untracked review
reports. Dockerfiles still copy the workspace root because Bun installs and
Cargo workspace builds depend on root-level manifests and package boundaries.

Before public publishing, verify:

```bash
docker compose config -q
docker compose -f docker-compose.datastores.yml config -q
```

When the publish workflow exists, also verify each pushed artifact with:

```bash
docker pull ghcr.io/0xintuition/intuition-core-api@sha256:...
docker image inspect ghcr.io/0xintuition/intuition-core-api@sha256:...
```
