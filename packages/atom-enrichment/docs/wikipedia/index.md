# Wikipedia | Atom Enrichment

This document defines canonical enrichment payloads for the `wikipedia` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/wikipedia`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/wikipedia/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/wikipedia/index.ts`
- **Plugin id:** `wikipedia`
- **Artifact type(s):** `wikipedia`
- **Classification slug(s):** `wikipedia`
- **Runtime:** `universal`

## Data Structure

### Wikipedia Summary Data (`wikipedia`)

Article summary and metadata sourced from Wikipedia.

```json
{
  "title": "<string>",
  "extract": "<string>",
  "extractHtml": "<string_if_available>",
  "thumbnailUrl": "<https_url_if_available>",
  "pageUrl": "<https_url>",
  "pageId": "<number_if_available>",
  "language": "<string>",
  "lastModified": "<string_if_available>"
}
```

### Wikipedia Summary Artifact

```json
{
  "artifact_type": "wikipedia",
  "data": {
    "title": "<string>",
    "extract": "<string>",
    "extractHtml": "<string_if_available>",
    "thumbnailUrl": "<https_url_if_available>",
    "pageUrl": "<https_url>",
    "pageId": "<number_if_available>",
    "language": "<string>",
    "lastModified": "<string_if_available>"
  },
  "meta": {
    "pluginId": "wikipedia",
    "provider": "wikipedia",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
