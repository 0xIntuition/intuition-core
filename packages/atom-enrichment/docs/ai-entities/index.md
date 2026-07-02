# AI Entities | Atom Enrichment

This document defines canonical enrichment payloads for the `ai-entities` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/ai-entities`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/ai-entities/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `ai-entities`
- **Artifact type(s):** `ai-entities`
- **Classification slug(s):** `ai-entities`
- **Runtime:** `server`

## Data Structure

### AI Entity Extraction Data (`ai-entities`)

Named entity extraction output from AI providers.

```json
{
  "entities": [
    "<string_if_available>"
  ],
  "model": "<string>",
  "generatedAt": "<string>"
}
```

### AI Entity Extraction Artifact

```json
{
  "artifact_type": "ai-entities",
  "data": {
    "entities": [
      "<string_if_available>"
    ],
    "model": "<string>",
    "generatedAt": "<string>"
  },
  "meta": {
    "pluginId": "ai-entities",
    "provider": "ai-entities",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
