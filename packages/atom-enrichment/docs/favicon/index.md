# Favicon | Atom Enrichment

This document defines canonical enrichment payloads for the `favicon` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/favicon`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/favicon/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/favicon/index.ts`
- **Plugin id:** `favicon`
- **Artifact type(s):** `favicon`
- **Classification slug(s):** `favicon`
- **Runtime:** `universal`

## Data Structure

### Site Favicon Data (`favicon`)

Canonical favicon metadata for the target site.

```json
{
  "url": "<https_url>",
  "type": "<string_if_available>",
  "sizes": "<string_if_available>"
}
```

### Site Favicon Artifact

```json
{
  "artifact_type": "favicon",
  "data": {
    "url": "<https_url>",
    "type": "<string_if_available>",
    "sizes": "<string_if_available>"
  },
  "meta": {
    "pluginId": "favicon",
    "provider": "google-s2",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
