# Spotify | Atom Enrichment

Spotify enrichment emits a normalized `spotify` artifact and, when Web API credentials are available, includes the raw Spotify API response object under `spotifyApiPayload`.

Supported Spotify URL families are tracks, albums, artists, playlists, podcast shows, and podcast episodes. When credentials are missing or the Web API fetch fails, the provider returns a URL-derived fallback artifact with `name`, `type`, `spotifyId`, and `spotifyUrl`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/spotify`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/spotify/schema.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/spotify/index.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin id:** `spotify`
- **Artifact type(s):** `spotify`
- **Classification slug(s):** `spotify`
- **Runtime:** `server`

## Data Structure

### Enrichment Data (`spotify`)

```json
{
  "name": "<string>",
  "type": "<track|album|artist|playlist|show|episode>",
  "spotifyId": "<string>",
  "spotifyUrl": "<https_url>",
  "previewUrl": "<https_url_if_available>",
  "imageUrl": "<https_url_if_available>",
  "artists": [
    {
      "name": "<string>",
      "spotifyId": "<string>"
    }
  ],
  "albumName": "<string_if_available>",
  "releaseDate": "<string_if_available>",
  "durationMs": "<number_if_available>",
  "popularity": "<number_if_available>",
  "isrc": "<string_if_available>",
  "genres": [
    "<string_if_available>"
  ],
  "description": "<string_if_available>",
  "publisher": "<string_if_available>",
  "totalEpisodes": "<number_if_available>",
  "languages": [
    "<string_if_available>"
  ],
  "showName": "<string_if_available>",
  "showSpotifyId": "<string_if_available>",
  "showSpotifyUrl": "<https_url_if_available>",
  "spotifyApiPayload": {
    "album": {
      "album_type": "<string_if_available>",
      "artists": [
        {
          "external_urls": {
            "spotify": "<https_url_if_available>"
          },
          "href": "<https_url_if_available>",
          "id": "<string_if_available>",
          "name": "<string_if_available>",
          "type": "<string_if_available>",
          "uri": "<string_if_available>"
        }
      ],
      "external_urls": {
        "spotify": "<https_url_if_available>"
      },
      "href": "<https_url_if_available>",
      "id": "<string_if_available>",
      "images": [
        {
          "url": "<https_url_if_available>",
          "width": "<number_if_available>",
          "height": "<number_if_available>"
        }
      ],
      "is_playable": "<boolean_if_available>",
      "name": "<string_if_available>",
      "release_date": "<string_if_available>",
      "release_date_precision": "<string_if_available>",
      "total_tracks": "<number_if_available>",
      "type": "<string_if_available>",
      "uri": "<string_if_available>"
    },
    "artists": [
      {
        "external_urls": {
          "spotify": "<https_url_if_available>"
        },
        "href": "<https_url_if_available>",
        "id": "<string_if_available>",
        "name": "<string_if_available>",
        "type": "<string_if_available>",
        "uri": "<string_if_available>"
      }
    ],
    "disc_number": "<number_if_available>",
    "duration_ms": "<number_if_available>",
    "explicit": "<boolean_if_available>",
    "external_ids": {
      "isrc": "<string_if_available>"
    },
    "external_urls": {
      "spotify": "<https_url_if_available>"
    },
    "href": "<https_url_if_available>",
    "id": "<string_if_available>",
    "is_local": "<boolean_if_available>",
    "is_playable": "<boolean_if_available>",
    "name": "<string_if_available>",
    "popularity": "<number_if_available>",
    "preview_url": "<https_url_if_available_or_null>",
    "track_number": "<number_if_available>",
    "type": "<string_if_available>",
    "uri": "<string_if_available>"
  }
}
```

### Enrichment Artifact (`spotify`)

```json
{
  "artifact_type": "spotify",
  "data": {
    "name": "<string>",
    "type": "<track|album|artist|playlist|show|episode>",
    "spotifyId": "<string>",
    "spotifyUrl": "<https_url>",
    "previewUrl": "<https_url_if_available>",
    "imageUrl": "<https_url_if_available>",
    "artists": [
      {
        "name": "<string>",
        "spotifyId": "<string>"
      }
    ],
    "albumName": "<string_if_available>",
    "releaseDate": "<string_if_available>",
    "durationMs": "<number_if_available>",
    "popularity": "<number_if_available>",
    "isrc": "<string_if_available>",
    "genres": [
      "<string_if_available>"
    ],
    "description": "<string_if_available>",
    "publisher": "<string_if_available>",
    "totalEpisodes": "<number_if_available>",
    "languages": [
      "<string_if_available>"
    ],
    "showName": "<string_if_available>",
    "showSpotifyId": "<string_if_available>",
    "showSpotifyUrl": "<https_url_if_available>",
    "spotifyApiPayload": "<raw_spotify_api_object_if_available>"
  },
  "meta": {
    "pluginId": "spotify",
    "provider": "<spotify-url|spotify-web-api>",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```

## Podcast Classification Contract

The classification package maps `https://open.spotify.com/show/{id}` to schema.org `PodcastSeries` and `https://open.spotify.com/episode/{id}` to `PodcastEpisode`. Both resolve to the app-level `podcast` runtime category; the precise schema.org identity stays on `schemaType`.

Read-time presentation uses dedicated `spotify-podcast-show` and `spotify-podcast-episode` rules-engine variants when the atom carries typed Spotify podcast artifacts or `PodcastSeries` / `PodcastEpisode` identity with Spotify canonical signals.

For seed/import tooling, use source-family labels `spotify_podcast_show` and `spotify_podcast_episode` for podcast rows that should route through this Spotify artifact contract. The runtime packages do not currently contain a central source-family registry; scrape/import code should treat those labels as handoff metadata for selecting Spotify classification/enrichment.

When a seed/import quality gate requires rich Spotify metadata, require the artifact `meta.provider` to be `spotify-web-api`. The `spotify-url` provider is a URL-derived fallback and should not be treated as fully enriched podcast data.
