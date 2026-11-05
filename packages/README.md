# Local packages and npm dependencies

This directory contains five private Core workspaces. Each has a `package.json`
and maintained source. Published Intuition packages are installed from npm into
`node_modules`; they do not belong in this directory.

| Local workspace | What Core owns here |
| --- | --- |
| [`atom-rules-engine`](./atom-rules-engine/README.md) | Standalone presentation selection rules and tests. Currently has no active Core runtime caller; it is not the classification or enrichment runtime. |
| [`contracts`](./contracts/README.md) | Deployment tooling, indexer integration, and the remaining deployer-specific artifacts. Protocol ABIs and bytecodes come from npm where available. |
| `database-kg` | Knowledge graph schemas, migrations, and persistence actions. |
| [`database-timescale`](./database-timescale/README.md) | Timescale read models, query helpers, and schema verification. |
| [`types`](./types/README.md) | Indexing scope configuration and compatibility re-exports of published enrichment types. |

## Published dependencies

The parsing, classification, enrichment, and runtime composition implementations
come from `@0xintuition/atom-parser`, `@0xintuition/atom-classification`,
`@0xintuition/atom-enrichment`, and `@0xintuition/atom-runtime`.
IID, protocol, deployments, IDs, predicates, classifications, curves, schema.org,
and pipeline utilities also come from published packages.

Dependency declarations in [the root manifest](../package.json) and each consumer's
`package.json` identify the exact versions. `workspace:*` means a local workspace;
an exact version means an npm dependency. [The lockfile](../bun.lock) records the
resolved dependency graph and artifact integrity hashes. The public package
source lives in [0xIntuition/packages](https://github.com/0xIntuition/packages).

`node_modules`, `dist`, `.cache`, and `.turbo` are generated directories, not
additional source workspaces. No local tarballs, release-train staging directory,
or sibling checkout is needed to install, build, or run package conformance tests.
