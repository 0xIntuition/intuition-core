# arXiv | Atom Enrichment

This document defines canonical enrichment payloads for the `arxiv` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/arxiv`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/arxiv/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `arxiv`
- **Artifact type(s):** `arxiv`
- **Classification slug(s):** `arxiv`
- **Runtime:** `universal`

## Data Structure

### arXiv Paper Data (`arxiv`)

Preprint metadata from arXiv.

```json
{
  "arxivId": "<string>",
  "title": "<string>",
  "authors": [
    "<string>"
  ],
  "summary": "<string_if_available>",
  "publishedDate": "<string_if_available>",
  "updatedDate": "<string_if_available>",
  "categories": [
    "<string_if_available>"
  ],
  "pdfUrl": "<https_url_if_available>",
  "doi": "<string_if_available>",
  "comment": "<string_if_available>"
}
```

### arXiv Paper Artifact

```json
{
  "artifact_type": "arxiv",
  "data": {
    "arxivId": "<string>",
    "title": "<string>",
    "authors": [
      "<string>"
    ],
    "summary": "<string_if_available>",
    "publishedDate": "<string_if_available>",
    "updatedDate": "<string_if_available>",
    "categories": [
      "<string_if_available>"
    ],
    "pdfUrl": "<https_url_if_available>",
    "doi": "<string_if_available>",
    "comment": "<string_if_available>"
  },
  "meta": {
    "pluginId": "arxiv",
    "provider": "arxiv",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
