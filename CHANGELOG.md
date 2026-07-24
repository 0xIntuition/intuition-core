# Changelog

All notable public Intuition Core changes should be recorded here.

This project follows release notes that name every public artifact, not just the
Git tag. A release entry should include crate versions, container image tags and
digests, schema or migration changes, config changes, and verification evidence.

## Unreleased

### Added

- Published `intuition-curves` v0.1.0 to crates.io and verified the registry
  artifact, docs.rs build, Intuition team ownership, and a clean consumer build.
  crates.io checksum:
  `7c37020dc56bd772e645bcb51d5eef5bcc9f0f5d1e2b514b22be44def2c08001`.
- Prepared `intuition-curves` crate metadata for crates.io publication.
- Added Cargo CI gates for format, clippy, workspace tests, docs, and crate
  package dry-runs.
- Added release, crate, container, and indexing-scope docs for the OSS release
  roadmap.
- Hardened Docker build context exclusions and added OCI labels to public image
  Dockerfiles.

### Deferred

- Publishing service crates to crates.io. Core services remain distributed as
  container images until their public library boundaries are split from runtime
  concerns.

## v0.1.0-rc.2 - 2026-07-24

This release candidate points to commit
`a9b3b0ce51765ccde09d064a5f8da84e270f9a9a`. It supersedes the incomplete
`v0.1.0-rc.1` image set, whose ingestion image failed to compile after the
floating nightly Rust builder advanced to a compiler with an internal compiler
error. The ingestion builder is now pinned to the official Rust 1.97.1
multi-platform manifest.

### Artifacts

All images use tag `v0.1.0-rc.2`.

| Artifact | OCI index digest | Verified platforms |
| --- | --- | --- |
| `ghcr.io/0xintuition/intuition-core-api` | `sha256:870a7af8d5dbb27dde88ceedb453266e879459daa1e30a7f5a11f42953e67f2d` | `linux/amd64`, `linux/arm64` |
| `ghcr.io/0xintuition/intuition-core-atom-services` | `sha256:73f4ab3e0bb7ad0de0d7be5cfd8325b756a3289daeb71cca1261e8eda07d3f01` | `linux/amd64`, `linux/arm64` |
| `ghcr.io/0xintuition/intuition-core-workers` | `sha256:1d45e071da5a6ca02819a8020950ea9bc71688968ab24ceab16c86f463670b02` | `linux/amd64`, `linux/arm64` |
| `ghcr.io/0xintuition/intuition-core-rindexer-ingestion` | `sha256:1c328b7c761f97771a4ae8990e0533451b678d3b6b48ff55125364b23cf3b9fa` | `linux/amd64`, `linux/arm64` |
| `ghcr.io/0xintuition/intuition-core-projections` | `sha256:1469003657881d1ff8ef431720631e894eca74af7e102c738881039d349b6080` | `linux/amd64`, `linux/arm64` |
| `ghcr.io/0xintuition/intuition-core-timescale-migrations` | `sha256:d89aae195ea66c2d591982fbf9b8c192090253264150272dc76a8ed7393e573f` | `linux/amd64`, `linux/arm64` |

### Operator Impact

- Migrations: no schema changes beyond the migrations already contained in the
  release commit.
- Config changes: none.
- Image tag changes: use `v0.1.0-rc.2` or the immutable digest above. This
  release candidate did not publish or move `latest`; registry inspection
  confirmed that `latest` is absent for all six images.
- Rollback: select an earlier known-good tag or digest. Do not move this tag.

### Verification

- The
  [Publish Images run](https://github.com/0xIntuition/intuition-core/actions/runs/30108567576)
  succeeded for all six images. It resolved both requested platforms, pulled
  each platform by digest, verified
  `org.opencontainers.image.revision=a9b3b0ce51765ccde09d064a5f8da84e270f9a9a`,
  ran each image's executable/content smoke check, and verified GitHub
  provenance.
- Independent post-publish inspection resolved every `v0.1.0-rc.2` tag to the
  index digest above and confirmed `linux/amd64` and `linux/arm64` manifests.
  `gh attestation verify --bundle-from-oci` passed for every digest using the
  tagged source commit and `publish-images.yml` as the signer workflow.
  BuildKit SBOM and provenance attestations are present for both platforms.
- `make config-published IMAGE_TAG=v0.1.0-rc.2` passed.
- `make smoke-published IMAGE_TAG=v0.1.0-rc.2` passed with local builds
  disabled: API health and key creation succeeded; two atoms completed
  parse/classify/enrich processing; triple creation and API readback succeeded;
  final stats were `atoms=2`, `triples=1`, and `predicates=14`.
- `make smoke-index-published IMAGE_TAG=v0.1.0-rc.2` passed with local builds
  disabled for blocks `9030416-9030916`: `201` events, `21` projection
  checkpoints, `core_entities_checkpoint=50/50`, and `50` API-visible atoms.

## Release Note Template

```md
## vX.Y.Z - YYYY-MM-DD

### Artifacts

| Artifact | Version/tag | Digest/checksum | Verification |
| --- | --- | --- | --- |
| `intuition-curves` | `X.Y.Z` | crates.io checksum | `cargo install` or `cargo package` evidence |
| `ghcr.io/0xintuition/intuition-core-api` | `vX.Y.Z` | `sha256:...` | `docker pull` + label inspection |

### Operator Impact

- Migrations:
- Config changes:
- Image tag changes:
- Rollback notes:

### Verification

- CI run:
- crates.io page:
- Registry image page:
- SBOM/provenance:
```
