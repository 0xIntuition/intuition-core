import { afterAll, describe, expect, it } from 'bun:test';
import {
	createEnvTimescaleConnection,
	listPositionChangeRows,
	listSharePriceStatsHourlyRows,
} from '../src/actions';

const connection = createEnvTimescaleConnection();

describe('supported Timescale relations end to end', () => {
	it('queries the position_change hypertable through the action helper and respects filters', async () => {
		const rows = await listPositionChangeRows(connection.db, { limit: 5 });

		expect(rows.length).toBeGreaterThan(0);

		const firstRow = rows[0];
		expect(typeof firstRow.eventId).toBe('string');
		expect(typeof firstRow.accountId).toBe('string');
		expect(firstRow.ts).toBeInstanceOf(Date);

		const filteredRows = await listPositionChangeRows(connection.db, {
			accountId: firstRow.accountId,
			curveId: firstRow.curveId,
			limit: 5,
			termId: firstRow.termId,
		});

		expect(filteredRows.length).toBeGreaterThan(0);
		for (const row of filteredRows) {
			expect(row.accountId).toBe(firstRow.accountId);
			expect(row.termId).toBe(firstRow.termId);
			expect(row.curveId).toBe(firstRow.curveId);
		}
	}, 30_000);

	it('queries the share_price_stats_hourly materialized view through the action helper and respects filters', async () => {
		const rows = await listSharePriceStatsHourlyRows(connection.db, { limit: 5 });

		expect(rows.length).toBeGreaterThan(0);

		const firstRow = rows[0];
		expect(firstRow.bucket).toBeInstanceOf(Date);
		expect(typeof firstRow.termId).toBe('string');
		expect(typeof firstRow.curveId).toBe('string');
		expect(typeof firstRow.closePrice).toBe('string');

		const filteredRows = await listSharePriceStatsHourlyRows(connection.db, {
			curveId: firstRow.curveId ?? undefined,
			limit: 5,
			termId: firstRow.termId ?? undefined,
		});

		expect(filteredRows.length).toBeGreaterThan(0);
		for (const row of filteredRows) {
			expect(row.termId).toBe(firstRow.termId);
			expect(row.curveId).toBe(firstRow.curveId);
		}
	}, 30_000);
});

afterAll(async () => {
	await connection.close();
});
