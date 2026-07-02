# Pubmed | Atom Enrichment

This document defines canonical enrichment payloads for the `pubmed` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/pubmed`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/pubmed/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `pubmed`
- **Artifact type(s):** `pubmed`
- **Classification slug(s):** `pubmed`
- **Runtime:** `server`

## Data Structure

### PubMed Article Data (`pubmed`)

Biomedical publication metadata from PubMed.

```json
{
  "pmid": "<string>",
  "title": "<string>",
  "authors": [
    "<string_if_available>"
  ],
  "journal": "<string_if_available>",
  "publishedDate": "<string_if_available>",
  "abstract": "<string_if_available>",
  "doi": "<string_if_available>",
  "url": "<https_url_if_available>",
  "meshTerms": [
    "<string_if_available>"
  ]
}
```

### PubMed Article Artifact

```json
{
  "artifact_type": "pubmed",
  "data": {
    "pmid": "<string>",
    "title": "<string>",
    "authors": [
      "<string_if_available>"
    ],
    "journal": "<string_if_available>",
    "publishedDate": "<string_if_available>",
    "abstract": "<string_if_available>",
    "doi": "<string_if_available>",
    "url": "<https_url_if_available>",
    "meshTerms": [
      "<string_if_available>"
    ]
  },
  "meta": {
    "pluginId": "pubmed",
    "provider": "pubmed",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
