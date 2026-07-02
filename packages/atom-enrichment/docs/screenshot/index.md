# Screenshot | Atom Enrichment

This document defines canonical enrichment payloads for the `screenshot` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/screenshot`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/screenshot/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `screenshot`
- **Artifact type(s):** `screenshot`
- **Classification slug(s):** `screenshot`
- **Runtime:** `server`

## Data Structure

### Page Screenshot Data (`screenshot`)

Rendered screenshot capture and viewport metadata.

```json
{
  "imageUrl": "<https_url>",
  "width": "<number>",
  "height": "<number>",
  "capturedAt": "<string>",
  "viewportSize": "<string_if_available>"
}
```

### Page Screenshot Artifact

```json
{
  "artifact_type": "screenshot",
  "data": {
    "imageUrl": "<https_url>",
    "width": "<number>",
    "height": "<number>",
    "capturedAt": "<string>",
    "viewportSize": "<string_if_available>"
  },
  "meta": {
    "pluginId": "screenshot",
    "provider": "screenshot",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
