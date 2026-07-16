# Container Images

Core services are distributed as source and public GHCR images. Week 1 hardened
Docker contexts and metadata; Week 2 adds the registry workflow first, then
artifact verification in a follow-up ticket.

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
| `ghcr.io/0xintuition/intuition-core-api` | `docker/Dockerfile.api` | `bun` | published by workflow |
| `ghcr.io/0xintuition/intuition-core-workers` | `docker/Dockerfile.workers` | `bun` | published by workflow |
| `ghcr.io/0xintuition/intuition-core-atom-services` | `docker/Dockerfile.atom-services` | `bun` | published by workflow |
| `ghcr.io/0xintuition/intuition-core-rindexer-ingestion` | `docker/Dockerfile.ingestion` | `indexer` | published by workflow |
| `ghcr.io/0xintuition/intuition-core-projections` | `docker/Dockerfile.projections` | `projections` | published by workflow |
| `ghcr.io/0xintuition/intuition-core-timescale-migrations` | `docker/Dockerfile.timescale-migrations` | inherited Postgres image user | published by workflow |
| `intuition-core-devnet-deployer` | `docker/Dockerfile.devnet` | root | local-only; writes a bind-mounted `/state` file |

## Publish Workflow

`.github/workflows/publish-images.yml` publishes the service image matrix to
GHCR. It runs when a GitHub release is published and can also be run manually
from the Actions tab.

Manual inputs:

- `version`: optional `vX.Y.Z` or `vX.Y.Z-rc.N` tag. Manual versioned
  publishes must be run from the matching Git tag ref. Omit this input for
  branch-based SHA-only publishes.
- `publish_latest`: optional; only valid with a stable `vX.Y.Z` version.
- `platforms`: optional comma-separated target platforms. The default is
  `linux/amd64,linux/arm64`.

Every pushed image receives an immutable `sha-<12-char-sha>` tag. Release and
manual versioned runs also receive the supplied semver tag. The `latest` tag is
reserved for stable releases only; release candidates must not move it.

The workflow uses the repository `GITHUB_TOKEN` with `packages: write` on the
publish job and does not require Docker Hub credentials. SBOM, provenance, and
post-push digest verification are intentionally handled by the Week 2
verification follow-up.

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

Build args are supplied by the publish workflow:

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

The verification follow-up must verify each pushed artifact with:

```bash
docker pull ghcr.io/0xintuition/intuition-core-api@sha256:...
docker image inspect ghcr.io/0xintuition/intuition-core-api@sha256:...
```
