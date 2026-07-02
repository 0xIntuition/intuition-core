# ENS | Atom Enrichment

This document defines canonical enrichment payloads for the `ens` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/ens`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/ens/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `ens`
- **Artifact type(s):** `ens`
- **Classification slug(s):** `ens`
- **Runtime:** `server`

## Data Structure

### ENS Name Data (`ens`)

ENS record metadata and address resolution.

```json
{
  "name": "<string>",
  "address": "<string>",
  "avatarUrl": "<https_url_if_available>",
  "contentHash": "<string_if_available>",
  "textRecords": "<object_if_available>",
  "expiryDate": "<string_if_available>"
}
```

### ENS Name Artifact

```json
{
  "artifact_type": "ens",
  "data": {
    "name": "<string>",
    "address": "<string>",
    "avatarUrl": "<https_url_if_available>",
    "contentHash": "<string_if_available>",
    "textRecords": "<object_if_available>",
    "expiryDate": "<string_if_available>"
  },
  "meta": {
    "pluginId": "ens",
    "provider": "ens",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
