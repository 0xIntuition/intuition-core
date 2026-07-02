# Geocode | Atom Enrichment

This document defines canonical enrichment payloads for the `geocode` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/geocode`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/geocode/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `geocode`
- **Artifact type(s):** `geocode`
- **Classification slug(s):** `geocode`
- **Runtime:** `server`

## Data Structure

### Geocode Result Data (`geocode`)

Geocoding coordinates and normalized address components.

```json
{
  "latitude": "<number>",
  "longitude": "<number>",
  "formattedAddress": "<string>",
  "components": "<object_if_available>"
}
```

### Geocode Result Artifact

```json
{
  "artifact_type": "geocode",
  "data": {
    "latitude": "<number>",
    "longitude": "<number>",
    "formattedAddress": "<string>",
    "components": "<object_if_available>"
  },
  "meta": {
    "pluginId": "geocode",
    "provider": "geocode",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
