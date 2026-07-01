import {
	assertRegisteredHypertables,
	assertRegisteredMaterializedViews,
} from '../timescale-supported-relations';
import { timescaleFileGroups } from './layout';
import { parseTimescaleMigrations } from './parser';
import { renderCompatInventory, renderIndexFile, renderManifest, renderSchemaFile } from './render';
import type { CompatInventory, MigrationSource, TableDefinition } from './types';

export type GeneratedTimescaleArtifacts = {
	compatInventory: CompatInventory;
	files: Array<{
		content: string;
		fileName: string;
	}>;
	tables: Map<string, TableDefinition>;
};

export function generateTimescaleSchemaArtifacts(
	migrations: Iterable<MigrationSource>
): GeneratedTimescaleArtifacts {
	const { compatInventory, tables } = parseTimescaleMigrations(migrations);

	assertExpectedTables(tables);
	assertRegisteredHypertables(compatInventory.hypertables);
	assertRegisteredMaterializedViews(compatInventory.materializedViews);

	const files: GeneratedTimescaleArtifacts['files'] = timescaleFileGroups.map((group) => ({
		content: renderSchemaFile(
			group.tableNames.map((tableName) => getRequiredTable(tables, tableName))
		),
		fileName: group.fileName,
	}));

	files.push({
		content: renderIndexFile(),
		fileName: 'index.ts',
	});
	files.push({
		content: renderManifest(tables),
		fileName: 'manifest.json',
	});
	files.push({
		content: renderCompatInventory(compatInventory),
		fileName: 'compat-inventory.json',
	});

	return { compatInventory, files, tables };
}

function assertExpectedTables(tables: Map<string, TableDefinition>): void {
	const expectedTableNames = new Set<string>(
		timescaleFileGroups.flatMap((group) => [...group.tableNames])
	);
	const actualTableNames = new Set([...tables.keys()]);

	for (const tableName of expectedTableNames) {
		if (!actualTableNames.has(tableName)) {
			throw new Error(`Missing expected table: ${tableName}`);
		}
	}

	for (const tableName of actualTableNames) {
		if (!expectedTableNames.has(tableName)) {
			throw new Error(`Unmapped table discovered in migrations: ${tableName}`);
		}
	}
}

function getRequiredTable(
	tables: Map<string, TableDefinition>,
	tableName: string
): TableDefinition {
	const table = tables.get(tableName);
	if (!table) {
		throw new Error(`Expected table ${tableName} to exist`);
	}

	return table;
}
