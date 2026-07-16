# Release Process

This runbook covers public Intuition Core releases. It is intentionally
artifact-first: a GitHub workflow succeeding is not enough. Maintainers must
verify that each crate or image actually landed in its registry before marking a
release complete.

## Release Buckets

| Bucket | Status | Distribution | Notes |
| --- | --- | --- | --- |
| `intuition-curves` | crate-publishable | crates.io | First Rust crate prepared for public publishing. |
| `shared` | deferred | source-only | Internal domain/config types are not yet a stable public API. |
| `rindexer-ingestion` | image-published target | container image | Runtime service with generated rindexer code and chain config. |
| `projections` | image-published target | container image | Runtime service with DB migrations and projection config. |
| `api` | image-published target | container image | Bun service image. |
| `workers` | image-published target | container image | Bun worker image with command-selected modes. |
| `atom-services` | image-published target | container image | Bun classify/enrich service image. |
| `timescale-migrations` | image-published target | container image | One-shot migration image. |
| `devnet-deploy` | source-only | local Docker build | Local operator utility, not a public runtime artifact yet. |

## Crate Publish Order

1. Confirm CI is green on the release commit:
   `cargo fmt --all -- --check`, `cargo clippy --workspace --all-targets -- -D warnings`,
   `cargo test --workspace`, `cargo doc --workspace --no-deps`, and
   `cargo publish -p intuition-curves --dry-run`.
2. Check the package contents locally:
   `cargo package -p intuition-curves --list`.
3. Publish `intuition-curves`:
   `cargo publish -p intuition-curves`.
4. Verify the crate exists on crates.io and docs.rs has started building docs.
5. Record the crate version and registry checksum in `CHANGELOG.md` release
   notes.

Do not publish `shared`, `rindexer-ingestion`, or `projections` as crates until
they have explicit public API tickets and package dry-runs of their own.

## Container Publish Order

The preferred registry is GHCR because the source repository and package
permissions are both under the GitHub org. Docker Hub can be added later if
operator demand justifies a second registry.

Recommended public image names:

| Service | Image |
| --- | --- |
| API | `ghcr.io/0xintuition/intuition-core-api` |
| Workers | `ghcr.io/0xintuition/intuition-core-workers` |
| Atom services | `ghcr.io/0xintuition/intuition-core-atom-services` |
| Rindexer ingestion | `ghcr.io/0xintuition/intuition-core-rindexer-ingestion` |
| Projections | `ghcr.io/0xintuition/intuition-core-projections` |
| Timescale migrations | `ghcr.io/0xintuition/intuition-core-timescale-migrations` |

Publish order:

1. Publish a GitHub release, or manually run the `Publish Images` workflow with
   a `version` input of `vX.Y.Z` or `vX.Y.Z-rc.N`.
2. Confirm the workflow pushed all six service images to GHCR.
3. Confirm every image has a `sha-<12-char-sha>` tag matching the release
   commit. Versioned runs must also have the semver tag.
4. Publish `latest` only for stable `vX.Y.Z` releases. Release candidates must
   never move `latest`.
5. Generate SBOM/provenance where the publishing workflow supports it.
6. Pull every image by digest from a clean environment.
7. Inspect OCI labels and confirm `org.opencontainers.image.revision` matches
   the release commit.
8. Run `docker compose config -q` against the compose file that consumes the
   published tags.
9. Record image tags, digests, and verification links in the release notes.

## Rollback And Yank Policy

Container rollback is tag selection: operators should pin semver tags or image
digests and roll back by returning to the previous known-good digest. Never
move an existing semver tag after it has been published.

Crate rollback is version selection. Prefer publishing a fixed patch version.
Use `cargo yank` only when a version is unusable or unsafe, and include the
yank reason plus replacement version in the changelog.

## Cargo Deny

`cargo deny` is deferred for Week 1 because this repo does not yet include a
`deny.toml`, and introducing a policy file needs a separate license/advisory
review. The immediate gate is package safety: format, clippy, tests, docs, and
`cargo publish --dry-run`. A future ticket should add `deny.toml` before
broader crate publication.
