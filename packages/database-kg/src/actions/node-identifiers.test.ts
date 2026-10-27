import { expect, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { listPublicNodesByIid } from './nodes';
import type { KgActionDb } from './types';

const projection = {
	primary: { rung: 'isbn', iid: 'int:isbn:primary' },
	rungs: [
		{ rung: 'isbn', value: 'primary', iid: 'int:isbn:primary', aliasOnly: false },
		{ rung: 'wd', value: 'Q42', iid: 'int:wd:Q42', aliasOnly: false },
		{ rung: 'gtin', value: '123', iid: 'int:gtin:123', aliasOnly: true },
		{ rung: 'isbn', value: 'other', iid: 'int:isbn:other', aliasOnly: false },
		{ rung: 'wd', value: 'Q42', iid: 'int:wd:Q42', aliasOnly: false },
		{ rung: 'url', value: 'opaque', aliasOnly: true },
	],
	provenance: { producer: 'fixture', version: '1' },
};

test('projects supplied IIDs including alias-only, excludes primary scheme and deduplicates', async () => {
	const { projectNodeIdentifiers } = await import('./node-identifiers');
	expect(projectNodeIdentifiers('node', projection, 'int:isbn:primary')).toEqual([
		{ nodeId: 'node', iid: 'int:wd:Q42', scheme: 'wd', rung: 'wd', source: 'rung' },
		{ nodeId: 'node', iid: 'int:gtin:123', scheme: 'gtin', rung: 'gtin', source: 'rung' },
	]);
	expect(projectNodeIdentifiers('node', undefined, null)).toEqual([]);
	expect(projectNodeIdentifiers('node', projection, null)).toHaveLength(4);
});

test('caps retained identifiers at 32 and never derives missing IIDs', async () => {
	const { projectNodeIdentifiers, IDENTIFIER_RUNG_MAX_ITEMS } = await import('./node-identifiers');
	expect(IDENTIFIER_RUNG_MAX_ITEMS).toBe(32);
	const rungs = Array.from({ length: 40 }, (_, i) => ({
		rung: 'opaque',
		value: String(i),
		iid: `int:opaque:${i}`,
		aliasOnly: true,
	}));
	const rows = projectNodeIdentifiers('node', { ...projection, rungs }, null);
	expect(rows).toHaveLength(32);
	expect(rows.at(-1)?.iid).toBe('int:opaque:31');
});

test('batch upsert respects five-bind budget and conflicts on node plus IID', async () => {
	const { projectNodeIdentifiers, upsertNodeIdentifierRows } = await import('./node-identifiers');
	const batches: number[] = [];
	const columns: string[][] = [];
	const targets: string[][] = [];
	const db = {
		insert() {
			return {
				values(rows: unknown[]) {
					batches.push(rows.length);
					columns.push(Object.keys(rows[0] as object));
					return {
						async onConflictDoNothing(input: { target: { name: string }[] }) {
							targets.push(input.target.map((c) => c.name));
						},
					};
				},
			};
		},
	} as unknown as KgActionDb;
	const row = projectNodeIdentifiers('node', projection, 'int:isbn:primary')[0]!;
	await upsertNodeIdentifierRows(
		db,
		Array.from({ length: 13108 }, (_, i) => ({ ...row, nodeId: String(i), createdAt: new Date(0) }))
	);
	expect(batches).toEqual([13107, 1]);
	expect(columns).toEqual([
		['nodeId', 'iid', 'scheme', 'rung', 'source'],
		['nodeId', 'iid', 'scheme', 'rung', 'source'],
	]);
	expect(targets).toEqual([
		['node_id', 'iid'],
		['node_id', 'iid'],
	]);
	await upsertNodeIdentifierRows(db, []);
	expect(batches).toHaveLength(2);
});

test('reconciles disappearance and empty projections inside the supplied handle', async () => {
	const { reconcileNodeIdentifiers } = await import('./node-identifiers');
	const events: string[] = [];
	const predicates: SQL[] = [];
	const inserted: unknown[] = [];
	const db = {
		select() {
			return { from: () => ({ where: async () => [] }) };
		},
		delete() {
			return {
				async where(where: SQL) {
					events.push('delete');
					predicates.push(where);
				},
			};
		},
		insert() {
			return {
				values(rows: unknown[]) {
					inserted.push(...rows);
					return {
						async onConflictDoNothing() {
							events.push('insert');
						},
					};
				},
			};
		},
	} as unknown as KgActionDb;
	await reconcileNodeIdentifiers(
		db,
		'node',
		{ ...projection, rungs: [projection.rungs[1]!] },
		'int:isbn:primary'
	);
	const query = new PgDialect().sqlToQuery(predicates[0]!);
	expect(query.sql).toContain('not in');
	expect(query.params).toEqual(['node', 'rung', 'int:wd:Q42']);
	expect(events).toEqual(['delete', 'insert']);
	expect(inserted).toHaveLength(1);
	await reconcileNodeIdentifiers(db, 'node', { ...projection, rungs: [] }, null);
	expect(new PgDialect().sqlToQuery(predicates[1]!).params).toEqual(['node', 'rung']);
	expect(events).toEqual(['delete', 'insert', 'delete']);
});

test.each([
	'int:wd:B',
	null,
])('reconcile rejects other nodes primary IIDs for recipient primary %s', async (primaryIid) => {
	const { reconcileNodeIdentifiers } = await import('./node-identifiers');
	for (const ownerStatus of ['active', 'draft']) {
		const owners = [
			{ id: 'A', iid: 'int:isbn:X', status: ownerStatus, visibility: 'public' },
			{ id: 'B', iid: primaryIid, status: 'active', visibility: 'public' },
		];
		let aliases = [{ nodeId: 'B', iid: 'int:isbn:X' }];
		const ownershipQueries: { sql: string; params: unknown[] }[] = [];
		const db = {
			select(columns: Record<string, unknown>) {
				let predicate: SQL;
				const query = {
					from: () => query,
					where(value: SQL) {
						predicate = value;
						return query;
					},
					orderBy: () => query,
					limit: () => query,
					offset: () => query,
					async execute() {
						const compiled = new PgDialect().sqlToQuery(predicate);
						expect(compiled.sql).toContain('union select');
						const [iid, , status, visibility] = compiled.params;
						return owners.filter(
							(node) =>
								node.status === status &&
								node.visibility === visibility &&
								(node.iid === iid ||
									aliases.some((row) => row.nodeId === node.id && row.iid === iid))
						);
					},
					// biome-ignore lint/suspicious/noThenProperty: emulate Drizzle ownership query execution.
					then(resolve: (value: typeof owners) => unknown) {
						expect(Object.keys(columns)).toEqual(['id', 'iid']);
						const compiled = new PgDialect().sqlToQuery(predicate);
						ownershipQueries.push(compiled);
						return Promise.resolve(
							resolve(owners.filter((node) => compiled.params.includes(node.iid)))
						);
					},
				};
				return query;
			},
			delete() {
				return {
					async where(predicate: SQL) {
						const [nodeId, source, ...retained] = new PgDialect().sqlToQuery(predicate).params;
						expect(source).toBe('rung');
						aliases = aliases.filter((row) => row.nodeId !== nodeId || retained.includes(row.iid));
					},
				};
			},
			insert() {
				return {
					values(rows: typeof aliases) {
						return {
							async onConflictDoNothing() {
								aliases.push(...rows);
							},
						};
					},
				};
			},
		} as unknown as KgActionDb;
		await reconcileNodeIdentifiers(
			db,
			'B',
			{
				rungs: [
					{ rung: 'isbn', value: 'X', iid: 'int:isbn:X', aliasOnly: false },
					{ rung: 'gtin', value: 'safe', iid: 'int:gtin:safe', aliasOnly: true },
				],
				provenance: projection.provenance,
			},
			primaryIid
		);
		expect(aliases.map((row) => row.iid)).toEqual(['int:gtin:safe']);
		expect(ownershipQueries).toHaveLength(1);
		expect(ownershipQueries[0]!.sql).toContain('"kg"."nodes"."iid" in');
		expect(ownershipQueries[0]!.sql).not.toContain('status');
		expect(ownershipQueries[0]!.params).toEqual(['int:isbn:X', 'int:gtin:safe']);
		owners[0]!.status = 'active';
		const matches = await listPublicNodesByIid(db, 'int:isbn:X', { limit: 25, offset: 0 });
		expect(matches.map((node) => node.id)).toEqual(['A']);
	}
});

test.each([
	undefined,
	{ rungs: {} },
	{ rungs: [{ rung: 'isbn', iid: 42 }] },
	{ ...projection, category: 42 },
	{ ...projection, primary: { rung: 'isbn', iid: 42 } },
	{ ...projection, provenance: { producer: 'fixture', version: '' } },
	{ ...projection, provenance: { ...projection.provenance, specificationVersion: 42 } },
	{ ...projection, rungs: [{ ...projection.rungs[0], value: '' }] },
	{ ...projection, rungs: [{ ...projection.rungs[0], aliasOnly: 'yes' }] },
])('reconciliation treats malformed projection %j as absent', async (identityRungs) => {
	const { reconcileNodeIdentifiers } = await import('./node-identifiers');
	const events: string[] = [];
	const db = {
		delete() {
			return {
				async where() {
					events.push('delete');
				},
			};
		},
		insert() {
			return {
				values() {
					return {
						async onConflictDoNothing() {
							events.push('insert');
						},
					};
				},
			};
		},
	} as unknown as KgActionDb;
	await reconcileNodeIdentifiers(db, 'node', identityRungs, null);
	expect(events).toEqual([]);
});

test('backfill candidate query selects stored projections by bounded ascending keyset', async () => {
	const { listIdentifierBackfillCandidates } = await import('./node-identifiers');
	let predicate: SQL | undefined;
	let order: SQL | undefined;
	let selection: Record<string, unknown> | undefined;
	let bound: number | undefined;
	const db = {
		select(columns: Record<string, unknown>) {
			selection = columns;
			return {
				from() {
					return {
						where(value: SQL) {
							predicate = value;
							return {
								orderBy(value: SQL) {
									order = value;
									return {
										async limit(value: number) {
											bound = value;
											return [];
										},
									};
								},
							};
						},
					};
				},
			};
		},
	} as unknown as KgActionDb;
	await listIdentifierBackfillCandidates(db, { limit: 100, after: 'node-a' });
	const query = new PgDialect().sqlToQuery(predicate!);
	expect(query.sql).toContain("->'identityRungs' IS NOT NULL");
	expect(query.sql).toContain('"kg"."nodes"."id" > $1');
	expect(query.params).toEqual(['node-a']);
	expect(new PgDialect().sqlToQuery(order!).sql).toBe('"kg"."nodes"."id" asc');
	expect(Object.keys(selection!)).toEqual(['id', 'iid', 'classificationResult']);
	expect(bound).toBe(100);
	for (const limit of [0, 1001, 1.5])
		await expect(listIdentifierBackfillCandidates(db, { limit })).rejects.toThrow(
			'between 1 and 1000'
		);
});
