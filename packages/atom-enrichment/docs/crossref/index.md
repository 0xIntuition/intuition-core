# Crossref | Atom Enrichment

This document defines canonical enrichment payloads for the `crossref` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/crossref`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/crossref/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/crossref/index.ts`
- **Plugin id:** `crossref`
- **Artifact type(s):** `doi`
- **Classification slug(s):** `doi`
- **Runtime:** `universal`

## Data Structure

### DOI Publication Data (`doi`)

DOI publication metadata from CrossRef/DataCite.

```json
{
  "doi": "<string>",
  "title": "<string>",
  "authors": [
    "<string_if_available>"
  ],
  "publishedDate": "<string_if_available>",
  "journal": "<string_if_available>",
  "publisher": "<string_if_available>",
  "abstract": "<string_if_available>",
  "url": "<https_url>",
  "type": "<string_if_available>",
  "citationCount": "<number_if_available>"
}
```

### DOI Publication Artifact

```json
{
  "artifact_type": "doi",
  "data": {
    "doi": "<string>",
    "title": "<string>",
    "authors": [
      "<string_if_available>"
    ],
    "publishedDate": "<string_if_available>",
    "journal": "<string_if_available>",
    "publisher": "<string_if_available>",
    "abstract": "<string_if_available>",
    "url": "<https_url>",
    "type": "<string_if_available>",
    "citationCount": "<number_if_available>"
  },
  "meta": {
    "pluginId": "crossref",
    "provider": "crossref",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
