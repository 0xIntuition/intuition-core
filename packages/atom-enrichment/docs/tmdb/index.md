# TMDB | Atom Enrichment

This document defines canonical enrichment payloads for the `tmdb` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/tmdb`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/tmdb/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/tmdb/index.ts`
- **Plugin id:** `tmdb`
- **Artifact type(s):** `tmdb`
- **Classification slug(s):** `tmdb`
- **Runtime:** `server`

## Data Structure

### Movie/TV Metadata Data (`tmdb`)

TMDB metadata for movie and TV entities.

```json
{
  "tmdbId": "<number>",
  "mediaType": "<movie|tv>",
  "title": "<string>",
  "overview": "<string_if_available>",
  "posterUrl": "<https_url_if_available>",
  "backdropUrl": "<https_url_if_available>",
  "releaseDate": "<string_if_available>",
  "voteAverage": "<number_if_available>",
  "genres": [
    "<string_if_available>"
  ],
  "runtime": "<number_if_available>",
  "imdbId": "<string_if_available>"
}
```

### Movie/TV Metadata Artifact

```json
{
  "artifact_type": "tmdb",
  "data": {
    "tmdbId": "<number>",
    "mediaType": "<movie|tv>",
    "title": "<string>",
    "overview": "<string_if_available>",
    "posterUrl": "<https_url_if_available>",
    "backdropUrl": "<https_url_if_available>",
    "releaseDate": "<string_if_available>",
    "voteAverage": "<number_if_available>",
    "genres": [
      "<string_if_available>"
    ],
    "runtime": "<number_if_available>",
    "imdbId": "<string_if_available>"
  },
  "meta": {
    "pluginId": "tmdb",
    "provider": "tmdb",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
