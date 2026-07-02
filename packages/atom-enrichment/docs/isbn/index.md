# ISBN | Atom Enrichment

This document defines canonical enrichment payloads for the `isbn` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/isbn`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/isbn/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `isbn`
- **Artifact type(s):** `isbn`
- **Classification slug(s):** `isbn`
- **Runtime:** `universal`

## Data Structure

### ISBN Book Lookup Data (`isbn`)

Book metadata from ISBN lookup services.

```json
{
  "isbn": "<string>",
  "title": "<string>",
  "authors": [
    "<string_if_available>"
  ],
  "publisher": "<string_if_available>",
  "publishedDate": "<string_if_available>",
  "pageCount": "<number_if_available>",
  "coverUrl": "<https_url_if_available>",
  "description": "<string_if_available>",
  "subjects": [
    "<string_if_available>"
  ]
}
```

### ISBN Book Lookup Artifact

```json
{
  "artifact_type": "isbn",
  "data": {
    "isbn": "<string>",
    "title": "<string>",
    "authors": [
      "<string_if_available>"
    ],
    "publisher": "<string_if_available>",
    "publishedDate": "<string_if_available>",
    "pageCount": "<number_if_available>",
    "coverUrl": "<https_url_if_available>",
    "description": "<string_if_available>",
    "subjects": [
      "<string_if_available>"
    ]
  },
  "meta": {
    "pluginId": "isbn",
    "provider": "isbn",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
