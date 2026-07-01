# `@0xintuition/database-timescale`

Typed Drizzle package for the backend Timescale/Postgres projection database.

This package gives the app a typed way to query backend projection tables and supported Timescale relations while keeping `backend/migrations/*.sql` as the upstream schema source of truth.

## What This Package Contains

- Generated Timescale Drizzle schema under `src/schemas/timescale`
- Stable `./schema` wrappers for all currently supported Timescale hypertables and materialized views
- Stable `./actions` helpers for live Timescale access and typed aggregate query helpers
- Generator modules that read backend migration SQL
- Verification and smoke-test scripts for local and remote databases
- Compatibility inventory plus supported-relation metadata for Timescale features that are not fully generated in Drizzle

## Source Of Truth

- Backend schema source: `backend/migrations/*.sql`
- Generated consumer artifact: `packages/database-timescale/src/schemas/timescale/*`

Do not hand-edit the generated schema files.

## Environment

Required:

```bash
DATABASE_TIMESCALE_URL="postgres://user:password@host:5432/blockchain_events"
```

These commands assume your shell already has `DATABASE_TIMESCALE_URL` loaded.

In a worktree, run `direnv allow` once at the worktree root and use a shell where `direnv` has loaded the shared `.env`.

## Main Exports

```ts
import * as timescaleSchema from '@0xintuition/database-timescale/schema';
import {
	createEnvTimescaleConnection,
	listPositionChangeRows,
	listSharePriceStatsHourlyRows,
} from '@0xintuition/database-timescale/actions';
```

Stable entrypoints:

- `@0xintuition/database-timescale/schema`
- `@0xintuition/database-timescale/actions`

Compatibility entrypoints kept during rollout:

- `@0xintuition/database-timescale`
- `@0xintuition/database-timescale/client`
- `@0xintuition/database-timescale/client-env`

## Usage

### Query generated base tables

```ts
import { createTimescaleConnection } from '@0xintuition/database-timescale';

const connection = createTimescaleConnection({
	connectionString: process.env.DATABASE_TIMESCALE_URL!,
});

const latestVault = await connection.db.query.vault.findFirst({
	orderBy: (table, operators) => [operators.desc(table.updatedAt)],
});

await connection.close();
```

### Query supported wrappers from `./actions`

```ts
import {
	createEnvTimescaleConnection,
	listPositionChangeRows,
	listSharePriceStatsHourlyRows,
} from '@0xintuition/database-timescale/actions';

const connection = createEnvTimescaleConnection();

const [positionChanges, sharePriceStats] = await Promise.all([
	listPositionChangeRows(connection.db, {
		accountId: '0xabc',
		limit: 50,
	}),
	listSharePriceStatsHourlyRows(connection.db, {
		curveId: '1',
		limit: 24,
		termId: '123',
	}),
]);

await connection.close();
```

### Supported V0 non-table relations

Supported hypertables:

- `account_pnl_snapshot`
- `deposited_events`
- `event_store`
- `position_change`
- `position_cumulative_hourly`
- `redeemed_events`
- `share_price_changed_events`
- `share_price_history`
- `signal`
- `stats_history`
- `term_market_cap_history`

Supported materialized views:

- `position_change_daily`
- `position_change_hourly`
- `share_price_stats_daily`
- `share_price_stats_hourly`
- `signal_daily`
- `signal_hourly`

### Generate the schema from backend migrations

```bash
cd packages/database-timescale
bun run db:generate-timescale
```

### Verify the checked-in generated files are current

```bash
cd packages/database-timescale
bun run db:check-generated-timescale
```

### Verify the generated manifest matches a live database

```bash
cd packages/database-timescale
bun run db:verify-timescale
```

### Run a live smoke query

```bash
cd packages/database-timescale
bun run db:smoke-timescale
```

### Run the full validation flow

```bash
cd packages/database-timescale
bun run db:validate-timescale
```

This runs:

1. parser regression tests
2. supported-wrapper type checks
3. schema generation
4. generated-file parity verification
5. live schema verification for base tables and all supported materialized views
6. smoke queries for base tables, supported hypertables, and supported materialized views
7. negative drift verification

## Local Development

From the repo root:

```bash
./scripts/timescale-local-up.sh --reset-volume
```

Then:

```bash
cd packages/database-timescale
bun run db:validate-timescale
```

Tear down the local Timescale service with:

```bash
./scripts/timescale-local-down.sh
```

## Limitations

All currently known live hypertables and materialized views are first-class in this package. Standard SQL views, stored functions, jobs, custom types, and any newly introduced Timescale relations still require explicit classification before they become supported. See [TIMESCALE_COMPAT.md](./TIMESCALE_COMPAT.md).
