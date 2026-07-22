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
