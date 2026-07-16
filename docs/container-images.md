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
publish job and does not require Docker Hub credentials. It also has a narrow
`id-token: write` and `attestations: write` allowance for GitHub provenance
attestation; `bun run guard:supply-chain` only permits that OIDC allowance on
this reviewed publish workflow.

## Artifact Verification

The publish job enables BuildKit max-level provenance and SBOM attestations on
the pushed image, then generates a GitHub provenance attestation for the image
digest. The verification step validates the published digest, tags, runtime
smoke, revision label, and GitHub attestation. It fails the workflow if:

- the build action does not return a digest;
- the digest cannot be inspected from GHCR;
- any published tag resolves to a digest other than the build digest;
- GitHub provenance attestation verification fails for the digest;
- the `linux/amd64` runtime smoke check fails when that platform is requested;
- the pulled image revision label does not match the workflow commit.

The workflow summary records each image digest, digest reference, published
tags, and verified tag-to-digest mappings. Runtime smoke uses a minimal
`/bin/sh` command against the digest and checks expected runtime files or
binaries. If a manual run omits `linux/amd64` from `platforms`, digest and
attestation verification still run, but the local runtime smoke step is skipped
because the GitHub-hosted runner cannot execute the requested image platform.

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
  --repo 0xIntuition/intuition-core \
  --signer-workflow github.com/0xIntuition/intuition-core/.github/workflows/publish-images.yml
```
