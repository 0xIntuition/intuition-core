import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseTimescaleMigrations } from '../src/timescale-generation/parser';

const testsDirectory = path.dirname(fileURLToPath(import.meta.url));
const packageDirectory = path.resolve(testsDirectory, '..');
const repositoryRoot = path.resolve(packageDirectory, '../..');
const migrationsDirectory = path.join(repositoryRoot, 'backend', 'migrations');

describe('parseTimescaleMigrations', () => {
	it('applies DO-wrapped ALTER TABLE SET NOT NULL statements from migration 024', async () => {
		const migration024 = await readMigration('024_add_sequence_number_to_typed_tables.sql');
		const { tables } = parseTimescaleMigrations([
			{
				fileName: 'base.sql',
				sql: `
					CREATE TABLE IF NOT EXISTS atom_created_events (
						transaction_hash TEXT PRIMARY KEY,
						sequence_number BIGINT,
						term_id_hex TEXT
					);
					CREATE TABLE IF NOT EXISTS deposited_events (
						transaction_hash TEXT PRIMARY KEY,
						sequence_number BIGINT,
						term_id_hex TEXT
					);
				`,
			},
			{
				fileName: '024_add_sequence_number_to_typed_tables.sql',
				sql: migration024,
			},
		]);

		expect(getColumn(tables, 'atom_created_events', 'sequence_number')?.notNull).toBe(true);
		expect(getColumn(tables, 'atom_created_events', 'term_id_hex')?.notNull).toBe(true);
		expect(getColumn(tables, 'deposited_events', 'sequence_number')?.notNull).toBe(true);
		expect(getColumn(tables, 'deposited_events', 'term_id_hex')?.notNull).toBe(true);
	});

	it('applies DO-wrapped ALTER TABLE TYPE statements from migration 026', async () => {
		const migration026 = await readMigration('026_fix_leaderboard_functions.sql');
		const { tables } = parseTimescaleMigrations([
			{
				fileName: 'base.sql',
				sql: `
					CREATE TABLE IF NOT EXISTS leaderboard_cache (
						account_id TEXT PRIMARY KEY,
						pnl_pct NUMERIC(20, 4),
						realized_pnl_pct NUMERIC(20, 4),
						unrealized_pnl_pct NUMERIC(20, 4)
					);
				`,
			},
			{
				fileName: '026_fix_leaderboard_functions.sql',
				sql: migration026,
			},
		]);

		expect(getColumn(tables, 'leaderboard_cache', 'pnl_pct')).toMatchObject({
			precision: undefined,
			scale: undefined,
			type: 'numeric',
		});
		expect(getColumn(tables, 'leaderboard_cache', 'realized_pnl_pct')).toMatchObject({
			precision: undefined,
			scale: undefined,
			type: 'numeric',
		});
	});

	it('deduplicates indexes and captures backend job and hypertable metadata', () => {
		const { compatInventory, tables } = parseTimescaleMigrations([
			{
				fileName: 'sample.sql',
				sql: `
					CREATE TABLE IF NOT EXISTS sample_events (
						id BIGSERIAL PRIMARY KEY,
						ts TIMESTAMPTZ NOT NULL,
						sequence_number BIGINT
					);

					CREATE INDEX IF NOT EXISTS idx_sample_seq
						ON sample_events (sequence_number ASC);
					CREATE INDEX IF NOT EXISTS idx_sample_seq
						ON sample_events (sequence_number ASC);

					SELECT create_hypertable('sample_events', 'ts', if_not_exists => TRUE);

					DO $$ BEGIN
						PERFORM add_job('refresh_sample_events', schedule_interval => INTERVAL '5 minutes');
					EXCEPTION WHEN OTHERS THEN NULL; END $$;
				`,
			},
		]);

		expect(tables.get('sample_events')?.indexes).toHaveLength(1);
		expect(compatInventory.hypertables).toEqual(['sample_events']);
		expect(compatInventory.jobs).toEqual(['refresh_sample_events']);
	});
});

async function readMigration(fileName: string): Promise<string> {
	return readFile(path.join(migrationsDirectory, fileName), 'utf8');
}

function getColumn(
	tables: Map<string, { columns: Array<{ name: string }> }>,
	tableName: string,
	columnName: string
) {
	return tables.get(tableName)?.columns.find((column) => column.name === columnName);
}
