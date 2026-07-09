# Contract Artifacts

Intuition Core consumes protocol contract artifacts from the published NPM
package [`@0xintuition/contracts-v2`](https://www.npmjs.com/package/@0xintuition/contracts-v2).
The package contains the Intuition V2 Solidity sources, compiled ABIs, and
creation bytecode. It is the source of truth for contract artifacts in this
repo.

## Why this matters

The backend needs contract artifacts for two different jobs:

| Consumer | What it needs | Why |
| --- | --- | --- |
| TypeScript packages and services | Typed ABI exports such as `MultiVaultAbi` | Build clients, tests, deployment helpers, and agent workflows without copying JSON by hand |
| Rust rindexer ingestion | `crates/rindexer-ingestion/abi/MultiVault.json` | rindexer reads ABI JSON from disk when decoding onchain events |

Both paths now come from the same NPM package. TypeScript imports the package
directly through a small workspace facade, and the rindexer JSON file is
generated from that same ABI export.

## Packages

### Upstream source of truth

```bash
@0xintuition/contracts-v2
```

Use this directly from external projects when you need the canonical contract
package:

```bash
bun add @0xintuition/contracts-v2
```

```ts
import { MultiVaultAbi, MultiVaultBytecode } from '@0xintuition/contracts-v2';
import { TrustBondingAbi } from '@0xintuition/contracts-v2/abis';
```

### Intuition Core facade

```bash
packages/contracts
```

Inside this repo, prefer the facade package:

```ts
import { MultiVaultAbi, MULTIVAULT_RINDEXER_EVENTS } from '@0xintuition/contracts';
```

The facade is intentionally small. It gives backend code a stable import path
and records which MultiVault events the indexer expects. It should not fork,
edit, or reinterpret upstream contract artifacts.

## Updating contract artifacts

1. Check the latest published version:

   ```bash
   npm view @0xintuition/contracts-v2 version
   ```

2. Update the dependency in `packages/contracts/package.json` and refresh the
   lockfile:

   ```bash
   bun install
   ```

   The current first-party contract package is listed in `bunfig.toml` as a
   reviewed minimum-release-age exception because it was published specifically
   for this integration before the repo's normal 14-day package-aging window had
   elapsed. Do not add other exceptions without an explicit supply-chain review.

3. Regenerate the ABI JSON used by rindexer:

   ```bash
   bun run abis:sync
   ```

4. Run the focused tests:

   ```bash
   bun run --cwd packages/contracts test
   ```

5. Run the repo checks before opening or updating a PR:

   ```bash
   bun run typecheck
   bun run check
   bun run test
   cargo fmt --all -- --check
   cargo clippy --workspace --all-targets -- -D warnings
   cargo test --workspace
   ```

The focused package test compares `crates/rindexer-ingestion/abi/MultiVault.json`
with the ABI exported by `@0xintuition/contracts-v2`. If that test fails after a
version bump, regenerate the rindexer artifact before committing.

## Licensing

`intuition-core` is MIT licensed. The upstream contract package declares its own
license. Treat `@0xintuition/contracts-v2` as a third-party dependency with its
own license terms, even though it is maintained by Intuition.

## Agent notes

- Do not manually edit `crates/rindexer-ingestion/abi/MultiVault.json`.
- Do not copy ABI snippets from docs, explorers, or another repository.
- Do not change the rindexer event list without checking
  `crates/rindexer-ingestion/rindexer.yaml` and the projection consumers.
- When the NPM version changes, include the package version, generated ABI diff,
  and validation commands in the PR description.
