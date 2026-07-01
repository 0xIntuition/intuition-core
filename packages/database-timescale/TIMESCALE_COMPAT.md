# Timescale Compatibility Notes

This package generates Drizzle table definitions for the base Timescale/Postgres tables created by `backend/migrations/*.sql` and layers explicit wrappers for all currently supported Timescale hypertables and materialized views.

## Modeled in Drizzle

- Base tables in `src/schemas/timescale/`
- All current live hypertables as supported schema exports
- All current live materialized views as supported schema exports
- Composite primary keys
- Explicit unique indexes and standard indexes
- TimescaleDB connection client in `@0xintuition/database-timescale`
- Workspace-local materialized-view adapter in `src/drizzle/materialized-view.ts` pinned to `drizzle-orm@0.45.1`

## Deferred Or Unsupported Direct Modeling

- Hypertable metadata and compression policies
- Standard SQL views
- Custom Postgres types
- Stored functions and scheduled Timescale jobs

The generated compatibility inventory lives at `src/schemas/timescale/compat-inventory.json`.

The explicit Timescale relation classification registry lives at `src/timescale-supported-relations.ts`. Validation fails when a new hypertable or materialized view appears in `backend/migrations/*.sql` without being classified there.

## Typed Access Patterns

Prefer the stable package entrypoints:

```ts
import {
	createEnvTimescaleConnection,
	listPositionChangeRows,
	listSharePriceStatsHourlyRows,
} from '@0xintuition/database-timescale/actions';
import {
	position_change,
	share_price_stats_hourly,
} from '@0xintuition/database-timescale/schema';
```

Materialized-view nullability follows Postgres metadata from the live schema. The current live views report columns as nullable through `information_schema`, so the wrapper types intentionally preserve that wider contract.

## Raw SQL Access Patterns

Use `timescaleDb.execute(sql\`...\`)` for unsupported Timescale-only relations and functions.

```ts
await timescaleDb.execute(sql`
  SELECT *
  FROM signal_daily
  WHERE account_id = ${'0xabc'}
  ORDER BY bucket DESC
  LIMIT 30
`);
```

```ts
await timescaleDb.execute(sql`
  SELECT *
  FROM leaderboard_current
  WHERE period = ${'7d'} AND sort_key = ${'total_pnl'}
  ORDER BY rank
  LIMIT 100
`);
```

```ts
await timescaleDb.execute(sql`
  SELECT *
  FROM get_pnl_leaderboard_period(
    ${new Date('2026-01-01T00:00:00Z')},
    ${new Date('2026-01-31T23:59:59Z')},
    100,
    0,
    'total_pnl',
    'DESC',
    TRUE,
    1,
    0,
    NULL,
    0
  )
`);
```

## Local Workflow

```bash
cd packages/database-timescale
bun run db:timescale-up
export DATABASE_TIMESCALE_URL=postgres://indexer:changeme_secure_password@127.0.0.1:55432/blockchain_events
bun run db:generate-timescale
bun run db:verify-timescale
bun run db:smoke-timescale
bun run db:validate-timescale
```

Shut the local database down with:

```bash
cd packages/database-timescale
bun run db:timescale-down
```
