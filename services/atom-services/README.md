# Atom Services

Unified backend service for atom classification and atom enrichment.

## Endpoints

- `GET /health`
- `GET /ready`
- `GET /metrics`
- `POST /v1/classify`
- `POST /v1/enrich`
- `POST /v1/process`
- `POST /v1/process/batch`
- `GET /v1/process/batch/:jobId`

## Run

```bash
bun run dev
```

## Environment

Canonical runtime variables use the `ATOM_SERVICES_*` prefix.
The service also supports legacy `ENRICHMENT_*` names as a fallback during migration.

For web/tRPC proxying into this service, configure:

- `ATOM_PROCESSING_SERVICE_URL`
- `ATOM_PROCESSING_SERVICE_AUTH_TOKEN`
- `ATOM_PROCESSING_SERVICE_TIMEOUT_MS`

Optional Spotify enrichment (for track, album, artist, playlist, podcast show, and podcast episode metadata; preview audio URLs are included where Spotify exposes them):

- `SPOTIFY_CLIENT_ID`
- `SPOTIFY_CLIENT_SECRET`
- `SPOTIFY_MARKET` (optional, e.g. `US`)

Caching:

- `ATOM_SERVICES_CACHE_PROVIDER` = `memory` | `none` | `upstash`
- `ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES` (used by enrichment memory cache)
- `ATOM_SERVICES_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES` (optional override for classification memory cache)
- `ATOM_SERVICES_CLASSIFICATION_RESOLVER_CACHE_TTL_MS` (default: `300000`)
- `ATOM_SERVICES_CACHE_HTTP_TIMEOUT_MS` (default: `1500`, Upstash REST calls)
- `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN` (required when provider is `upstash`)

Suggested `.env` values:

```bash
# Upstash Redis REST timeout in milliseconds.
# Applies to both classification and enrichment cache adapters.
ATOM_SERVICES_CACHE_HTTP_TIMEOUT_MS=1500

# TTL (ms) for classification resolver outputs in cache.
# 300000 ms = 5 minutes.
ATOM_SERVICES_CLASSIFICATION_RESOLVER_CACHE_TTL_MS=300000

# Max in-memory entries for enrichment cache when provider=memory
# (or when upstash is requested but unavailable and runtime falls back to memory).
ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES=500

# Max in-memory entries for classification cache when provider=memory.
# If omitted, it defaults to ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES.
ATOM_SERVICES_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES=500
```
