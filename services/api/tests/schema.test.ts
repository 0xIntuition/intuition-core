import { describe, expect, test } from 'bun:test';
import { isGatedPublicPath } from '../src/app';
import { buildKgSchemaMetadata } from '../src/schema';

describe('isGatedPublicPath', () => {
	test('keeps health and schema metadata public in gated mode', () => {
		expect(isGatedPublicPath('/health')).toBe(true);
		expect(isGatedPublicPath('/api/schema')).toBe(true);
		expect(isGatedPublicPath('/api/atoms')).toBe(false);
	});
});

describe('buildKgSchemaMetadata', () => {
	test('groups columns, constraints, foreign keys, and indexes by table', () => {
		const metadata = buildKgSchemaMetadata({
			generatedAt: '2026-01-01T00:00:00.000Z',
			columns: [
				{
					table_name: 'nodes',
					column_name: 'id',
					ordinal_position: 1,
					data_type: 'text',
					udt_name: 'text',
					is_nullable: 'NO',
					column_default: null,
				},
				{
					table_name: 'nodes',
					column_name: 'created_by',
					ordinal_position: 2,
					data_type: 'text',
					udt_name: 'text',
					is_nullable: 'YES',
					column_default: null,
				},
			],
			constraints: [
				{
					table_name: 'nodes',
					constraint_name: 'nodes_pkey',
					constraint_type: 'PRIMARY KEY',
					column_name: 'id',
					ordinal_position: 1,
					foreign_table_schema: null,
					foreign_table_name: null,
					foreign_column_name: null,
					constraint_definition: 'PRIMARY KEY (id)',
				},
				{
					table_name: 'nodes',
					constraint_name: 'nodes_created_by_accounts_id_fk',
					constraint_type: 'FOREIGN KEY',
					column_name: 'created_by',
					ordinal_position: 1,
					foreign_table_schema: 'kg',
					foreign_table_name: 'accounts',
					foreign_column_name: 'id',
					constraint_definition: 'FOREIGN KEY (created_by) REFERENCES kg.accounts(id)',
				},
				{
					table_name: 'nodes',
					constraint_name: 'chk_nodes_status',
					constraint_type: 'CHECK',
					column_name: null,
					ordinal_position: null,
					foreign_table_schema: null,
					foreign_table_name: null,
					foreign_column_name: null,
					constraint_definition: "CHECK (status IN ('active', 'draft'))",
				},
			],
			indexes: [
				{
					table_name: 'nodes',
					index_name: 'idx_nodes_created_by_created_at',
					index_definition: 'CREATE INDEX idx_nodes_created_by_created_at ON kg.nodes',
				},
			],
		});

		expect(metadata).toEqual({
			schema: 'kg',
			generatedAt: '2026-01-01T00:00:00.000Z',
			tables: [
				{
					name: 'kg.nodes',
					schema: 'kg',
					columns: [
						{
							name: 'id',
							type: 'text',
							nullable: false,
							default: null,
							position: 1,
						},
						{
							name: 'created_by',
							type: 'text',
							nullable: true,
							default: null,
							position: 2,
						},
					],
					primaryKey: ['id'],
					foreignKeys: [
						{
							name: 'nodes_created_by_accounts_id_fk',
							columns: ['created_by'],
							references: {
								schema: 'kg',
								table: 'kg.accounts',
								columns: ['id'],
							},
							definition: 'FOREIGN KEY (created_by) REFERENCES kg.accounts(id)',
						},
					],
					constraints: [
						{
							name: 'chk_nodes_status',
							type: 'check',
							columns: [],
							definition: "CHECK (status IN ('active', 'draft'))",
						},
						{
							name: 'nodes_created_by_accounts_id_fk',
							type: 'foreign_key',
							columns: ['created_by'],
							definition: 'FOREIGN KEY (created_by) REFERENCES kg.accounts(id)',
						},
						{
							name: 'nodes_pkey',
							type: 'primary_key',
							columns: ['id'],
							definition: 'PRIMARY KEY (id)',
						},
					],
					indexes: [
						{
							name: 'idx_nodes_created_by_created_at',
							definition: 'CREATE INDEX idx_nodes_created_by_created_at ON kg.nodes',
						},
					],
				},
			],
		});
	});
});
