# AI Summary | Atom Enrichment

This document defines canonical enrichment payloads for the `ai-summary` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/ai-summary`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/ai-summary/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `ai-summary`
- **Artifact type(s):** `ai-summary`
- **Classification slug(s):** `ai-summary`
- **Runtime:** `server`

## Data Structure

### AI-Generated Summary Data (`ai-summary`)

Generated summary payloads from AI providers.

```json
{
  "summary": "<string>",
  "model": "<string>",
  "tokenCount": "<number_if_available>",
  "generatedAt": "<string>"
}
```

### AI-Generated Summary Artifact

```json
{
  "artifact_type": "ai-summary",
  "data": {
    "summary": "<string>",
    "model": "<string>",
    "tokenCount": "<number_if_available>",
    "generatedAt": "<string>"
  },
  "meta": {
    "pluginId": "ai-summary",
    "provider": "ai-summary",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
