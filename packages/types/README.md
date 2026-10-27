# `@0xintuition/types`

Core-owned shared contract surfaces for indexing scope configuration and enrichment artifact normalization.

## Export Surfaces

```ts
import {} from "@0xintuition/types/enrichment";
import {} from "@0xintuition/types/indexing-scope";
```

- `@0xintuition/types/indexing-scope` — Operator-facing indexing scope config schema, parser, and rindexer dry-run renderer (used by `scripts/scope-dry-run.ts`).
- `@0xintuition/types/enrichment` — Normalized enrichment artifact union schemas and provider data re-exports from `@0xintuition/atom-enrichment`.

For classification contracts, import directly from `@0xintuition/atom-classification`. For HTTP service route schemas, use the schemas owned by `services/atom-services`.
