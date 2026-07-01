import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Sql } from 'postgres';
import type { ManifestColumn, ManifestRelation, ManifestTable } from './timescale-generation/types';
import { supportedMaterializedViewRelations } from './timescale-supported-relations';

type ExpectedManifest = {
	tables: ManifestTable[];
};

type LiveColumnRow = {
	column_name: string;
	data_type: string;
	is_nullable: 'YES' | 'NO';
	numeric_precision: number | null;
	numeric_scale: number | null;
	table_name: string;
	udt_name: string;
};

type PrimaryKeyRow = {
	column_name: string;
	ordinal_position: number;
	table_name: string;
};

// Live columns keep a plain-string type so engine types outside SupportedColumnType
// (inet, uuid, …) surface as reported drift instead of crashing normalization.
type LiveColumn = Omit<ManifestColumn, 'type'> & {
	type: string;
};

type LiveRelation = {
	columns: LiveColumn[];
	name: string;
};

type LiveTable = LiveRelation & {
	primaryKey: string[];
};

const sourceDirectory = path.dirname(fileURLToPath(import.meta.url));
const manifestPath = path.resolve(sourceDirectory, 'schemas', 'timescale', 'manifest.json');

export async function loadExpectedTimescaleManifest(): Promise<ExpectedManifest> {
	return JSON.parse(await readFile(manifestPath, 'utf8')) as ExpectedManifest;
}

export function loadExpectedSupportedRelationManifest(): ManifestRelation[] {
	return supportedMaterializedViewRelations.map((relation) => ({
		columns: [...relation.columns],
		name: relation.name,
	}));
}

export async function verifyTimescaleSchema(sql: Sql): Promise<string[]> {
	const manifest = await loadExpectedTimescaleManifest();

	// Core's manifest is a curated subset of the protocol tables; a live database
	// (shared dev, or a node running extra services) may hold tables Core does not
	// own. Only the manifest's tables are verified — anything else is not drift.
	const manifestTableNames = manifest.tables.map((table) => table.name);

	const liveColumns = await sql<LiveColumnRow[]>`
		SELECT
			columns.table_name,
			columns.column_name,
			columns.data_type,
			columns.udt_name,
			columns.is_nullable,
			columns.numeric_precision,
			columns.numeric_scale
		FROM information_schema.columns AS columns
		INNER JOIN information_schema.tables AS tables
			ON tables.table_schema = columns.table_schema
			AND tables.table_name = columns.table_name
		WHERE columns.table_schema = 'public'
			AND tables.table_type = 'BASE TABLE'
			AND columns.table_name = ANY(${manifestTableNames})
		ORDER BY columns.table_name, columns.ordinal_position
	`;

	const livePrimaryKeys = await sql<PrimaryKeyRow[]>`
		SELECT
			key_usage.table_name,
			key_usage.column_name,
			key_usage.ordinal_position
		FROM information_schema.table_constraints AS constraints
		INNER JOIN information_schema.key_column_usage AS key_usage
			ON key_usage.constraint_name = constraints.constraint_name
			AND key_usage.table_schema = constraints.table_schema
		WHERE constraints.table_schema = 'public'
			AND constraints.constraint_type = 'PRIMARY KEY'
			AND key_usage.table_name = ANY(${manifestTableNames})
		ORDER BY key_usage.table_name, key_usage.ordinal_position
	`;

	const liveTables = buildLiveTables(liveColumns, livePrimaryKeys);
	return compareTables(manifest.tables, liveTables);
}

export async function verifySupportedTimescaleRelations(sql: Sql): Promise<string[]> {
	const expectedRelations = loadExpectedSupportedRelationManifest();
	const relationNames = new Set(expectedRelations.map((relation) => relation.name));
	const liveColumns = await sql<LiveColumnRow[]>`
		SELECT
			columns.table_name,
			columns.column_name,
			columns.data_type,
			columns.udt_name,
			columns.is_nullable,
			columns.numeric_precision,
			columns.numeric_scale
		FROM information_schema.columns AS columns
		WHERE columns.table_schema = 'public'
		ORDER BY columns.table_name, columns.ordinal_position
	`;

	const liveRelations = buildLiveRelations(
		liveColumns.filter((column) => relationNames.has(column.table_name))
	);

	return compareRelations(expectedRelations, liveRelations, 'relation');
}

export function formatTimescaleSchemaMismatches(mismatches: string[]): string {
	return mismatches.map((mismatch) => `- ${mismatch}`).join('\n');
}

function buildLiveTables(columns: LiveColumnRow[], primaryKeys: PrimaryKeyRow[]): LiveTable[] {
	const tableMap = new Map<string, LiveTable>();

	for (const column of columns) {
		const table = tableMap.get(column.table_name) ?? {
			columns: [],
			name: column.table_name,
			primaryKey: [],
		};

		table.columns.push(normalizeLiveColumn(column));
		tableMap.set(column.table_name, table);
	}

	for (const primaryKey of primaryKeys) {
		const table = tableMap.get(primaryKey.table_name);
		if (!table) {
			continue;
		}

		table.primaryKey.push(primaryKey.column_name);
	}

	return [...tableMap.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function buildLiveRelations(columns: LiveColumnRow[]): LiveRelation[] {
	const relationMap = new Map<string, LiveRelation>();

	for (const column of columns) {
		const relation = relationMap.get(column.table_name) ?? {
			columns: [],
			name: column.table_name,
		};

		relation.columns.push(normalizeLiveColumn(column));
		relationMap.set(column.table_name, relation);
	}

	return [...relationMap.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function normalizeLiveColumn(column: LiveColumnRow): LiveColumn {
	return {
		name: column.column_name,
		notNull: column.is_nullable === 'NO',
		precision: column.numeric_precision ?? undefined,
		scale: column.numeric_scale ?? undefined,
		type: normalizeLiveColumnType(column),
	};
}

function normalizeLiveColumnType(column: LiveColumnRow): string {
	if (column.udt_name === 'jsonb') {
		return 'jsonb';
	}

	if (column.data_type === 'timestamp with time zone') {
		return 'timestamptz';
	}

	// Types outside SupportedColumnType flow through and surface as reported drift.
	return column.data_type;
}

function compareTables(expectedTables: ManifestTable[], liveTables: LiveTable[]): string[] {
	const mismatches = compareRelations(expectedTables, liveTables, 'table');
	const liveMap = new Map(liveTables.map((table) => [table.name, table]));

	for (const expectedTable of expectedTables) {
		const liveTable = liveMap.get(expectedTable.name);
		if (!liveTable) {
			continue;
		}

		if (expectedTable.primaryKey.join(',') !== liveTable.primaryKey.join(',')) {
			mismatches.push(
				`Primary key mismatch for ${expectedTable.name}: expected [${expectedTable.primaryKey.join(
					', '
				)}], got [${liveTable.primaryKey.join(', ')}]`
			);
		}
	}

	return mismatches;
}

function compareRelations(
	expectedRelations: ManifestRelation[],
	liveRelations: LiveRelation[],
	relationLabel: 'relation' | 'table'
): string[] {
	const mismatches: string[] = [];
	const expectedMap = new Map(expectedRelations.map((relation) => [relation.name, relation]));
	const liveMap = new Map(liveRelations.map((relation) => [relation.name, relation]));

	for (const expectedRelation of expectedRelations) {
		const liveRelation = liveMap.get(expectedRelation.name);
		if (!liveRelation) {
			mismatches.push(`Missing ${relationLabel} ${expectedRelation.name}`);
			continue;
		}

		mismatches.push(...compareRelationColumns(expectedRelation, liveRelation));
	}

	for (const liveRelation of liveRelations) {
		if (!expectedMap.has(liveRelation.name)) {
			mismatches.push(`Unexpected ${relationLabel} ${liveRelation.name}`);
		}
	}

	return mismatches;
}

function compareRelationColumns(
	expectedRelation: ManifestRelation,
	liveRelation: LiveRelation
): string[] {
	const mismatches: string[] = [];
	const expectedColumns = new Map(expectedRelation.columns.map((column) => [column.name, column]));
	const liveColumns = new Map(liveRelation.columns.map((column) => [column.name, column]));

	for (const expectedColumn of expectedRelation.columns) {
		const liveColumn = liveColumns.get(expectedColumn.name);
		if (!liveColumn) {
			mismatches.push(`Missing column ${expectedRelation.name}.${expectedColumn.name}`);
			continue;
		}

		const expectedType = normalizeExpectedColumnType(expectedColumn.type);
		if (expectedType !== liveColumn.type) {
			mismatches.push(
				`Type mismatch for ${expectedRelation.name}.${expectedColumn.name}: expected ${expectedType}, got ${liveColumn.type}`
			);
		}

		if (expectedColumn.notNull !== liveColumn.notNull) {
			mismatches.push(
				`Nullability mismatch for ${expectedRelation.name}.${expectedColumn.name}: expected notNull=${expectedColumn.notNull}, got notNull=${liveColumn.notNull}`
			);
		}

		if (
			expectedColumn.precision !== undefined &&
			liveColumn.precision !== undefined &&
			expectedColumn.precision !== liveColumn.precision
		) {
			mismatches.push(
				`Precision mismatch for ${expectedRelation.name}.${expectedColumn.name}: expected ${expectedColumn.precision}, got ${liveColumn.precision}`
			);
		}

		if (
			expectedColumn.scale !== undefined &&
			liveColumn.scale !== undefined &&
			expectedColumn.scale !== liveColumn.scale
		) {
			mismatches.push(
				`Scale mismatch for ${expectedRelation.name}.${expectedColumn.name}: expected ${expectedColumn.scale}, got ${liveColumn.scale}`
			);
		}
	}

	for (const liveColumn of liveRelation.columns) {
		if (!expectedColumns.has(liveColumn.name)) {
			mismatches.push(`Unexpected column ${liveRelation.name}.${liveColumn.name}`);
		}
	}

	return mismatches;
}

function normalizeExpectedColumnType(type: string): string {
	return type === 'bigserial' ? 'bigint' : type;
}
