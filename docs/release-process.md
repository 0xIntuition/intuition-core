# Release Process

This runbook covers public Intuition Core releases. It is intentionally
artifact-first: a GitHub workflow succeeding is not enough. Maintainers must
verify that each crate or image actually landed in its registry before marking a
release complete.

## Release Buckets

| Bucket | Status | Distribution | Notes |
| --- | --- | --- | --- |
| `intuition-curves` | crate-publishable | crates.io | First Rust crate prepared for public publishing. |
| `shared` | deferred | source-only | Split into stable public crates before any publish; see [rust-crate-boundaries.md](./rust-crate-boundaries.md). |
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
   `cargo test --workspace`, `cargo doc --workspace --no-deps`,
   `cargo deny --exclude-unpublished check`, and
   `cargo publish -p intuition-curves --dry-run`.
2. Check the package contents locally:
   `cargo package -p intuition-curves --list`.
3. Publish `intuition-curves`:
   `cargo publish -p intuition-curves`.
4. Verify the crate exists on crates.io and docs.rs has started building docs.
5. Record the crate version and registry checksum in `CHANGELOG.md` release
   notes.

Do not publish `shared`, `rindexer-ingestion`, or `projections` as crates.
`shared` must first be split into narrow public crates (`intuition-core-primitives`
and `intuition-core-events`) with package dry-runs of their own.

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

1. Publish a GitHub release, or manually run the `Publish Images` workflow from
   the matching Git tag ref with a `version` input of `vX.Y.Z` or
   `vX.Y.Z-rc.N`.
2. Confirm the workflow pushed and verified all six service images to GHCR.
3. Copy every image digest, verified tag-to-digest mapping, and
   platform-to-revision-label mapping from the workflow summary into the release
   notes.
4. Publish `latest` only for stable `vX.Y.Z` releases. Release candidates must
   never move `latest`.
5. Confirm BuildKit SBOM/provenance inputs were requested by the build step, and
   inspect the OCI attestations separately if release evidence requires it.
6. Confirm GitHub provenance attestation verification passed for each image
   digest.
7. Pull every image by digest from a clean environment.
8. Inspect OCI labels and confirm `org.opencontainers.image.revision` matches
   the release commit.
9. Run `docker compose config -q` against the compose file that consumes the
   published tags.
10. Record image tags, digests, attestation checks, and verification links in the
   release notes.

## Rollback And Yank Policy

Container rollback is tag selection: operators should pin semver tags or image
digests and roll back by returning to the previous known-good digest. Never
move an existing semver tag after it has been published.

Crate rollback is version selection. Prefer publishing a fixed patch version.
Use `cargo yank` only when a version is unusable or unsafe, and include the
yank reason plus replacement version in the changelog.

## Cargo Deny

`cargo deny --exclude-unpublished check` is part of the Rust CI gate. The
policy covers advisories, licenses, banned dependency patterns, and dependency
sources for crates that are eligible for public publication.

The current public crate surface is `intuition-curves`; service/runtime crates
such as `rindexer-ingestion`, `projections`, and the internal `shared` crate are
marked `publish = false` and remain image/source distributed until they have
separate public API reviews. Do not remove `publish = false` from those crates
without first making the full dependency graph pass `cargo deny check`.

Known full-workspace blockers outside the first crate publish gate:

- `projections` depends on SurrealDB crates that currently resolve to BUSL-1.1
  license files. This needs a separate dependency/legal decision before
  `projections` can become a publishable crate.
- `rindexer-ingestion` depends on the git-tagged `rindexer` crate. Full
  workspace source checks should either move to a crates.io release or add an
  explicit reviewed git-source policy.
- The unpublished service graph includes RustSec advisories in transitive TLS
  and messaging dependencies. Those must be resolved or explicitly reviewed
  before widening the deny gate beyond publishable crates.
