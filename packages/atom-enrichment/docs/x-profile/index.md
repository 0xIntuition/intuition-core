# X Profile | Atom Enrichment

This document defines canonical enrichment payloads for the `x-profile` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/x-profile`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/x-profile/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/x-profile/index.ts`
- **Plugin id:** `x-profile`
- **Artifact type(s):** `x-profile`
- **Classification slug(s):** `x-profile`
- **Runtime:** `server`

## Supported X Matrix

- First-class supported target: X `profile` classifications enrich into `x-profile` with authenticated API data.
- Deliberate fallback target: X `post` classifications remain outside this provider and must not accidentally bind to `x-profile`.

## Data Structure

### X Profile Data (`x-profile`)

Profile metadata for an X account.

```json
{
  "username": "<string>",
  "name": "<string_if_available>",
  "bio": "<string_if_available>",
  "profileImageUrl": "<https_url_if_available>",
  "followers": "<number_if_available>",
  "following": "<number_if_available>",
  "tweetCount": "<number_if_available>",
  "verified": "<boolean_if_available>",
  "joinedAt": "<string_if_available>"
}
```

### X Profile Artifact

```json
{
  "artifact_type": "x-profile",
  "data": {
    "username": "<string>",
    "name": "<string_if_available>",
    "bio": "<string_if_available>",
    "profileImageUrl": "<https_url_if_available>",
    "followers": "<number_if_available>",
    "following": "<number_if_available>",
    "tweetCount": "<number_if_available>",
    "verified": "<boolean_if_available>",
    "joinedAt": "<string_if_available>"
  },
  "meta": {
    "pluginId": "x-profile",
    "provider": "x-profile",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
