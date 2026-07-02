# Vimeo | Atom Enrichment

This document defines canonical enrichment payloads for the `vimeo` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/vimeo`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/vimeo/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `vimeo`
- **Artifact type(s):** `vimeo`
- **Classification slug(s):** `vimeo`
- **Runtime:** `server`

## Data Structure

### Vimeo Video Data (`vimeo`)

Vimeo video metadata and embed details.

```json
{
  "videoId": "<string>",
  "title": "<string>",
  "description": "<string_if_available>",
  "channelName": "<string_if_available>",
  "channelUrl": "<https_url_if_available>",
  "publishedAt": "<string_if_available>",
  "thumbnailUrl": "<https_url_if_available>",
  "duration": "<number_if_available>",
  "viewCount": "<number_if_available>",
  "likeCount": "<number_if_available>",
  "embedHtml": "<string_if_available>"
}
```

### Vimeo Video Artifact

```json
{
  "artifact_type": "vimeo",
  "data": {
    "videoId": "<string>",
    "title": "<string>",
    "description": "<string_if_available>",
    "channelName": "<string_if_available>",
    "channelUrl": "<https_url_if_available>",
    "publishedAt": "<string_if_available>",
    "thumbnailUrl": "<https_url_if_available>",
    "duration": "<number_if_available>",
    "viewCount": "<number_if_available>",
    "likeCount": "<number_if_available>",
    "embedHtml": "<string_if_available>"
  },
  "meta": {
    "pluginId": "vimeo",
    "provider": "vimeo",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
