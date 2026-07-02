# Troubleshooting

Failure modes we have actually hit, with fixes.

## `invalid value for parameter "TimeZone": "UTC"` from Postgres

**Symptom:** the Rust services (sqlx sets `TimeZone=UTC` at connect) fail
instantly; the TypeScript stack works fine against the same database.
`SELECT count(*) FROM pg_timezone_names` returns a few dozen instead of ~1,200.

**Cause:** a corrupted Docker image layer — if the disk fills up while Docker
extracts the `timescaledb-ha` image, the zoneinfo files can end up **zero-filled
at the right size** (`head -c4 /usr/share/zoneinfo/Etc/UTC` shows `\0\0\0\0`
instead of `TZif`). Docker caches the corrupt layer, so restarts don't help.

**Fix:** free disk space, then force re-extraction:

```bash
docker compose down            # volumes survive
docker rmi timescale/timescaledb-ha:pg17
docker pull timescale/timescaledb-ha:pg17
docker compose up -d
```

## Indexer panics: `CHAIN_ID environment variable must be set`

The generated rindexer typings read `CHAIN_ID` (and the other `MULTIVAULT_*`
variables) from the **runtime environment**, not only from the rendered
manifest. Ensure they're set on the indexer process/container, not just used
at template-render time. `docker compose --profile indexing up` wires this
automatically from `.env`.

## Nothing indexed / `event_store` stays empty

- Check the chain window actually contains events: the contract's deployment
  block is the natural `MULTIVAULT_START_BLOCK`.
- `curl localhost:9091/metrics` — the indexer exports per-event-type progress.
- With `MULTIVAULT_END_BLOCK` set, the indexer finishes the range and exits —
  that's the designed behavior for bounded test runs, not a crash.

## Writes return 401 `api_key_required`

The API defaults to `API_AUTH=public-read`: reads are open, writes need a key.
Mint one (`bun run keys:create -- --name me --account 0x…`) or set
`API_AUTH=open` for local development.

## Port already in use (3000 / 4010 / 4110)

Another process owns the port (commonly a dev server). Override with
`API_PORT` / `ATOM_SERVICES_PORT` / `WORKERS_PORT`, or stop the other process.

## Docker Desktop crashed mid-run (macOS)

All containers show `Exited (255)` simultaneously. Data volumes survive.
Restart Docker Desktop, then `docker compose up -d` — the migrate jobs are
idempotent and the projection checkpoints resume where they left off.

## Enrichment says `skipped`

Correct behavior for atoms with nothing to enrich (e.g. plain-string atoms).
Enrichment produces artifacts for URL-backed atoms; provider plugins without
API keys skip with `not_applicable`/degrade rather than fail.
