# Classification & enrichment providers

How to unlock each data source. **Everything in the first table works with zero
setup** — provider keys only add coverage. Set keys in `.env`; docker-compose
passes them through to `workers-*` and `atom-services` automatically. Plugins
whose keys are missing skip gracefully (`not_applicable`) — nothing fails.

## Works out of the box (no keys)

| Source | What it enriches |
| --- | --- |
| OpenGraph / microdata / JSON-LD | title, description, images for any web page |
| Favicon / color-palette | site icons and brand colors |
| Wikipedia + Wikidata | article extracts, canonical entities, claims, `sameAs` |
| GitHub (public data) | repos, orgs, profiles — unauthenticated rate limits apply |
| npm | package metadata, weekly downloads |
| arXiv / Crossref / PubMed | papers, DOIs, citations |
| MusicBrainz | artists, releases, recordings |
| ISBN / dictionary / oEmbed | books, word definitions, embeddable media |
| ENS / NFT metadata | Ethereum names and token metadata (public RPC) |

## Unlocked with a key

All keys are optional and most have free tiers.

| Env var(s) | Unlocks | How to get it |
| --- | --- | --- |
| `GITHUB_TOKEN` | higher GitHub rate limits (60 → 5,000 req/h) | github.com → Settings → Developer settings → **Personal access tokens** → fine-grained, public-repo read only |
| `SPOTIFY_CLIENT_ID` + `SPOTIFY_CLIENT_SECRET` (optional `SPOTIFY_MARKET`) | tracks, albums, artists, playlists | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → Create app → copy Client ID/Secret (free) |
| `ETHERSCAN_API_KEY` | contract names, token metadata, verified source | [etherscan.io/apis](https://etherscan.io/apis) → free plan → API key. Also enables the etherscan **classification** plugin's authenticated tier |
| `TMDB_API_KEY` | movies, TV shows, credits | [themoviedb.org/settings/api](https://www.themoviedb.org/settings/api) → free API key |
| `COINGECKO_API_KEY` | token prices, market data | [coingecko.com/api](https://www.coingecko.com/en/api) → free Demo plan key |
| `YOUTUBE_API_KEY` | video/channel metadata | [console.cloud.google.com](https://console.cloud.google.com) → enable **YouTube Data API v3** → Credentials → API key |
| `GOOGLE_PLACES_API_KEY` | businesses, places, geocoding | Google Cloud Console → enable **Places API** → API key (credit-carded but generous free tier) |
| `X_BEARER_TOKEN` | X/Twitter profiles | [developer.x.com](https://developer.x.com) → project → Bearer token |
| `BRANDFETCH_API_KEY` | logos, brand assets | [brandfetch.com/developers](https://brandfetch.com/developers) → free tier |
| `PODCAST_INDEX_API_KEY` + `PODCAST_INDEX_API_SECRET` | podcasts, episodes | [api.podcastindex.org](https://api.podcastindex.org) → free signup |
| `CANOPY_API_KEY` | Amazon product listings | [canopyapi.co](https://www.canopyapi.co) → API key |
| `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` | shared enrichment cache across worker replicas (default is in-memory) | [upstash.com](https://upstash.com) → Redis database → REST credentials |

Reserved for the Search tier (not used by enrichment today):
`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`.

## Verifying a provider works

Set the key in `.env`, restart (`docker compose up -d atom-services workers-enrichment`),
then hand `atom-services` a URL from that domain:

```bash
curl -X POST localhost:4010/v1/process -H 'Content-Type: application/json' \
  -d '{"rawInput":"https://open.spotify.com/track/…"}'
```

The response's `enrichment.artifacts` should include that provider's artifact;
without the key you'd see it under `skipped` instead. For atoms flowing through
the workers, artifacts land in `kg.artifacts` and on the atom's API response.

## Enrichment presets

Workers select a plugin bundle via `WORKERS_DEFAULT_PRESET` (default:
`default`). The default preset covers the keyless web/media/knowledge plugins
plus any keyed plugin whose credentials are present. See
`packages/atom-enrichment/src/presets/` for bundle composition.

## Adding your own source

That's the point — see
[writing-an-enrichment-plugin.md](./writing-an-enrichment-plugin.md) and
[writing-a-classification-plugin.md](./writing-a-classification-plugin.md).
