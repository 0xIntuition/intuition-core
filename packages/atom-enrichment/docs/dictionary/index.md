# Dictionary | Atom Enrichment

This document defines canonical enrichment payloads for the `dictionary` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/dictionary`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/dictionary/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `dictionary`
- **Artifact type(s):** `dictionary`
- **Classification slug(s):** `dictionary`
- **Runtime:** `universal`

## Data Structure

### Dictionary Definition Data (`dictionary`)

Dictionary meanings, pronunciation, and lexical metadata.

```json
{
  "word": "<string>",
  "phonetic": "<string_if_available>",
  "audioUrl": "<https_url_if_available>",
  "meanings": [
    "<string_if_available>"
  ],
  "sourceUrl": "<https_url_if_available>"
}
```

### Dictionary Definition Artifact

```json
{
  "artifact_type": "dictionary",
  "data": {
    "word": "<string>",
    "phonetic": "<string_if_available>",
    "audioUrl": "<https_url_if_available>",
    "meanings": [
      "<string_if_available>"
    ],
    "sourceUrl": "<https_url_if_available>"
  },
  "meta": {
    "pluginId": "dictionary",
    "provider": "dictionary",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
