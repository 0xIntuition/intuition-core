import { describe, expect, it } from 'bun:test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

type Manifest = {
	tables: Array<{
		name: string;
		primaryKey: string[];
		columns: Array<{ name: string; type: string; notNull: boolean }>;
	}>;
};

const schemaDirectory = path.resolve(
	path.dirname(fileURLToPath(import.meta.url)),
	'../src/schemas/timescale'
);

describe('AtomContextRegistered generated schema', () => {
	it('includes the typed table in the checked-in manifest', async () => {
		const manifest = JSON.parse(
			await readFile(path.join(schemaDirectory, 'manifest.json'), 'utf8')
		) as Manifest;
		const table = manifest.tables.find(({ name }) => name === 'atom_context_registered_events');

		expect(table?.primaryKey).toEqual(['transaction_hash', 'log_index']);
		expect(table?.columns).toEqual(
			expect.arrayContaining([
				{ name: 'term_id_hex', type: 'text', notNull: true },
				{ name: 'uris', type: 'jsonb', notNull: true },
				{ name: 'sequence_number', type: 'bigint', notNull: true },
			])
		);
	});

	it('types uris as an ordered array rather than a scalar JSON value', async () => {
		const eventsSchema = await readFile(path.join(schemaDirectory, 'events.ts'), 'utf8');

		expect(eventsSchema).toContain("uris: jsonb('uris').$type<string[]>().notNull()");
	});
});
