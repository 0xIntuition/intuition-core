# Microdata | Atom Enrichment

This document defines canonical enrichment payloads for the `microdata` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/microdata`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/microdata/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `microdata`
- **Artifact type(s):** `microdata`
- **Classification slug(s):** `microdata`
- **Runtime:** `server`

## Data Structure

### Structured Microdata Data (`microdata`)

Structured metadata extracted from JSON-LD and microdata markup.

```json
{
  "url": "<https_url_if_available>",
  "title": "<string_if_available>",
  "description": "<string_if_available>",
  "mainEntity": "<string_if_available>",
  "jsonLd": [
    "<string_if_available>"
  ],
  "microdata": [
    "<string_if_available>"
  ]
}
```

### Structured Microdata Artifact

```json
{
  "artifact_type": "microdata",
  "data": {
    "url": "<https_url_if_available>",
    "title": "<string_if_available>",
    "description": "<string_if_available>",
    "mainEntity": "<string_if_available>",
    "jsonLd": [
      "<string_if_available>"
    ],
    "microdata": [
      "<string_if_available>"
    ]
  },
  "meta": {
    "pluginId": "microdata",
    "provider": "microdata",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
