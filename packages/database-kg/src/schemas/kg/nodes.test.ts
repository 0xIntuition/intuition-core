import { describe, expect, test } from 'bun:test';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { nodes } from './nodes';

describe('nodes IID schema runway', () => {
	test('stores a nullable, non-unique canonical IID cluster key', () => {
		const config = getTableConfig(nodes);
		const iid = config.columns.find((column) => column.name === 'iid');
		const index = config.indexes.find((candidate) => candidate.config.name === 'idx_nodes_iid');

		expect(iid).toBeDefined();
		expect(iid?.notNull).toBe(false);
		expect(iid?.isUnique).toBe(false);
		expect(index?.config.unique).toBe(false);
		expect(
			index?.config.columns.map((column) => ('name' in column ? column.name : undefined))
		).toEqual(['iid']);
		expect(index?.config.where).toBeDefined();
	});

	test('accepts IID as an additive raw type', () => {
		const config = getTableConfig(nodes);
		const constraint = config.checks.find((candidate) => candidate.name === 'chk_nodes_raw_type');
		const sql = constraint ? new PgDialect().sqlToQuery(constraint.value).sql : '';

		expect(sql).toContain("'string'");
		expect(sql).toContain("'json'");
		expect(sql).toContain("'http_uri'");
		expect(sql).toContain("'ipfs_uri'");
		expect(sql).toContain("'iid'");
	});
});
