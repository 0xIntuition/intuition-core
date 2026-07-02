# Crunchbase | Atom Enrichment

Crunchbase currently defines a normalized company data schema and classification mapping. In this worktree, there is no provider plugin implementation file yet (`index.ts` is not present in the provider directory).

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/crunchbase`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/crunchbase/schema.ts`
- **Plugin source:** _No provider `index.ts` implementation in this worktree (schema-only prototype)._
- **Classification slug:** `crunchbase`
- **Configured runtime:** `server`

## Data Structure

### Enrichment Data

```json
{
  "name": "<company_name>",
  "shortDescription": "<string_if_available>",
  "foundedOn": "<date_string_if_available>",
  "numEmployeesEnum": "<string_if_available>",
  "totalFundingUsd": "<number_if_available>",
  "lastFundingType": "<string_if_available>",
  "lastFundingDate": "<date_string_if_available>",
  "categories": ["<category_string>", "<...>"],
  "headquarters": "<string_if_available>",
  "website": "<https_url_if_available>",
  "logoUrl": "<https_url_if_available>",
  "crunchbaseUrl": "<https_url_if_available>"
}
```

### Enrichment Artifact

```json
{
  "artifact_type": "crunchbase",
  "data": {
    "name": "<company_name>",
    "shortDescription": "<string_if_available>",
    "foundedOn": "<date_string_if_available>",
    "numEmployeesEnum": "<string_if_available>",
    "totalFundingUsd": "<number_if_available>",
    "lastFundingType": "<string_if_available>",
    "lastFundingDate": "<date_string_if_available>",
    "categories": ["<category_string>", "<...>"],
    "headquarters": "<string_if_available>",
    "website": "<https_url_if_available>",
    "logoUrl": "<https_url_if_available>",
    "crunchbaseUrl": "<https_url_if_available>"
  },
  "meta": {
    "pluginId": "crunchbase",
    "provider": "crunchbase",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<crunchbase_url_if_available>"
  }
}
```

### Example

```json
{
  "artifact_type": "crunchbase",
  "data": {
    "name": "Rudimental",
    "shortDescription": "An experimental music project by Wale featuring collaborations with artists from around the world.",
    "foundedOn": "2013-01-01",
    "numEmployeesEnum": "1-5",
    "totalFundingUsd": 2500000,
    "lastFundingType": "seed",
    "lastFundingDate": "2015-01-01",
    "categories": ["Music", "Experimental"],
    "headquarters": "London, UK",
    "website": "https://rudimental.com",
    "logoUrl": "https://rudimental.com/logo.png",
    "crunchbaseUrl": "https://crunchbase.com/organization/rudimental"
  },
  "meta": {
    "pluginId": "crunchbase",
    "provider": "crunchbase",
    "fetchedAt": "2026-02-12T23:27:40.437Z",
    "sourceUrl": "https://crunchbase.com/organization/rudimental"
  }
}
```
