# Wikidata | Atom Enrichment

This document defines canonical enrichment payloads for the `wikidata` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/wikidata`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/wikidata/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/wikidata/index.ts`
- **Plugin id:** `wikidata`
- **Artifact type(s):** `wikidata`
- **Classification slug(s):** `wikidata`
- **Runtime:** `server`

## Data Structure

### Wikidata Entity Data (`wikidata`)

Wikidata entity claims, identifiers, and sitelinks.

```json
{
  "entityId": "<string>",
  "label": "<string>",
  "description": "<string_if_available>",
  "aliases": [
    "<string_if_available>"
  ],
  "claims": "<object_if_available>",
  "sitelinks": "<object_if_available>",
  "instanceOf": [
    "<string_if_available>"
  ]
}
```

### Wikidata Entity Artifact

```json
{
  "artifact_type": "wikidata",
  "data": {
    "entityId": "<string>",
    "label": "<string>",
    "description": "<string_if_available>",
    "aliases": [
      "<string_if_available>"
    ],
    "claims": "<object_if_available>",
    "sitelinks": "<object_if_available>",
    "instanceOf": [
      "<string_if_available>"
    ]
  },
  "meta": {
    "pluginId": "wikidata",
    "provider": "wikidata",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
