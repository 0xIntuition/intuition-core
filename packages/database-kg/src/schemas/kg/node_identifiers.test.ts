import { expect, test } from 'bun:test';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

test('identifier schema has required columns, composite key, plain index, source check and cascade', async () => {
	const { nodeIdentifiers } = await import('./node_identifiers');
	const config = getTableConfig(nodeIdentifiers);
	expect(config.columns.map((c) => c.name)).toEqual([
		'node_id',
		'iid',
		'scheme',
		'rung',
		'source',
		'created_at',
	]);
	expect(config.columns.every((c) => c.notNull)).toBe(true);
	expect(nodeIdentifiers.source.default).toBe('rung');
	expect(nodeIdentifiers.createdAt.hasDefault).toBe(true);
	expect(config.primaryKeys[0]?.columns.map((c) => c.name)).toEqual(['node_id', 'iid']);
	expect(config.indexes[0]?.config.name).toBe('idx_node_identifiers_iid');
	expect(config.indexes[0]?.config.unique).toBe(false);
	expect(config.indexes[0]?.config.columns.map((c) => ('name' in c ? c.name : undefined))).toEqual([
		'iid',
	]);
	expect(new PgDialect().sqlToQuery(config.checks[0]!.value).sql).toContain("IN ('rung')");
	expect(config.foreignKeys[0]?.onDelete).toBe('cascade');
	expect(config.foreignKeys[0]?.reference().foreignColumns.map((c) => c.name)).toEqual(['id']);
});
