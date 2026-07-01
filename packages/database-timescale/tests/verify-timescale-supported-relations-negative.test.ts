import { afterAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { verifySupportedTimescaleRelations } from '../src/timescale-verification';

// Requires a live TimescaleDB with the schema applied; skipped when unset.
const databaseUrl = process.env.DATABASE_TIMESCALE_URL?.trim();
const describeWithDb = databaseUrl ? describe : describe.skip;

// postgres() connects lazily, so a placeholder URL is never dialed when skipped.
const sql = postgres(databaseUrl ?? 'postgres://skipped/skipped', {
	max: 1,
	prepare: false,
});

describeWithDb('verifySupportedTimescaleRelations', () => {
	it('reports schema drift when a supported materialized view column changes', async () => {
		await sql`BEGIN`;

		try {
			await sql`ALTER MATERIALIZED VIEW share_price_stats_hourly RENAME COLUMN market_cap TO market_cap_verify_negative`;

			const mismatches = await verifySupportedTimescaleRelations(sql);

			expect(mismatches).toContain('Missing column share_price_stats_hourly.market_cap');
			expect(mismatches).toContain(
				'Unexpected column share_price_stats_hourly.market_cap_verify_negative'
			);
		} finally {
			await sql`ROLLBACK`;
		}
	}, 30_000);
});

afterAll(async () => {
	await sql.end({ timeout: 1 });
});
