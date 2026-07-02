# oEmbed | Atom Enrichment

This document defines canonical enrichment payloads for the `oembed` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/oembed`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/oembed/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/oembed/index.ts`
- **Plugin id:** `oembed`
- **Artifact type(s):** `oembed`
- **Classification slug(s):** `oembed`
- **Runtime:** `universal`

## Data Structure

### oEmbed Embed Data (`oembed`)

Provider-supplied rich embed metadata from oEmbed endpoints.

```json
{
  "type": "<photo|video|link|rich>",
  "title": "<string_if_available>",
  "authorName": "<string_if_available>",
  "authorUrl": "<https_url_if_available>",
  "providerName": "<string_if_available>",
  "providerUrl": "<https_url_if_available>",
  "thumbnailUrl": "<https_url_if_available>",
  "thumbnailWidth": "<number_if_available>",
  "thumbnailHeight": "<number_if_available>",
  "html": "<string_if_available>",
  "width": "<number_if_available>",
  "height": "<number_if_available>",
  "url": "<https_url_if_available>"
}
```

### oEmbed Embed Artifact

```json
{
  "artifact_type": "oembed",
  "data": {
    "type": "<photo|video|link|rich>",
    "title": "<string_if_available>",
    "authorName": "<string_if_available>",
    "authorUrl": "<https_url_if_available>",
    "providerName": "<string_if_available>",
    "providerUrl": "<https_url_if_available>",
    "thumbnailUrl": "<https_url_if_available>",
    "thumbnailWidth": "<number_if_available>",
    "thumbnailHeight": "<number_if_available>",
    "html": "<string_if_available>",
    "width": "<number_if_available>",
    "height": "<number_if_available>",
    "url": "<https_url_if_available>"
  },
  "meta": {
    "pluginId": "oembed",
    "provider": "oembed",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
