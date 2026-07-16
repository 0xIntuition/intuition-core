# `@0xintuition/types`

Stable shared contract surfaces for classification, enrichment, and other
cross-package payloads.

## Use This Package For

- validating request and response payloads at service boundaries
- consuming classification and enrichment results in apps and shared packages
- importing typed normalized provider payloads such as Spotify, GitHub, brand,
  token metadata, and other implemented enrichment outputs
- reusing classification-to-enrichment handoff helpers without importing
  runtime package internals

## Do Not Use This Package For

- classification engine or plugin authoring internals
- enrichment engine construction or plugin implementation
- runtime-only helpers that are not part of the stable consumer contract

If you are building engine or plugin logic, import from
`@0xintuition/atom-classification` or `@0xintuition/atom-enrichment` directly.

## Export Surfaces

```ts
import {} from '@0xintuition/types/classification'
import {} from '@0xintuition/types/enrichment'
import {} from '@0xintuition/types/indexing-scope'
```

- `@0xintuition/types/classification`
  Consumer-facing classification request, result, and policy contracts
- `@0xintuition/types/enrichment`
  Consumer-facing enrichment request/result contracts, normalized provider data
  types, artifact unions, and classification-to-enrichment handoff helpers
- `@0xintuition/types/indexing-scope`
  Operator-facing scope config schema, parser, and rindexer dry-run renderer

## Examples

### 1. Validate a classification or process payload at a boundary

Use the shared schemas in tRPC routers, API proxies, or persistence adapters so
every consumer validates against the same contract.

```ts
import {
  classificationRequestSchema,
  classificationResultSchema,
} from '@0xintuition/types/classification'
import {
  processProcedureInputSchema,
  processProcedureOutputSchema,
} from '@0xintuition/types/enrichment'

const classificationRequest = classificationRequestSchema.parse(input)
const classificationResult = classificationResultSchema.parse(serviceResponse)

const processInput = processProcedureInputSchema.parse(rawBody)
const processOutput = processProcedureOutputSchema.parse(responseJson)
```

Current repo example:
`packages/trpc/src/router/classification.ts`

### 2. Convert classification output into typed enrichment input

Use the shared handoff helper instead of reconstructing enrichment input from
loose classification fields.

```ts
import {
  type ClassifiedAtomInput,
  toClassifiedAtomInput,
} from '@0xintuition/types/enrichment'

function buildEnrichmentInput(
  rawInput: string,
  classification: unknown
): ClassifiedAtomInput | null {
  return toClassifiedAtomInput(rawInput, classification)
}
```

Current repo example:
`apps/experimental/src/features/experimental/atom-processing-utils.ts`

### 3. Narrow enrichment artifacts without guessing `artifact.data`

Use `knownEnrichmentArtifactSchema` when a consumer needs to branch on the
artifact type and access the correctly typed normalized payload.

```ts
import {
  knownEnrichmentArtifactSchema,
  type KnownEnrichmentArtifact,
} from '@0xintuition/types/enrichment'

function renderArtifact(input: unknown) {
  const artifact: KnownEnrichmentArtifact = knownEnrichmentArtifactSchema.parse(input)

  switch (artifact.artifact_type) {
    case 'spotify':
      return artifact.data.name

    case 'github-repo':
      return artifact.data.fullName

    case 'brand':
      return artifact.data.name

    case 'token-metadata':
      return `${artifact.data.name} (${artifact.data.symbol})`

    default:
      return null
  }
}
```

This avoids app-level field probing such as
`artifact.data?.title ?? artifact.data?.name ?? artifact.data?.full_name`.

### 4. Import a specific normalized provider payload type directly

If the consumer already knows which provider it is dealing with, import the
concrete type or schema from the enrichment surface.

```ts
import {
  type BrandData,
  type GitHubRepoData,
  type SpotifyData,
  brandDataSchema,
  githubRepoDataSchema,
  spotifyDataSchema,
} from '@0xintuition/types/enrichment'

const brand: BrandData = brandDataSchema.parse(payload)
const repo: GitHubRepoData = githubRepoDataSchema.parse(payload)
const spotify: SpotifyData = spotifyDataSchema.parse(payload)
```

Available normalized provider payloads include:

- `BrandData`
- `DoiData`
- `EtherscanData`
- `FaviconData`
- `GitHubRepoData`
- `GitHubUserData`
- `MusicBrainzData`
- `NpmPackageData`
- `OEmbedData`
- `OpenGraphData`
- `ProductListingData`
- `SpotifyData`
- `TmdbData`
- `TokenMetadataData`
- `XProfileData`
- `WikidataData`
- `WikipediaData`
- `YouTubeData`

Additional schema-backed provider payloads are also exported for providers that
are represented in the repo but not yet part of the implemented artifact union.

### 5. Reuse shared enrichment URL resolution

Use the shared helper when consumers need to choose the preferred canonical
source URL for enrichment or persistence metadata.

```ts
import { resolvePreferredEnrichmentUrl } from '@0xintuition/types/enrichment'

const sourceUrl = resolvePreferredEnrichmentUrl({
  rawInput,
  canonicalId: atom.canonicalId,
  sameAs: atom.sameAs,
})
```

Current repo examples:

- `apps/experimental/src/features/atoms/create/atom-processing-utils.ts`
- `apps/experimental/src/features/experimental/atom-processing-utils.ts`

## Rule Of Thumb

- If you consume classification results, import from
  `@0xintuition/types/classification`
- If you consume enrichment results or provider payloads, import from
  `@0xintuition/types/enrichment`
- If you need to validate or narrow a specific provider payload, use the
  exported provider schema or type from `@0xintuition/types/enrichment`
- If you are implementing engine or plugin logic, stay in the runtime packages
