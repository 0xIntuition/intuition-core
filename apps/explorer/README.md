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
| `EXPLORER_STATUS_TARGETS` | local dev ports | `name=url,…` health probes for the dashboard grid |

The service-health grid is probed **server-side** (TanStack Start server
route at `/api/status`), so worker health ports need no CORS.

## Stack

TanStack Start (file-based routes, SSR) · TanStack Query + Table ·
Tailwind v4 · zod-validated REST client. Self-contained by design — no
private workspace packages, so it stays an honest template for external
developers.
