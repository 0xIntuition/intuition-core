# Product Listing | Atom Enrichment

This document defines canonical enrichment payloads for the `product-listing` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/product-listing`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/product-listing/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/product-listing/index.ts`
- **Plugin id:** `product-listing`
- **Artifact type(s):** `product-listing`
- **Classification slug(s):** `product-listing`
- **Runtime:** `server`

## Fallback Policy

- Supported target: authenticated Amazon `product` classifications with an ASIN.
- Explicit fallback: Amazon `storefront` classifications stay out of scope for this issue and must not resolve as `product-listing`.

## Data Structure

### Product Listing Data (`product-listing`)

Product catalog metadata including pricing and availability.

```json
{
  "name": "<string>",
  "brand": "<string_if_available>",
  "description": "<string_if_available>",
  "price": "<string_if_available>",
  "currency": "<string_if_available>",
  "imageUrl": "<https_url_if_available>",
  "rating": "<number_if_available>",
  "reviewCount": "<number_if_available>",
  "availability": "<string_if_available>",
  "sku": "<string_if_available>",
  "gtin": "<string_if_available>"
}
```

### Product Listing Artifact

```json
{
  "artifact_type": "product-listing",
  "data": {
    "name": "<string>",
    "brand": "<string_if_available>",
    "description": "<string_if_available>",
    "price": "<string_if_available>",
    "currency": "<string_if_available>",
    "imageUrl": "<https_url_if_available>",
    "rating": "<number_if_available>",
    "reviewCount": "<number_if_available>",
    "availability": "<string_if_available>",
    "sku": "<string_if_available>",
    "gtin": "<string_if_available>"
  },
  "meta": {
    "pluginId": "product-listing",
    "provider": "product-listing",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
