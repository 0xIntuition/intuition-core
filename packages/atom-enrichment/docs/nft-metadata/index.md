# NFT Metadata | Atom Enrichment

This document defines canonical enrichment payloads for the `nft-metadata` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/nft-metadata`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/nft-metadata/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `nft-metadata`
- **Artifact type(s):** `nft-metadata`
- **Classification slug(s):** `nft-metadata`
- **Runtime:** `server`

## Data Structure

### NFT Metadata Data (`nft-metadata`)

NFT collection and token metadata.

```json
{
  "name": "<string_if_available>",
  "description": "<string_if_available>",
  "imageUrl": "<https_url_if_available>",
  "animationUrl": "<https_url_if_available>",
  "externalUrl": "<https_url_if_available>",
  "contractAddress": "<string>",
  "tokenId": "<string>",
  "tokenStandard": "<string_if_available>",
  "attributes": [
    "<string_if_available>"
  ],
  "collectionName": "<string_if_available>"
}
```

### NFT Metadata Artifact

```json
{
  "artifact_type": "nft-metadata",
  "data": {
    "name": "<string_if_available>",
    "description": "<string_if_available>",
    "imageUrl": "<https_url_if_available>",
    "animationUrl": "<https_url_if_available>",
    "externalUrl": "<https_url_if_available>",
    "contractAddress": "<string>",
    "tokenId": "<string>",
    "tokenStandard": "<string_if_available>",
    "attributes": [
      "<string_if_available>"
    ],
    "collectionName": "<string_if_available>"
  },
  "meta": {
    "pluginId": "nft-metadata",
    "provider": "nft-metadata",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
