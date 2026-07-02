# Etherscan | Atom Enrichment

This document defines canonical enrichment payloads for the `etherscan` provider in `@0xintuition/atom-enrichment`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/etherscan`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/etherscan/schema.ts`
- **Classification registry source:** `packages/atom-enrichment/src/classifications/defaults.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/etherscan/index.ts`
- **Plugin id:** `etherscan`
- **Artifact type(s):** `etherscan`
- **Classification slug(s):** `etherscan`
- **Runtime:** `server`

## Data Structure

### Etherscan Address Data (`etherscan`)

Address and contract metadata from Etherscan.

```json
{
  "address": "<string>",
  "balance": "<string>",
  "balanceEth": "<string_if_available>",
  "transactionCount": "<number_if_available>",
  "isContract": "<boolean>",
  "contractName": "<string_if_available>",
  "tokenName": "<string_if_available>",
  "tokenSymbol": "<string_if_available>",
  "firstSeen": "<string_if_available>"
}
```

### Etherscan Address Artifact

```json
{
  "artifact_type": "etherscan",
  "data": {
    "address": "<string>",
    "balance": "<string>",
    "balanceEth": "<string_if_available>",
    "transactionCount": "<number_if_available>",
    "isContract": "<boolean>",
    "contractName": "<string_if_available>",
    "tokenName": "<string_if_available>",
    "tokenSymbol": "<string_if_available>",
    "firstSeen": "<string_if_available>"
  },
  "meta": {
    "pluginId": "etherscan",
    "provider": "etherscan",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>"
  }
}
```
