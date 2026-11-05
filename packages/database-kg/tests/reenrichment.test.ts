import { expect, test } from 'bun:test';
import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { listNodeIdentifierIids } from '../src/actions/node-identifiers';
import { listReenrichmentCandidates } from '../src/actions/reenrichment';
import type { KgActionDb } from '../src/actions/types';

function fixture(ids: string[]) {
	const queries: { sql: string; params: unknown[] }[] = [];
	const db = {
		execute: async (query: SQL) => {
			queries.push(new PgDialect().sqlToQuery(query));
			return ids.map((id) => ({ id, iid: id }));
		},
	} as unknown as KgActionDb;
	return { db, queries };
}

test('selector binds active plugin provenance, exact stored rungs, keyset, date, and bounded lookahead', async () => {
	const { db, queries } = fixture(['a', 'b', 'c']);
	const since = new Date('2026-10-01T00:00:00Z');
	expect(
		await listReenrichmentCandidates(db, {
			missingPlugin: 'spotify',
			rungs: ['spotify:album'],
			createdSince: since,
			cursor: 'previous',
			limit: 2,
		})
	).toEqual({ ids: ['a', 'b'], nextCursor: 'b' });
	const { sql, params } = queries[0]!;
	for (const text of [
		'n.raw_type =',
		'n.enrichment_status =',
		'kg.node_identifiers',
		'i.node_id = n.id',
		'i.rung = ANY(',
		'NOT EXISTS',
		'kg.artifacts',
		'a.node_id = n.id',
		"a.status = 'active'",
		"a.data->'meta'->>'pluginId' =",
		'n.created_at >=',
		'n.id >',
		'ORDER BY n.id',
		'LIMIT',
	])
		expect(sql).toContain(text);
	expect(sql).not.toContain('artifact_kind');
	expect(params).toEqual([
		'iid',
		'completed',
		['spotify:album'],
		'spotify',
		since.toISOString(),
		'previous',
		3,
	]);
});

test('selector optionally binds artifact kind and ends pagination without a surplus row', async () => {
	const { db, queries } = fixture(['a']);
	expect(
		await listReenrichmentCandidates(db, {
			missingPlugin: 'tmdb',
			missingArtifactKind: 'tmdb-images',
			rungs: ['tmdb:tv'],
			limit: 2,
		})
	).toEqual({ ids: ['a'] });
	expect(queries[0]?.sql).toContain('a.artifact_kind =');
	expect(queries[0]?.params).toContain('tmdb-images');
	expect(queries[0]?.sql).not.toContain('n.id >');
	expect(queries[0]?.sql).not.toContain('n.created_at >=');
});

test('selector validates limit and createdSince before SQL and skips empty rung sets', async () => {
	const { db, queries } = fixture([]);
	for (const limit of [0, -1, 1.5, 5001, NaN, Infinity])
		await expect(
			listReenrichmentCandidates(db, { missingPlugin: 'spotify', rungs: ['spotify:album'], limit })
		).rejects.toThrow();
	await expect(
		listReenrichmentCandidates(db, {
			missingPlugin: 'spotify',
			rungs: [],
			createdSince: new Date('bad'),
		})
	).rejects.toThrow('createdSince');
	expect(await listReenrichmentCandidates(db, { missingPlugin: 'spotify', rungs: [] })).toEqual({
		ids: [],
	});
	expect(queries).toHaveLength(0);
	for (const limit of [1, 5000])
		await listReenrichmentCandidates(db, {
			missingPlugin: 'spotify',
			rungs: ['spotify:album'],
			limit,
		});
	expect(queries.map((q) => q.params.at(-1))).toEqual([2, 5001]);
});

test('alias read is node-scoped and deterministic without writing or selecting a primary', async () => {
	const { db, queries } = fixture(['alias-a', 'alias-b']);
	expect(await listNodeIdentifierIids(db, 'node')).toEqual(['alias-a', 'alias-b']);
	expect(queries[0]?.sql).toContain('WHERE node_id =');
	expect(queries[0]?.sql).toContain('ORDER BY created_at, iid');
	expect(queries[0]?.params).toEqual(['node']);
});
