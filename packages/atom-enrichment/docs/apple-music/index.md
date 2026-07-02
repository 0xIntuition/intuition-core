# Apple Music | Atom Enrichment

This document defines canonical enrichment payloads for the `apple-music` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/apple-music`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/apple-music/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `apple-music`
- **Artifact type(s):** `apple-music`
- **Classification slug(s):** `apple-music`
- **Runtime:** `server`

## Data Structure

### Apple Music Metadata Data (`apple-music`)

Apple Music song, album, or artist metadata.

```json
{
  "name": "<string>",
  "type": "<song|album|artist>",
  "appleMusicId": "<string>",
  "appleMusicUrl": "<https_url>",
  "artworkUrl": "<https_url_if_available>",
  "artistName": "<string_if_available>",
  "albumName": "<string_if_available>",
  "releaseDate": "<string_if_available>",
  "durationMs": "<number_if_available>",
  "isrc": "<string_if_available>",
  "genres": [
    "<string_if_available>"
  ]
}
```

### Apple Music Metadata Artifact

```json
{
  "artifact_type": "apple-music",
  "data": {
    "name": "<string>",
    "type": "<song|album|artist>",
    "appleMusicId": "<string>",
    "appleMusicUrl": "<https_url>",
    "artworkUrl": "<https_url_if_available>",
    "artistName": "<string_if_available>",
    "albumName": "<string_if_available>",
    "releaseDate": "<string_if_available>",
    "durationMs": "<number_if_available>",
    "isrc": "<string_if_available>",
    "genres": [
      "<string_if_available>"
    ]
  },
  "meta": {
    "pluginId": "apple-music",
    "provider": "apple-music",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
