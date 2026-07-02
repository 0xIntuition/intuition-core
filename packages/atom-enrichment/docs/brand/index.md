# Brand | Atom Enrichment

This document defines canonical enrichment payloads for the `brand` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/brand`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/brand/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/brand/index.ts`
- **Plugin id:** `brand`
- **Artifact type(s):** `brand`
- **Classification slug(s):** `brand`
- **Runtime:** `server`

## Data Structure

### Brand Identity Data (`brand`)

Logo, color palette, and identity metadata for a domain.

```json
{
  "brandId": "<string_if_available>",
  "name": "<string_if_available>",
  "domain": "<string_if_available>",
  "claimed": "<boolean_if_available>",
  "description": "<string_if_available>",
  "longDescription": "<string_if_available>",
  "links": [
    "<object_if_available>"
  ],
  "logos": [
    "<object_if_available>"
  ],
  "icons": [
    "<object_if_available>"
  ],
  "images": [
    "<object_if_available>"
  ],
  "colors": [
    "<object_if_available>"
  ],
  "fontDetails": [
    "<object_if_available>"
  ],
  "qualityScore": "<number_if_available>",
  "company": "<object_if_available>",
  "isNsfw": "<boolean_if_available>",
  "urn": "<string_if_available>",
  "logoUrl": "<https_url_if_available>",
  "iconUrl": "<https_url_if_available>",
  "primaryColor": "<string_if_available>",
  "secondaryColor": "<string_if_available>",
  "fonts": [
    "<string_if_available>"
  ]
}
```

### Brand Identity Artifact

```json
{
  "artifact_type": "brand",
  "data": {
    "brandId": "<string_if_available>",
    "name": "<string_if_available>",
    "domain": "<string_if_available>",
    "claimed": "<boolean_if_available>",
    "description": "<string_if_available>",
    "longDescription": "<string_if_available>",
    "links": [
      "<object_if_available>"
    ],
    "logos": [
      "<object_if_available>"
    ],
    "icons": [
      "<object_if_available>"
    ],
    "images": [
      "<object_if_available>"
    ],
    "colors": [
      "<object_if_available>"
    ],
    "fontDetails": [
      "<object_if_available>"
    ],
    "qualityScore": "<number_if_available>",
    "company": "<object_if_available>",
    "isNsfw": "<boolean_if_available>",
    "urn": "<string_if_available>",
    "logoUrl": "<https_url_if_available>",
    "iconUrl": "<https_url_if_available>",
    "primaryColor": "<string_if_available>",
    "secondaryColor": "<string_if_available>",
    "fonts": [
      "<string_if_available>"
    ]
  },
  "meta": {
    "pluginId": "brand",
    "provider": "brandfetch",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
