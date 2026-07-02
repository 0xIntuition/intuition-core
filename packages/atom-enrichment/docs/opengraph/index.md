# OpenGraph | Atom Enrichment

OpenGraph enrichment extracts metadata from HTML `<meta>` tags and normalizes it into the `opengraph` artifact.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/opengraph`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/opengraph/schema.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/opengraph/index.ts`
- **Plugin id:** `opengraph`
- **Artifact type:** `opengraph`
- **Classification slug:** `opengraph`
- **Runtime:** `universal`

## Data Structure

### Enrichment Data

```json
{
  "title": "<string_if_available>",
  "description": "<string_if_available>",
  "image": "<https_url_if_available>",
  "url": "<https_url_if_available>",
  "siteName": "<string_if_available>",
  "type": "<string_if_available>",
  "locale": "<string_if_available>",
  "audio": "<https_url_if_available>",
  "audioUrl": "<https_url_if_available>",
  "audioType": "<string_if_available>"
}
```

### Enrichment Artifact

```json
{
  "artifact_type": "opengraph",
  "data": {
    "title": "<from_og_title_or_html_title>",
    "description": "<from_og_description>",
    "image": "<from_og_image>",
    "url": "<from_og_url_or_request_url>",
    "siteName": "<from_og_site_name>",
    "type": "<from_og_type>",
    "locale": "<from_og_locale>",
    "audio": "<from_og_audio_or_related_keys>",
    "audioUrl": "<from_og_audio_or_related_keys>",
    "audioType": "<from_og_audio_type_or_related_keys>"
  },
  "meta": {
    "pluginId": "opengraph",
    "provider": "website",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<request_url>"
  }
}
```

### Example

```json
{
  "artifact_type": "opengraph",
  "data": {
    "title": "Feel the Love (feat. Wale)",
    "description": "Rudimental, Wale · Home (Deluxe Edition) · Song · 2013",
    "image": "https://i.scdn.co/image/ab67616d0000b2738d879f108f3ef1b2086c67e8",
    "url": "https://open.spotify.com/track/0ojU4I7FDbtkvh4lnkPI1C",
    "siteName": "Spotify",
    "type": "music.song",
    "audio": "https://p.scdn.co/mp3-preview/68d27a7f86d9ecb0b2e8b5de777e319006f66aea",
    "audioUrl": "https://p.scdn.co/mp3-preview/68d27a7f86d9ecb0b2e8b5de777e319006f66aea",
    "audioType": "audio/mpeg"
  },
  "meta": {
    "pluginId": "opengraph",
    "provider": "website",
    "fetchedAt": "2026-02-12T23:27:40.437Z",
    "sourceUrl": "https://open.spotify.com/track/0ojU4I7FDbtkvh4lnkPI1C?si=21240713411d486b",
    "fromCache": true,
    "cachedAt": "2026-02-12T23:27:40.522Z"
  }
}
```
