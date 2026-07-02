# YouTube | Atom Enrichment

This document defines canonical enrichment payloads for the `youtube` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/youtube`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/youtube/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/youtube/index.ts`
- **Plugin id:** `youtube`
- **Artifact type(s):** `youtube`
- **Classification slug(s):** `youtube`
- **Runtime:** `server`

## Data Structure

### YouTube Video Data (`youtube`)

YouTube video metadata and engagement stats.

```json
{
  "videoId": "<string>",
  "title": "<string>",
  "description": "<string_if_available>",
  "channelTitle": "<string_if_available>",
  "channelId": "<string_if_available>",
  "publishedAt": "<string_if_available>",
  "thumbnailUrl": "<https_url_if_available>",
  "duration": "<string_if_available>",
  "viewCount": "<number_if_available>",
  "likeCount": "<number_if_available>",
  "tags": [
    "<string_if_available>"
  ],
  "embedHtml": "<string_if_available>"
}
```

### YouTube Video Artifact

```json
{
  "artifact_type": "youtube",
  "data": {
    "videoId": "<string>",
    "title": "<string>",
    "description": "<string_if_available>",
    "channelTitle": "<string_if_available>",
    "channelId": "<string_if_available>",
    "publishedAt": "<string_if_available>",
    "thumbnailUrl": "<https_url_if_available>",
    "duration": "<string_if_available>",
    "viewCount": "<number_if_available>",
    "likeCount": "<number_if_available>",
    "tags": [
      "<string_if_available>"
    ],
    "embedHtml": "<string_if_available>"
  },
  "meta": {
    "pluginId": "youtube",
    "provider": "youtube",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
