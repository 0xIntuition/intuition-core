# Places | Atom Enrichment

This document defines canonical enrichment payloads for the `places` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/places`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/places/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `places`
- **Artifact type(s):** `places`
- **Classification slug(s):** `places`
- **Runtime:** `server`

## Data Structure

### Place Details Data (`places`)

Place profile metadata including location, ratings, and contact data.

```json
{
  "name": "<string>",
  "formattedAddress": "<string_if_available>",
  "latitude": "<number_if_available>",
  "longitude": "<number_if_available>",
  "placeId": "<string_if_available>",
  "types": [
    "<string_if_available>"
  ],
  "rating": "<number_if_available>",
  "userRatingsTotal": "<number_if_available>",
  "photoUrl": "<https_url_if_available>",
  "website": "<https_url_if_available>",
  "phoneNumber": "<string_if_available>",
  "openingHours": [
    "<string_if_available>"
  ]
}
```

### Place Details Artifact

```json
{
  "artifact_type": "places",
  "data": {
    "name": "<string>",
    "formattedAddress": "<string_if_available>",
    "latitude": "<number_if_available>",
    "longitude": "<number_if_available>",
    "placeId": "<string_if_available>",
    "types": [
      "<string_if_available>"
    ],
    "rating": "<number_if_available>",
    "userRatingsTotal": "<number_if_available>",
    "photoUrl": "<https_url_if_available>",
    "website": "<https_url_if_available>",
    "phoneNumber": "<string_if_available>",
    "openingHours": [
      "<string_if_available>"
    ]
  },
  "meta": {
    "pluginId": "places",
    "provider": "places",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
