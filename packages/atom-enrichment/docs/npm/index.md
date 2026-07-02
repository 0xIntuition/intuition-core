# NPM | Atom Enrichment

This document defines canonical enrichment payloads for the `npm` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/npm`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/npm/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/npm/index.ts`
- **Plugin id:** `npm`
- **Artifact type(s):** `npm-package`
- **Classification slug(s):** `npm-package`
- **Runtime:** `universal`

## Data Structure

### NPM Package Data (`npm-package`)

NPM package registry metadata.

```json
{
  "name": "<string>",
  "version": "<string>",
  "description": "<string_if_available>",
  "keywords": [
    "<string_if_available>"
  ],
  "license": "<string_if_available>",
  "homepage": "<https_url_if_available>",
  "repository": "<string_if_available>",
  "weeklyDownloads": "<number_if_available>",
  "author": "<string_if_available>",
  "maintainers": [
    "<string_if_available>"
  ]
}
```

### NPM Package Artifact

```json
{
  "artifact_type": "npm-package",
  "data": {
    "name": "<string>",
    "version": "<string>",
    "description": "<string_if_available>",
    "keywords": [
      "<string_if_available>"
    ],
    "license": "<string_if_available>",
    "homepage": "<https_url_if_available>",
    "repository": "<string_if_available>",
    "weeklyDownloads": "<number_if_available>",
    "author": "<string_if_available>",
    "maintainers": [
      "<string_if_available>"
    ]
  },
  "meta": {
    "pluginId": "npm",
    "provider": "npm",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
