# MusicBrainz | Atom Enrichment

This document defines canonical enrichment payloads for the `musicbrainz` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/musicbrainz`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/musicbrainz/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/musicbrainz/index.ts`
- **Plugin id:** `musicbrainz`
- **Artifact type(s):** `musicbrainz`
- **Classification slug(s):** `musicbrainz`
- **Runtime:** `universal`

## Data Structure

### MusicBrainz Entry Data (`musicbrainz`)

Open music database entity metadata.

```json
{
  "mbid": "<string>",
  "name": "<string>",
  "type": "<string>",
  "disambiguation": "<string_if_available>",
  "isrcs": [
    "<string_if_available>"
  ],
  "releaseDate": "<string_if_available>",
  "artistCredit": "<string_if_available>",
  "tags": [
    "<string_if_available>"
  ]
}
```

### MusicBrainz Entry Artifact

```json
{
  "artifact_type": "musicbrainz",
  "data": {
    "mbid": "<string>",
    "name": "<string>",
    "type": "<string>",
    "disambiguation": "<string_if_available>",
    "isrcs": [
      "<string_if_available>"
    ],
    "releaseDate": "<string_if_available>",
    "artistCredit": "<string_if_available>",
    "tags": [
      "<string_if_available>"
    ]
  },
  "meta": {
    "pluginId": "musicbrainz",
    "provider": "musicbrainz",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
