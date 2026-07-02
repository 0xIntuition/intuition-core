# Color Palette | Atom Enrichment

This document defines canonical enrichment payloads for the `color-palette` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/color-palette`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/color-palette/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `color-palette`
- **Artifact type(s):** `color-palette`
- **Classification slug(s):** `color-palette`
- **Runtime:** `server`

## Data Structure

### Color Palette Data (`color-palette`)

Image-derived dominant colors and palette breakdown.

```json
{
  "dominantColor": "<string>",
  "palette": [
    "<string>"
  ],
  "swatches": [
    "<string_if_available>"
  ],
  "sourceImageUrl": "<https_url_if_available>"
}
```

### Color Palette Artifact

```json
{
  "artifact_type": "color-palette",
  "data": {
    "dominantColor": "<string>",
    "palette": [
      "<string>"
    ],
    "swatches": [
      "<string_if_available>"
    ],
    "sourceImageUrl": "<https_url_if_available>"
  },
  "meta": {
    "pluginId": "color-palette",
    "provider": "color-palette",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
