import { afterAll, describe, expect, it } from 'bun:test';
import postgres from 'postgres';
import { verifyTimescaleSchema } from '../src/timescale-verification';

if (!process.env.DATABASE_TIMESCALE_URL) {
	throw new Error('Missing DATABASE_TIMESCALE_URL');
}

const sql = postgres(process.env.DATABASE_TIMESCALE_URL, {
	max: 1,
	prepare: false,
});

describe('verifyTimescaleSchema', () => {
	it('reports schema drift when a required column is missing', async () => {
		await sql`BEGIN`;

		try {
			await sql`ALTER TABLE vault RENAME COLUMN curve_id TO curve_id_verify_negative`;

			const mismatches = await verifyTimescaleSchema(sql);

			expect(mismatches).toContain('Missing column vault.curve_id');
			expect(mismatches).toContain('Unexpected column vault.curve_id_verify_negative');
		} finally {
			await sql`ROLLBACK`;
		}
	}, 30_000);
});

afterAll(async () => {
	await sql.end({ timeout: 1 });
});
