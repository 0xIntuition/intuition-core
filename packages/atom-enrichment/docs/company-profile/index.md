# Company Profile | Atom Enrichment

This document defines canonical enrichment payloads for the `company-profile` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/company-profile`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/company-profile/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Plugin id:** `company-profile`
- **Artifact type(s):** `company-profile`
- **Classification slug(s):** `company-profile`
- **Runtime:** `server`

## Data Structure

### Company Profile Data (`company-profile`)

Normalized organization profile from company data providers.

```json
{
  "name": "<string>",
  "description": "<string_if_available>",
  "domain": "<string_if_available>",
  "industry": "<string_if_available>",
  "employeeCount": "<string_if_available>",
  "foundedYear": "<number_if_available>",
  "headquarters": "<string_if_available>",
  "logoUrl": "<https_url_if_available>",
  "socialLinks": "<object_if_available>"
}
```

### Company Profile Artifact

```json
{
  "artifact_type": "company-profile",
  "data": {
    "name": "<string>",
    "description": "<string_if_available>",
    "domain": "<string_if_available>",
    "industry": "<string_if_available>",
    "employeeCount": "<string_if_available>",
    "foundedYear": "<number_if_available>",
    "headquarters": "<string_if_available>",
    "logoUrl": "<https_url_if_available>",
    "socialLinks": "<object_if_available>"
  },
  "meta": {
    "pluginId": "company-profile",
    "provider": "company-profile",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
