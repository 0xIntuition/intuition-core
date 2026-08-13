import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTimescaleMigrations } from '../src/timescale-generation/parser';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(
	testsDirectory,
	'../../../migrations/timescale/050_add_atom_context_registered.sql'
);

describe('AtomContextRegistered Timescale migration', () => {
	it('creates the regular typed table with canonical identity and ordering columns', async () => {
		const sql = await readFile(migrationPath, 'utf8');
		const { compatInventory, tables } = parseTimescaleMigrations([
			{ fileName: '050_add_atom_context_registered.sql', sql },
		]);
		const table = tables.get('atom_context_registered_events');

		expect(table?.primaryKey).toEqual(['transaction_hash', 'log_index']);
		expect(table?.columns.map(({ name, notNull, type }) => ({ name, notNull, type }))).toEqual(
			expect.arrayContaining([
				{ name: 'block_number', notNull: true, type: 'bigint' },
				{ name: 'block_timestamp', notNull: true, type: 'timestamptz' },
				{ name: 'block_hash', notNull: true, type: 'text' },
				{ name: 'transaction_hash', notNull: true, type: 'text' },
				{ name: 'log_index', notNull: true, type: 'integer' },
				{ name: 'registrant', notNull: true, type: 'text' },
				{ name: 'term_id', notNull: true, type: 'numeric' },
				{ name: 'term_id_hex', notNull: true, type: 'text' },
				{ name: 'uris', notNull: true, type: 'jsonb' },
				{ name: 'sequence_number', notNull: true, type: 'bigint' },
			])
		);
		expect(table?.indexes).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ columns: ['sequence_number'], unique: true }),
				expect.objectContaining({ columns: ['term_id', 'sequence_number'] }),
				expect.objectContaining({ columns: ['term_id_hex', 'sequence_number'] }),
			])
		);
		expect(compatInventory.hypertables).not.toContain('atom_context_registered_events');
		expect(sql).toContain("CHECK (jsonb_typeof(uris) = 'array')");
	});

	it('removes the closed-world event type whitelist without adding a replacement', async () => {
		const sql = await readFile(migrationPath, 'utf8');

		expect(sql).toContain('DROP CONSTRAINT IF EXISTS event_store_event_type_check');
		expect(sql).not.toContain('event_store_event_type_check_v2');
		expect(sql).not.toContain('ADD CONSTRAINT event_store_event_type_check');
		expect(sql).toContain('future additions');
	});
});
