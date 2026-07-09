# `@0xintuition/contracts`

Thin Intuition Core facade over the published
[`@0xintuition/contracts-v2`](https://www.npmjs.com/package/@0xintuition/contracts-v2)
package.

Use this package inside `intuition-core` when backend code needs protocol
artifacts such as `MultiVaultAbi`. The upstream NPM package remains the source
of truth; this workspace package only gives the backend a stable import path and
owns the generated JSON file that rindexer still expects on disk.

```ts
import { MultiVaultAbi } from '@0xintuition/contracts';
```

Regenerate the rindexer ABI after upgrading `@0xintuition/contracts-v2`:

```bash
bun run --cwd packages/contracts sync:rindexer-artifacts
```
