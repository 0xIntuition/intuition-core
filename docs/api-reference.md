# API reference

Two HTTP services. All examples below are real responses from a running node.

- **Query API** (`:3000`) — the graph you've built: reads open, writes key-gated
- **Atom services** (`:4010`) — stateless classify/enrich, no database

## Authentication

Writes require an API key unless `API_AUTH=open`. Send it as a bearer token:

```
Authorization: Bearer ik_da186a4d…
```

| Failure | Status | Body |
| --- | --- | --- |
| missing key on a write | 401 | `{"error":"api_key_required"}` |
| unknown/revoked key | 401 | `{"error":"invalid_api_key"}` |
| read-only key on a write | 403 | `{"error":"api_key_not_writable"}` |

Mint / manage keys (only the SHA-256 hash is stored):

```bash
cd services/api
bun run keys:create -- --name partner --account 0xWallet [--read-only]
bun run keys:list
bun run keys:revoke -- --id key_…
```

---

## Query API

### `POST /api/atoms` 🔑

Create an atom from any raw input. The ID is `keccak(ATOM_SALT, keccak(bytes))`
— a pure function of the input, identical to the onchain derivation — so the
endpoint is **idempotent**: `201` on first create, `200` with the same ID after.

```bash
curl -X POST localhost:3000/api/atoms \
  -H "Authorization: Bearer ik_…" -H 'Content-Type: application/json' \
  -d '{"input":"https://github.com/oven-sh/bun"}'
```

```json
{
  "data": {
    "id": "0x951d18ba45fdf5ef5c3304ea3ae46a45e00b68464e2b1561cce4b48ffa1c09d3",
    "created": true,
    "createdBy": "0x1111111111111111111111111111111111111111"
  }
}
```

`input` may be a URL, plain string, or JSON (≤ 64 KB). The raw type is detected
automatically; the parse → classify → enrich workers process the atom within
seconds.

Errors: `400 invalid_json` · `400 invalid_input` · `413 input_too_large`.

### `GET /api/atoms`

List atoms (only `active` + `public` records are ever served).

Query params: `limit` (≤ 100, default 25) · `offset` · `classification_type` ·
`q` (substring search over the atom's search text).

```bash
curl "localhost:3000/api/atoms?q=joji&limit=1"
```

```json
{
  "data": [
    {
      "id": "0x49ed8bdcd1954e1de3af8bb5fca0f0377ebe598de5dd82ab5b4a45a82d53a53f",
      "rawType": "string",
      "data": "joji",
      "isOnchain": true,
      "classificationType": "Unknown",
      "parseStatus": "completed",
      "classificationStatus": "completed",
      "enrichmentStatus": "skipped"
    }
  ],
  "pagination": { "limit": 1, "offset": 0, "count": 1 }
}
```

### `GET /api/atoms/:id`

One atom, full row (processing state, results, timestamps). `404 not_found` if
absent or not public.

### `GET /api/atoms/:id/triples`

Every triple touching the atom **in any position** — subject, predicate, or
object — served by the hexastore indexes. Paginated like `GET /api/atoms`.

### `POST /api/triples` 🔑

Create a claim between existing terms. The ID is
`keccak(TRIPLE_SALT, subject, predicate, object)` — idempotent like atoms.

```bash
curl -X POST localhost:3000/api/triples \
  -H "Authorization: Bearer ik_…" -H 'Content-Type: application/json' \
  -d '{
    "subject_id":   "0x951d18ba…",
    "predicate_id": "0x0840db45…",
    "object_id":    "0x49ed8bdc…"
  }'
```

```json
{
  "data": {
    "id": "0x9aaea0e8bbda670c2a1c120dfb4633f974c9ac572ec3e3890331c9e56148e58a",
    "created": true,
    "createdBy": "0x1111111111111111111111111111111111111111"
  }
}
```

Term ids must be 32-byte protocol ids: `400 invalid_term_id` otherwise.

### `GET /api/triples`

Filters: `subject_id` · `predicate_id` · `object_id` (combinable), plus
`limit`/`offset`. `GET /api/triples/:id` fetches one.

### `GET /api/predicates`

The predicate registry — 14 baseline predicates are seeded on first migrate
(`references`, `follows`, `has-tag`, `trusted-in-the-context-of`, …).

### `GET /api/stats`

```json
{ "data": { "atoms": 55, "triples": 1, "accounts": 3, "predicates": 14 } }
```

### `GET /health`

`{"status":"ok"}` — or `503` with `"database":"unreachable"`.

---

## Atom services (stateless)

No database, no auth by default (set `ATOM_SERVICES_AUTH_TOKEN` to gate).
Provider API keys are optional everywhere — plugins without keys degrade
gracefully or skip.

### `POST /v1/classify`

```bash
curl -X POST localhost:4010/v1/classify -H 'Content-Type: application/json' \
  -d '{"input":"https://github.com/vercel/next.js"}'
```

```json
{
  "ok": true,
  "status": "complete",
  "message": "Resolved by github-resolver with 1 candidate atom.",
  "classification": { "type": "url", "domain": "github", "subtype": "repo", "confidence": 0.97 }
}
```

### `POST /v1/process`

Classify **and** enrich in one call. Note the payload key is `rawInput`:

```bash
curl -X POST localhost:4010/v1/process -H 'Content-Type: application/json' \
  -d '{"rawInput":"https://en.wikipedia.org/wiki/Ethereum"}'
```

Returns the classification (`wikipedia/article @ 0.95`) plus enrichment
artifacts — for this URL, five of them with zero API keys: OpenGraph, JSON-LD,
icons, the Wikipedia extract, and the full Wikidata entity (claims, sitelinks,
`instanceOf`). Inapplicable plugins report `skipped`; failing upstreams report
a `retriable` error without failing the run.

### `POST /v1/enrich` · `POST /v1/process/batch`

Enrich-only (same `rawInput` payload), and the batch variant
(`GET /v1/process/batch/:jobId` to poll).

### `GET /health` · `GET /ready` · `GET /metrics`

Liveness, readiness, and Prometheus metrics.
