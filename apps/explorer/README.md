# @0xintuition/explorer

Dashboard-focused data explorer for a self-hosted Intuition Core node — and
the **reference consumer of the public API**. If you're building an app on
Core, start by reading `src/lib/api.ts`: every endpoint the explorer uses is
one small typed function over plain `fetch`.

## What it shows

- **Dashboard** — atom/triple/predicate/account counts, worker-pipeline status
  bars (parse → classify → enrich), live service-health grid, activity feed.
- **Atoms** — searchable table with classification badges and pipeline state;
  detail pages show raw + resolved data, enrichment **artifacts** (with
  extracted images), associated **triples** (position-highlighted), graph
  degree stats, and per-atom events.
- **Triples** — claims rendered as linked subject → predicate → object chips
  with resolved term labels (`?expand=terms`).
- **Predicates · Events · Schema** — the registry, the append-only activity
  log, and the live data model from `GET /api/schema`.
- **Playground** — create atoms and triples through the same API any app would
  use, with the exact `curl` equivalent shown for every request.

## Running

```bash
bun run dev            # http://localhost:3100 (expects the API on :3000)
```

Or as part of the whole native stack: `bun run dev:local` from the repo root
(Process Compose starts the explorer alongside datastores, API, and workers).

Configuration:

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_URL` | `http://localhost:3000` | Core query API to explore |
| `EXPLORER_INDEXING_ENABLED` | `false` | include the optional indexer and projections in the default health sweep |
| `EXPLORER_STATUS_TARGETS` | local dev ports | `name=url,…` health probes for the dashboard grid |

The service-health grid is probed **server-side** (TanStack Start server
route at `/api/status`), so worker health ports need no CORS.

## Stack

TanStack Start (file-based routes, SSR) · TanStack Query + Table ·
Tailwind v4 · zod-validated REST client. Self-contained by design — no
private workspace packages, so it stays an honest template for external
developers.

## Railway

Use `docker/Dockerfile.explorer` with the repository root as the build context.
The container builds Explore on Railway and runs its production Nitro server
on `PORT` (default `3000`), listening on `::` for public and private networking.
Set `VITE_API_URL` to the Core API's **public HTTPS URL before building**; Vite
embeds it in the browser bundle. Set `EXPLORER_STATUS_TARGETS` at runtime to
probe the other services over their private Railway addresses, for example:

```text
api=http://api.railway.internal:3000/health,atom-services=http://atom-services.railway.internal:4010/ready,worker-parse=http://worker-parse.railway.internal:4110/readyz,worker-classification=http://worker-classification.railway.internal:4112/readyz,worker-enrichment=http://worker-enrichment.railway.internal:4111/readyz
```

The Core API uses `docker/Dockerfile.api`, `API_PORT=3000`, a private
`DATABASE_KG_URL`, and `bun /repo/packages/database-kg/src/migrate.ts` as its
pre-deploy command. Keep `API_AUTH=public-read`, allow Explore's HTTPS origin
in `API_ALLOWED_ORIGINS`, and mint a write key for the Playground. Each worker
uses `docker/Dockerfile.workers` with the Railway start command
`bun src/index.ts kg-parse-worker` (or `kg-classification-worker` /
`kg-enrichment-worker`), the same `DATABASE_KG_URL`, and its own health port.
Use `/readyz` for worker deployment health checks, `/health` for the API,
`/ready` for atom-services, and `/` for Explore.

The KG needs persistent PostgreSQL storage. The Timescale PostgreSQL image
also enables the KG event hypertable. No database, Redis, workers, or Docker
containers need to run on your laptop to use the hosted app. The minimal tier
supports API/Playground writes; chain indexing additionally needs an
RPC/deployment, an event-store database, Redis, indexer, and projections.

Deploy source from the repo root with explicit project/environment/service
selectors. `railway up` uploads source and builds remotely; it does not create
a GitHub auto-deploy connection:

```bash
railway up --project <project-id> --environment <environment-id> --service explorer --detach
railway service list --project <project-id> --environment <environment-id> --json
```

An upload returning successfully does not establish that the service is ready;
wait for the submitted deployment to reach `SUCCESS`, then check
`/api/status` and the API's `/health`.
