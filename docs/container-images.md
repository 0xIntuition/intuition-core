# Container Images

Core services are distributed as source and public GHCR images. The publish
workflow builds the service image matrix, pushes immutable digest-backed tags,
and verifies the published artifacts before release completion.

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

The workflow uses the repository `GITHUB_TOKEN` with `packages: write` and does
not require Docker Hub credentials. Build/push runs without OIDC. A separate
attestation and verification job has the narrow `id-token: write` and
`attestations: write` allowance required for GitHub provenance attestation;
`bun run guard:supply-chain` only permits that OIDC allowance on that reviewed
job. Linked artifact storage records are intentionally disabled with
`create-storage-record: false`; release evidence is the OCI registry artifact,
digest/tag checks, and GitHub artifact attestation.

## Artifact Verification

The publish job enables BuildKit max-level provenance and SBOM attestations on
the pushed image, then a separate job generates a GitHub provenance attestation
for the image digest. The verification step validates the published digest,
tags, requested-platform revision labels, optional runtime smoke, and GitHub
attestation. It fails the workflow if:

- the build action does not return a digest;
- the digest cannot be inspected from GHCR;
- any published tag resolves to a digest other than the build digest;
- GitHub provenance attestation verification fails for the digest;
- any requested platform image revision label does not match the workflow
  commit;
- the `linux/amd64` runtime smoke check fails when that platform is requested.

The workflow summary records each image digest, digest reference, published
tags, verified tag-to-digest mappings, requested-platform revision-label
mappings, and runtime smoke status. Runtime smoke uses a minimal `/bin/sh`
command against the digest and checks expected runtime files or binaries. If a
manual run omits `linux/amd64` from `platforms`, digest, tag, revision-label,
and attestation verification still run, but the local runtime smoke step is
skipped because the GitHub-hosted runner cannot execute the requested image
platform.

## Running Published Images

Local build mode remains the default:

```bash
docker compose up
```

To run a clean checkout from GHCR images instead, layer the published-image
override:

```bash
COMPOSE_FILE=docker-compose.yml:docker-compose.published.yml \
  INTUITION_CORE_IMAGE_TAG=vX.Y.Z \
  docker compose up -d
```

Equivalent Make targets are available:

```bash
make config-published IMAGE_TAG=vX.Y.Z
make up-published IMAGE_TAG=vX.Y.Z
make index-published IMAGE_TAG=vX.Y.Z
```

The override removes local build contexts for public runtime images and sets
`pull_policy: always` so tag updates are pulled before startup. The local devnet
deployer remains source-built because it writes local deployment state and is
not a public runtime artifact. The override uses Docker Compose's `!reset`
merge tag, so use current Docker Compose v2 rather than the legacy
`docker-compose` v1 binary.

Use tags for local trials and release-candidate smoke runs. Use digest-pinned
images for production, incident reproduction, or any release note that must be
auditable. Digest pins come from the publish workflow summary after artifact
verification completes.

Tag mode:

```bash
INTUITION_CORE_IMAGE_TAG=vX.Y.Z \
  COMPOSE_FILE=docker-compose.yml:docker-compose.published.yml \
  docker compose up -d
```

Digest mode sets full image references per service:

```bash
export INTUITION_CORE_API_IMAGE=ghcr.io/0xintuition/intuition-core-api@sha256:...
export INTUITION_CORE_ATOM_SERVICES_IMAGE=ghcr.io/0xintuition/intuition-core-atom-services@sha256:...
export INTUITION_CORE_WORKERS_IMAGE=ghcr.io/0xintuition/intuition-core-workers@sha256:...
export INTUITION_CORE_RINDEXER_INGESTION_IMAGE=ghcr.io/0xintuition/intuition-core-rindexer-ingestion@sha256:...
export INTUITION_CORE_PROJECTIONS_IMAGE=ghcr.io/0xintuition/intuition-core-projections@sha256:...
export INTUITION_CORE_TIMESCALE_MIGRATIONS_IMAGE=ghcr.io/0xintuition/intuition-core-timescale-migrations@sha256:...
export COMPOSE_FILE=docker-compose.yml:docker-compose.published.yml

docker compose up -d
```

### Published-Image Smoke Checklist

Run the same critical path as local build mode, without rebuilding:

```bash
make smoke-published IMAGE_TAG=vX.Y.Z
```

This checks:

- API health at `/health`;
- API stats at `/api/stats`;
- API key creation inside the published API image;
- atom creation through `POST /api/atoms`;
- worker processing through parse, classification, and enrichment completion;
- triple creation and readback through `POST /api/triples` and `GET /api/triples/:id`.

For bounded indexing and projections:

```bash
make smoke-index-published IMAGE_TAG=vX.Y.Z
```

This checks:

- the published indexer image can ingest the deterministic public testnet
  window;
- the event store receives canonical events;
- projection checkpoints advance;
- `core_entities` catches up to the indexed atom/triple events;
- API stats expose indexed atoms from the KG.

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

Before public publishing, verify Compose syntax locally:

```bash
docker compose config -q
docker compose -f docker-compose.datastores.yml config -q
```

After publishing, verify an image digest manually with:

```bash
docker buildx imagetools inspect ghcr.io/0xintuition/intuition-core-api@sha256:...
docker pull --platform linux/amd64 ghcr.io/0xintuition/intuition-core-api@sha256:...
gh attestation verify \
  oci://ghcr.io/0xintuition/intuition-core-api@sha256:... \
  --bundle-from-oci \
  --repo 0xIntuition/intuition-core \
  --signer-workflow github.com/0xIntuition/intuition-core/.github/workflows/publish-images.yml
```
