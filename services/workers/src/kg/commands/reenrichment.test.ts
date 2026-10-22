import { expect, spyOn, test } from 'bun:test';
import type { KgActionDb } from '@0xintuition/database-kg/actions';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { runKgCommand } from './index';
import { parseReenrichmentOptions, REENRICHMENT_RUNG_PLUGINS } from './reenrichment';

const ids = [1, 2, 3, 4].map((id) => `0x${id.toString(16).padStart(64, '0')}`);
function fixture(failUpdate = 0, failRead = 0) {
	const reads: { sql: string; params: unknown[] }[] = [];
	const updates: { patch: Record<string, unknown>; query: { sql: string; params: unknown[] } }[] =
		[];
	let active: string[] = [];
	const db = {
		async execute(statement: SQL) {
			const query = new PgDialect().sqlToQuery(statement);
			reads.push(query);
			if (reads.length === failRead) throw new Error('synthetic read failure');
			const cursor = query.sql.includes('n.id >') ? (query.params.at(-2) as string) : '';
			active = ids.filter((id) => id > cursor).slice(0, Number(query.params.at(-1)));
			return active.map((id) => ({ id }));
		},
		update() {
			return {
				set(patch: Record<string, unknown>) {
					return {
						where(statement: SQL) {
							updates.push({ patch, query: new PgDialect().sqlToQuery(statement) });
							return {
								async returning() {
									if (updates.length === failUpdate) throw new Error('synthetic reset failure');
									const chosen = updates
										.at(-1)!
										.query.params.filter(
											(value): value is string => typeof value === 'string' && ids.includes(value)
										);
									return chosen.map((id) => ({ id }));
								},
							};
						},
					};
				},
			};
		},
	} as unknown as KgActionDb;
	return { db, reads, updates };
}

test('reenrichment dry run prints bounded candidates and resets nothing', async () => {
	const f = fixture();
	const log = spyOn(console, 'log').mockImplementation(() => {});
	try {
		await runKgCommand(f.db, [
			'kg-reenrich-missing-provider',
			'--plugin',
			'spotify',
			'--batch-size=2',
			'--limit=3',
		]);
		expect(f.updates).toHaveLength(0);
		expect(f.reads.map((q) => q.params.at(-1))).toEqual([3, 2]);
		expect(log.mock.calls.map(([line]) => JSON.parse(line as string).count)).toEqual([2, 1]);
		expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({
			mode: 'dry-run',
			sampleIds: ids.slice(0, 2),
			reset: 0,
		});
	} finally {
		log.mockRestore();
	}
});

test('reenrichment confirm uses completed-only reset action with command reason and stops at limit', async () => {
	const f = fixture();
	const log = spyOn(console, 'log').mockImplementation(() => {});
	try {
		await runKgCommand(f.db, [
			'kg-reenrich-missing-provider',
			'--plugin=tmdb',
			'--batch-size=2',
			'--limit=3',
			'--confirm',
		]);
		expect(f.updates).toHaveLength(2);
		expect(
			f.updates.flatMap((entry) => entry.query.params.filter((v) => ids.includes(v as string)))
		).toEqual(ids.slice(0, 3));
		for (const entry of f.updates) {
			expect(entry.patch).toMatchObject({ enrichmentStatus: 'pending', enrichmentAttempts: 0 });
			expect(entry.query.params[0]).toBe('completed');
			const meta = new PgDialect().sqlToQuery(entry.patch.processingMeta as SQL);
			expect(JSON.parse(meta.params[0] as string).enrichmentResetReason).toBe(
				'kg-reenrich-missing-provider:tmdb'
			);
		}
		expect(log.mock.calls.map(([line]) => JSON.parse(line as string).reset)).toEqual([2, 1]);
	} finally {
		log.mockRestore();
	}
});

for (const fail of ['read', 'reset'])
	test(`reenrichment ${fail} error prints last committed cursor for resume`, async () => {
		const f = fixture(fail === 'reset' ? 2 : 0, fail === 'read' ? 2 : 0);
		const log = spyOn(console, 'log').mockImplementation(() => {});
		const error = spyOn(console, 'error').mockImplementation(() => {});
		try {
			await expect(
				runKgCommand(f.db, [
					'kg-reenrich-missing-provider',
					'--plugin=spotify',
					'--batch-size=2',
					'--confirm',
				])
			).rejects.toThrow();
			expect(JSON.parse(error.mock.calls[0]![0] as string)).toMatchObject({
				cursor: ids[1],
				lastResetId: ids[1],
				totalReset: 2,
			});
		} finally {
			log.mockRestore();
			error.mockRestore();
		}
	});

test('reenrichment parsing validates plugins, mapped rungs, strict bounds, dates and cursor', () => {
	expect(parseReenrichmentOptions(['--plugin=spotify']).rungs).toEqual(
		Object.entries(REENRICHMENT_RUNG_PLUGINS)
			.filter(([, p]) => p === 'spotify')
			.map(([r]) => r)
	);
	expect(
		parseReenrichmentOptions([
			'--plugin=tmdb',
			'--rungs',
			'tmdb:tv',
			'--created-since',
			'2026-10-01T00:00:00Z',
			'--cursor',
			ids[0]!,
		])
	).toMatchObject({ confirmed: false, rungs: ['tmdb:tv'], cursor: ids[0] });
	for (const args of [
		[],
		['--plugin=BAD'],
		['--plugin=unknown'],
		['--plugin=spotify', '--rungs=tmdb:tv'],
		['--plugin=spotify', '--rungs=apple-podcasts'],
		['--plugin=spotify', '--rungs='],
		['--plugin=spotify', '--batch-size=5001'],
		['--plugin=spotify', '--batch-size=0'],
		['--plugin=spotify', '--batch-size=2x'],
		['--plugin=spotify', '--limit=0'],
		['--plugin=spotify', '--limit=1.5'],
		['--plugin=spotify', '--created-since=bad'],
		['--plugin=spotify', '--created-since=2026-02-30T00:00:00Z'],
		['--plugin=spotify', '--cursor='],
		['--plugin=spotify', '--unknown'],
		['--plugin', '--confirm'],
	])
		expect(() => parseReenrichmentOptions(args)).toThrow();
	expect(Object.keys(REENRICHMENT_RUNG_PLUGINS)).not.toContain('apple-podcasts');
	expect(Object.keys(REENRICHMENT_RUNG_PLUGINS)).not.toContain('podcast-index');
});
