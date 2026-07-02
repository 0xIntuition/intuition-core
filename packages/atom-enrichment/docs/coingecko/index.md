# CoinGecko | Atom Enrichment

CoinGecko enrichment resolves token metadata from a CoinGecko coin id or EVM contract address and emits `token-metadata`.

## Provider Mapping

- **Provider directory:** `packages/atom-enrichment/src/plugins/providers/coingecko`
- **Canonical schema source:** `packages/atom-enrichment/src/plugins/providers/coingecko/schema.ts`
- **Plugin source:** `packages/atom-enrichment/src/plugins/providers/coingecko/index.ts`
- **Plugin id:** `coingecko`
- **Artifact type:** `token-metadata`
- **Classification slug:** `token-metadata`
- **Runtime:** `server`

## Data Structure

### Enrichment Data

```json
{
  "address": "<token_address_or_fallback_identifier>",
  "name": "<token_name>",
  "symbol": "<token_symbol>",
  "decimals": "<number>",
  "totalSupply": "<string_if_available>",
  "logoUrl": "<https_url_if_available>",
  "website": "<https_url_if_available>",
  "coingeckoId": "<string_if_available>",
  "priceUsd": "<number_if_available>",
  "marketCapUsd": "<number_if_available>",
  "coingeckoApiPayload": "<object_if_available>",
  "lookupStatus": "<resolved|not_found|error_if_available>",
  "lookupMessage": "<string_if_available>",
  "coingeckoLookupEndpoint": "<https_url_if_available>"
}
```

### Enrichment Artifact

```json
{
  "artifact_type": "token-metadata",
  "data": {
    "address": "<resolved_address_or_coin_id>",
    "name": "<resolved_name>",
    "symbol": "<resolved_symbol_uppercase>",
    "decimals": "<resolved_decimals_default_18>",
    "totalSupply": "<string_if_available>",
    "logoUrl": "<https_url_if_available>",
    "website": "<https_url_if_available>",
    "coingeckoId": "<coin_id_if_available>",
    "priceUsd": "<number_if_available>",
    "marketCapUsd": "<number_if_available>",
    "coingeckoApiPayload": "<raw_api_payload_object>",
    "lookupStatus": "resolved"
  },
  "meta": {
    "pluginId": "coingecko",
    "provider": "coingecko",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<https://www.coingecko.com/en/coins/{coinId}|https://www.coingecko.com/en>"
  }
}
```

### Example 

```json
{
  "artifact_type": "token-metadata",
  "data": {
    "address": "0x0000000000000000000000000000000000000000",
    "name": "Example Token",
    "symbol": "EXAMPLE",
    "decimals": 18,
    "totalSupply": "1000000000000000000000000",
    "logoUrl": "https://example.com/logo.png",
    "website": "https://example.com",
    "coingeckoId": "example-token",
    "priceUsd": 0.01,
    "marketCapUsd": 100000,
    "coingeckoApiPayload": {
      "id": "example-token",
      "symbol": "example",
      "name": "Example Token",
      "image": "https://example.com/logo.png",
      "current_price": {
        "usd": 0.01
      },
      "market_cap": {
        "usd": 100000
      }
    },
    "lookupStatus": "resolved"
  },
  "meta": {
    "pluginId": "coingecko",
    "provider": "coingecko",
    "fetchedAt": "2026-02-12T23:27:40.437Z",
    "sourceUrl": "https://www.coingecko.com/en/coins/example-token"
  }
}
```
