# v2 Dev/Staging Image Consumption Plan

This plan describes how `intuition-v2` can test public Intuition Core container
images in non-production environments. It is intentionally limited to dev and
staging. Production consumption remains blocked on the D2/platform decision.

## Scope

In scope:

- consume Core images from GHCR only after the release-candidate publish,
  artifact verification, and Core published-image smoke gates pass;
- use digest-pinned image references for every v2 dev/staging trial;
- test the first replaceable runtime surfaces: `rindexer-ingestion` and
  `projections`;
- use the `timescale-migrations` image only against disposable or snapshotted
  dev/staging databases;
- record compatibility evidence before deciding whether to open implementation
  tickets in `intuition-v2` or `gcp-deployment`.

Out of scope:

- production image consumption;
- moving `latest`;
- automatic promotion from dev to staging or staging to production;
- replacing the v2 API, workers, recommendation tier, or private product
  services with Core images;
- changing secrets, provider accounts, or production service accounts.

## Candidate Services

| Candidate | Image | Initial environment | Gate |
| --- | --- | --- | --- |
| Rindexer ingestion | `ghcr.io/0xintuition/intuition-core-rindexer-ingestion` | dev, then staging | ABI/event parity, bounded chain window, event-store count/range checks |
| Projections | `ghcr.io/0xintuition/intuition-core-projections` | dev, then staging | same event window as ingestion, checkpoint/read-model checks |
| Timescale migrations | `ghcr.io/0xintuition/intuition-core-timescale-migrations` | disposable dev DB or staging snapshot only | migration diff reviewed, no destructive production use |
| Atom services | `ghcr.io/0xintuition/intuition-core-atom-services` | optional later dev smoke | endpoint parity for `/health`, classify, enrich, process, cache fallback, auth-token behavior |

Keep the v2 API and workers source-built for this effort. They still own
private app routes, auth/product behavior, and private worker integrations that
are not Core image boundaries.

## Image Pinning

Use the release-candidate tag only to discover artifacts. Before any v2 run,
copy the exact digest reference from the Core publish workflow summary.

Required evidence per image:

- image name;
- semver release-candidate tag, such as `vX.Y.Z-rc.N`;
- digest reference, such as
  `ghcr.io/0xintuition/intuition-core-projections@sha256:...`;
- `org.opencontainers.image.revision`;
- Core publish workflow URL;
- Core smoke workflow or command output reference.

Do not use `latest` in dev/staging trials. Do not let Image Updater track a
mutable tag for these services. Rollback must be a revert to a previously known
v2 digest or source-built v2 image, not a tag mutation.

## Sequence

1. Publish a Core release candidate after the image publishing, artifact
   verification, and published Compose tickets have landed.
2. Verify all required GHCR packages exist and their tags resolve to the
   expected digests.
3. Run Core self-smoke:

   ```bash
   make smoke-published IMAGE_TAG=vX.Y.Z-rc.N
   make smoke-index-published IMAGE_TAG=vX.Y.Z-rc.N
   ```

4. Compare v2 and Core compatibility inputs before using the images:
   generated ABI/rindexer artifacts, migration files, environment variables,
   chain ID, contract address, start block, and projection scope.
5. In v2 dev, run only the digest-pinned `rindexer-ingestion` image against a
   bounded public testnet window and disposable or isolated Timescale state.
6. Verify dev ingestion evidence: canonical event count, first and last block,
   no duplicate events, no dead-letter growth, and no unexpected schema writes.
7. Add the digest-pinned `projections` image against the same event window.
8. Verify dev projection evidence: `projection_checkpoints` advances,
   `core_entities` catches up, required market read models are populated, and
   v2 API-visible stats/queries match the baseline set.
9. Repeat the same bounded test in staging only after a DB snapshot or isolated
   replay target exists.
10. Stop at the staging evidence packet. Production requires a separate
    D2/platform decision with owners, release window, rollback owner, and
    environment-specific runbook.

## Compatibility Gates

### ABI And Event Inputs

- Run Core ABI verification before publishing the release candidate.
- Compare v2 and Core `MultiVault.json` and generated rindexer event types.
- Confirm the event selector set, chain ID, contract address, start block, and
  bounded end block are identical for the trial.
- Do not hand-copy generated rindexer output from Core into v2.

### Schema And Migrations

- Diff v2 Timescale migrations against Core migrations before running the
  migration image.
- Run migration trials only against a disposable database or a staging snapshot
  with a restore plan.
- Confirm `projection_checkpoints` schema and read-model tables expected by v2
  are present before starting projections.
- Do not apply Core migration images to production under this plan.

### Runtime Configuration

- Confirm Core image defaults do not embed private RPC URLs, diagnostics URLs,
  provider keys, or secrets.
- Provide all chain, RPC, database, Redis, API, and projection scope settings
  through v2 dev/staging environment configuration.
- Keep provider keys optional for atom-services trials and verify keyless
  behavior separately from keyed behavior.
- Use least-privilege dev/staging service accounts if Kubernetes changes are
  introduced.

### Data And Health Evidence

- `event_store` row count equals the expected bounded window count.
- First and last indexed block match the selected test window.
- No duplicate canonical events are inserted.
- `projection_checkpoints` advances for the expected projections.
- `core_entities` and required market read models match the baseline query set.
- API-visible indexed atom/claim stats match the baseline after projection
  catch-up.
- Dead-letter counts remain zero or have reviewed, expected entries.

### Supply Chain Evidence

- Images are consumed by digest.
- Tag-to-digest mappings match the Core workflow summary.
- GitHub provenance attestation verification passed for each image digest.
- OCI revision labels match the release commit.
- No `latest` reference appears in dev/staging configuration.

## gcp-deployment And Image Updater

Do not change production apps as part of this plan.

If implementation requires `gcp-deployment` changes, constrain them to
dev/staging overlays:

- add per-service image repository and digest overrides for
  `rindexer-ingestion`, `projections`, and optional migration jobs;
- disable mutable-tag auto-updates for these services, or require manual PRs
  that pin a reviewed digest;
- preserve existing v2 image repositories for production;
- annotate dev/staging workloads with source repo, Core release tag, digest, and
  `org.opencontainers.image.revision`;
- keep secrets and provider credentials in the existing v2 secret-management
  path.

Image Updater may propose a PR for a new release-candidate digest, but it must
not apply the change directly to staging or production.

## Rollback

Rollback is image selection plus state discipline:

- restore the previous v2 image digest or source-built v2 image reference;
- stop Core image consumers before replaying with v2 images;
- do not roll back database migrations by changing images;
- restore the disposable database or staging snapshot when migration behavior
  is under test;
- reset or replay projection checkpoints only in an isolated schema, disposable
  database, or approved staging snapshot restore;
- record the failed Core tag, digest, block window, and failing gate before
  closing the trial.

For ingestion-only failures, prefer rerunning the bounded window against a fresh
disposable event store. For projection failures, keep the ingested events and
replay projections only if the checkpoint and read-model state can be reset
without affecting shared staging data.

## Evidence Packet Template

Before promoting from dev to staging, and before requesting any production D2
decision, record:

| Field | Value |
| --- | --- |
| Core release candidate | `vX.Y.Z-rc.N` |
| Core commit | `<sha>` |
| Publish workflow | `<url>` |
| Core smoke evidence | `<url or command log reference>` |
| Image digests | `<service -> digest>` |
| OCI revision labels | `<service -> revision>` |
| Test chain/window | `<chain id, contract, start block, end block>` |
| ABI/event parity result | `<pass/fail + artifact refs>` |
| Migration diff result | `<pass/fail + snapshot/restore ref>` |
| Ingestion evidence | `<event count, first/last block, duplicates, dead letters>` |
| Projection evidence | `<checkpoints, read models, API-visible stats>` |
| Rollback rehearsal | `<previous digest restored or snapshot restored>` |
| Residual risks | `<open items>` |

## Implementation Follow-Ups

- Open an `intuition-v2` ticket for the dev-only digest-pinned ingestion trial
  after GHCR release-candidate images exist.
- Open an `intuition-v2` ticket for the projections trial only after the
  ingestion trial passes.
- Open a `gcp-deployment` ticket only if dev/staging Kubernetes overlays need
  image repository or digest override support.
- Keep production image consumption blocked until the D2/platform decision is
  signed off.
