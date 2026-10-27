import { describe, expect, test } from 'bun:test';
import { getTableConfig, PgDialect } from 'drizzle-orm/pg-core';

import { nodeContexts } from './node_contexts';

describe('node contexts schema', () => {
	test('uses immutable event-provenance and ordinal identity', () => {
		const config = getTableConfig(nodeContexts);
		const primaryKey = config.primaryKeys.find((key) => key.name === 'node_contexts_pkey');

		expect(primaryKey?.columns.map((column) => column.name)).toEqual([
			'node_id',
			'transaction_hash',
			'log_index',
			'ordinal',
		]);
		expect(config.uniqueConstraints).toHaveLength(0);
		expect(
			config.indexes.find((index) => index.config.name === 'idx_node_contexts_event_ordinal')
				?.config.unique
		).toBe(true);
	});

	test('keeps canonical hex required and decoded text optional', () => {
		const config = getTableConfig(nodeContexts);
		const uriHex = config.columns.find((column) => column.name === 'uri_hex');
		const uriText = config.columns.find((column) => column.name === 'uri_text');
		const hexCheck = config.checks.find((check) => check.name === 'chk_node_contexts_uri_hex');
		const sql = hexCheck ? new PgDialect().sqlToQuery(hexCheck.value).sql : '';

		expect(uriHex?.notNull).toBe(true);
		expect(uriText?.notNull).toBe(false);
		expect(sql).toContain('^0x([0-9a-f]{2})*$');
	});

	test('references the canonical node id', () => {
		const config = getTableConfig(nodeContexts);
		const foreignKey = config.foreignKeys.at(0)?.reference();

		expect(foreignKey?.columns.map((column) => column.name)).toEqual(['node_id']);
		expect(foreignKey?.foreignColumns.map((column) => column.name)).toEqual(['id']);
	});
});
