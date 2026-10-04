import { describe, expect, spyOn, test } from 'bun:test';

import type { KgActionDb } from '@0xintuition/database-kg/actions';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';

import {
	parseIdentifierBackfillOptions,
	parseIidReconciliationOptions,
	runKgCommand,
} from './index';

describe('IID reconciliation command options', () => {
	test('is a bounded dry run by default', () => {
		expect(parseIidReconciliationOptions([])).toEqual({
			limit: 100,
			after: undefined,
			confirmed: false,
			force: false,
			parseVersion: 'unknown',
			registryVersion: 'unknown',
			resolverVersion: 'unknown',
		});
	});

	test('records resume and package provenance for an applied batch', () => {
		expect(
			parseIidReconciliationOptions([
				'--yes',
				'--force',
				'--limit=25',
				'--after=0xabc',
				'--parse-version=@0xintuition/iid@0.1.0-alpha.0',
				'--registry-version=@0xintuition/iid-registry@0.1.0-alpha.0',
				'--resolver-version=core-provider-adapter@1',
			])
		).toEqual({
			limit: 25,
			after: '0xabc',
			confirmed: true,
			force: true,
			parseVersion: '@0xintuition/iid@0.1.0-alpha.0',
			registryVersion: '@0xintuition/iid-registry@0.1.0-alpha.0',
			resolverVersion: 'core-provider-adapter@1',
		});
	});

	test('rejects unbounded or empty options', () => {
		expect(() => parseIidReconciliationOptions(['--limit=1001'])).toThrow('<= 1000');
		expect(() => parseIidReconciliationOptions(['--after='])).toThrow('non-empty');
	});
});

describe('identifier backfill command', () => {
	test('defaults to bounded dry run and supports inline or separate keyset flags', () => {
		expect(parseIdentifierBackfillOptions([])).toEqual({
			limit: 100,
			after: undefined,
			confirmed: false,
		});
		expect(
			parseIdentifierBackfillOptions(['--yes', '--limit', '1000', '--after', 'node-a'])
		).toEqual({ limit: 1000, after: 'node-a', confirmed: true });
		expect(parseIdentifierBackfillOptions(['--limit=25', '--after=node-b'])).toEqual({
			limit: 25,
			after: 'node-b',
			confirmed: false,
		});
		for (const args of [
			['--limit=1001'],
			['--limit=1.5'],
			['--limit=2x'],
			['--limit=0'],
			['--after='],
			['--after'],
			['--after', '--yes'],
			['--force'],
		])
			expect(() => parseIdentifierBackfillOptions(args)).toThrow();
	});

	test('dry run and apply read bounded pages within timed transactions; only apply locks and writes', async () => {
		for (const apply of [false, true]) {
			const events: string[] = [];
			const batches: unknown[][] = [];
			let bound: number | undefined;
			let predicate: SQL | undefined;
			const rows = [
				{
					id: 'node-b',
					iid: 'int:isbn:primary',
					classificationResult: {
						identityRungs: {
							rungs: [{ rung: 'gtin', value: '123', iid: 'int:gtin:123', aliasOnly: true }],
							provenance: { producer: 'fixture', version: '1' },
						},
					},
				},
				{ id: 'node-c', iid: null, classificationResult: {} },
			];
			const tx = {
				async execute(statement: SQL) {
					events.push(new PgDialect().sqlToQuery(statement).sql);
				},
				select(columns: Record<string, unknown>) {
					const ownership = !('classificationResult' in columns);
					const query = {
						from: () => query,
						where(value: SQL) {
							if (!ownership) predicate = value;
							return query;
						},
						orderBy: () => query,
						limit(value: number) {
							bound = value;
							return query;
						},
						for(strength: string) {
							events.push(`lock:${strength}`);
							return query;
						},
						// biome-ignore lint/suspicious/noThenProperty: emulate Drizzle lazy thenable query execution.
						then(resolve: (value: typeof rows) => unknown) {
							if (ownership) return Promise.resolve(resolve([]));
							events.push('select');
							return Promise.resolve(resolve(rows));
						},
					};
					return query;
				},
				insert() {
					return {
						values(value: unknown[]) {
							batches.push(value);
							return {
								async onConflictDoNothing() {
									events.push('insert');
								},
							};
						},
					};
				},
			} as unknown as KgActionDb;
			const db = {
				...tx,
				async transaction<T>(run: (tx: KgActionDb) => Promise<T>) {
					events.push('begin');
					const value = await run(tx);
					events.push('commit');
					return value;
				},
			} as unknown as KgActionDb;
			const log = spyOn(console, 'log').mockImplementation(() => {});
			try {
				await runKgCommand(db, [
					'kg-backfill-identifiers',
					'--limit=2',
					'--after=node-a',
					...(apply ? ['--yes'] : []),
				]);
				expect(events).toEqual(
					apply
						? [
								'begin',
								"SET LOCAL lock_timeout = '5s'",
								"SET LOCAL statement_timeout = '30s'",
								'lock:no key update',
								'select',
								'insert',
								'commit',
							]
						: [
								'begin',
								"SET LOCAL lock_timeout = '5s'",
								"SET LOCAL statement_timeout = '30s'",
								'select',
								'commit',
							]
				);
				expect(bound).toBe(2);
				expect(new PgDialect().sqlToQuery(predicate!).params).toEqual(['node-a']);
				expect(batches).toHaveLength(apply ? 1 : 0);
				expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({
					command: 'kg-backfill-identifiers',
					mode: apply ? 'apply' : 'dry-run',
					count: 2,
					aliases: 1,
					nextAfter: 'node-c',
				});
			} finally {
				log.mockRestore();
			}
		}
	});
});

test.each([
	'int:wd:B',
	null,
])('backfill excludes another nodes primary for recipient %s in both modes', async (primaryIid) => {
	for (const apply of [false, true]) {
		const batches: unknown[][] = [];
		const ownershipQueries: { sql: string; params: unknown[] }[] = [];
		const candidates = [
			{
				id: 'B',
				iid: primaryIid,
				classificationResult: {
					identityRungs: {
						rungs: [{ rung: 'isbn', value: 'X', iid: 'int:isbn:X', aliasOnly: false }],
						provenance: { producer: 'fixture', version: '1' },
					},
				},
			},
		];
		const tx = {
			async execute() {},
			select(columns: Record<string, unknown>) {
				const ownership = !('classificationResult' in columns);
				let predicate: SQL;
				const query = {
					from: () => query,
					where(value: SQL) {
						predicate = value;
						return query;
					},
					orderBy: () => query,
					limit: () => query,
					for: () => query,
					// biome-ignore lint/suspicious/noThenProperty: emulate Drizzle page and ownership reads.
					then(resolve: (value: unknown[]) => unknown) {
						if (ownership) ownershipQueries.push(new PgDialect().sqlToQuery(predicate));
						return Promise.resolve(
							resolve(ownership ? [{ id: 'A', iid: 'int:isbn:X' }] : candidates)
						);
					},
				};
				return query;
			},
			insert() {
				return {
					values(rows: unknown[]) {
						return {
							async onConflictDoNothing() {
								batches.push(rows);
							},
						};
					},
				};
			},
		} as unknown as KgActionDb;
		const db = {
			...tx,
			async transaction<T>(run: (tx: KgActionDb) => Promise<T>) {
				return run(tx);
			},
		} as unknown as KgActionDb;
		const log = spyOn(console, 'log').mockImplementation(() => {});
		try {
			await runKgCommand(db, ['kg-backfill-identifiers', '--limit=1', ...(apply ? ['--yes'] : [])]);
			expect(JSON.parse(log.mock.calls[0]![0] as string)).toMatchObject({
				count: 1,
				aliases: 0,
				nextAfter: 'B',
			});
			expect(batches).toEqual([]);
			expect(ownershipQueries).toHaveLength(1);
			expect(ownershipQueries[0]!.params).toEqual(['int:isbn:X']);
			expect(ownershipQueries[0]!.sql).not.toContain('status');
		} finally {
			log.mockRestore();
		}
	}
});
