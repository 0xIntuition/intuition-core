# Reddit Post | Atom Enrichment

This document defines canonical enrichment payloads for the `reddit-post` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/reddit-post`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/reddit-post/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `reddit-post`
- **Artifact type(s):** `reddit-post`
- **Classification slug(s):** `reddit-post`
- **Runtime:** `server`

## Data Structure

### Reddit Post Data (`reddit-post`)

Post metadata sourced from Reddit APIs.

```json
{
  "postId": "<string>",
  "title": "<string>",
  "subreddit": "<string>",
  "author": "<string_if_available>",
  "score": "<number_if_available>",
  "numComments": "<number_if_available>",
  "url": "<https_url_if_available>",
  "permalink": "<string_if_available>",
  "createdAt": "<string_if_available>",
  "isNsfw": "<boolean_if_available>"
}
```

### Reddit Post Artifact

```json
{
  "artifact_type": "reddit-post",
  "data": {
    "postId": "<string>",
    "title": "<string>",
    "subreddit": "<string>",
    "author": "<string_if_available>",
    "score": "<number_if_available>",
    "numComments": "<number_if_available>",
    "url": "<https_url_if_available>",
    "permalink": "<string_if_available>",
    "createdAt": "<string_if_available>",
    "isNsfw": "<boolean_if_available>"
  },
  "meta": {
    "pluginId": "reddit-post",
    "provider": "reddit-post",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
