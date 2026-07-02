# Atom Enrichment Data Structures

This directory documents provider-level data payloads used by `@0xintuition/atom-enrichment`.

## Common Artifact Envelope

```json
{
  "artifact_type": "<classification_slug>",
  "data": {},
  "meta": {
    "pluginId": "<plugin_slug>",
    "provider": "<provider_name>",
    "fetchedAt": "<iso_datetime>",
    "sourceUrl": "<source_url_if_available>",
    "confidence": "<number_0_to_1_if_available>",
    "fromCache": "<boolean_if_available>",
    "cachedAt": "<iso_datetime_if_available>"
  }
}
```

## Provider Docs

- [AI Entities](./ai-entities/index.md)
- [AI Summary](./ai-summary/index.md)
- [Apple Music](./apple-music/index.md)
- [arXiv](./arxiv/index.md)
- [Brand](./brand/index.md)
- [CoinGecko](./coingecko/index.md)
- [Color Palette](./color-palette/index.md)
- [Company Profile](./company-profile/index.md)
- [Crossref](./crossref/index.md)
- [Crunchbase](./crunchbase/index.md)
- [Dictionary](./dictionary/index.md)
- [ENS](./ens/index.md)
- [Etherscan](./etherscan/index.md)
- [Favicon](./favicon/index.md)
- [Geocode](./geocode/index.md)
- [GitHub](./github/index.md)
- [ISBN](./isbn/index.md)
- [Microdata](./microdata/index.md)
- [MusicBrainz](./musicbrainz/index.md)
- [NFT Metadata](./nft-metadata/index.md)
- [NPM](./npm/index.md)
- [oEmbed](./oembed/index.md)
- [OpenGraph](./opengraph/index.md)
- [Places](./places/index.md)
- [Product Listing](./product-listing/index.md)
- [Pubmed](./pubmed/index.md)
- [Reddit Post](./reddit-post/index.md)
- [Screenshot](./screenshot/index.md)
- [Spotify](./spotify/index.md)
- [TMDB](./tmdb/index.md)
- [X Profile](./x-profile/index.md)
- [Vimeo](./vimeo/index.md)
- [Wikidata](./wikidata/index.md)
- [Wikipedia](./wikipedia/index.md)
- [YouTube](./youtube/index.md)
