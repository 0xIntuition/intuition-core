import type { KgDb } from '@0xintuition/database-kg';
import { sql } from 'drizzle-orm';

export type SchemaColumn = {
	name: string;
	type: string;
	nullable: boolean;
	default: string | null;
	position: number;
};

export type SchemaForeignKey = {
	name: string;
	columns: string[];
	references: {
		schema: string;
		table: string;
		columns: string[];
	};
	definition: string;
};

export type SchemaConstraint = {
	name: string;
	type: string;
	columns: string[];
	definition: string;
};

export type SchemaIndex = {
	name: string;
	definition: string;
};

export type SchemaTable = {
	name: string;
	schema: string;
	columns: SchemaColumn[];
	primaryKey: string[];
	foreignKeys: SchemaForeignKey[];
	constraints: SchemaConstraint[];
	indexes: SchemaIndex[];
};

export type KgSchemaMetadata = {
	schema: 'kg';
	generatedAt: string;
	tables: SchemaTable[];
};

type ColumnRow = {
	table_name: string;
	column_name: string;
	ordinal_position: number;
	data_type: string;
	udt_name: string;
	is_nullable: 'YES' | 'NO';
	column_default: string | null;
};

type ConstraintRow = {
	table_name: string;
	constraint_name: string;
	constraint_type: string;
	column_name: string | null;
	ordinal_position: number | null;
	foreign_table_schema: string | null;
	foreign_table_name: string | null;
	foreign_column_name: string | null;
	constraint_definition: string;
};

type IndexRow = {
	table_name: string;
	index_name: string;
	index_definition: string;
};

function displayType(row: ColumnRow): string {
	if (row.data_type === 'USER-DEFINED') {
		return row.udt_name;
	}
	return row.data_type;
}

function tableKey(tableName: string): string {
	return `kg.${tableName}`;
}

function ensureTable(tables: Map<string, SchemaTable>, tableName: string): SchemaTable {
	const key = tableKey(tableName);
	const existing = tables.get(key);
	if (existing) {
		return existing;
	}

	const table: SchemaTable = {
		name: key,
		schema: 'kg',
		columns: [],
		primaryKey: [],
		foreignKeys: [],
		constraints: [],
		indexes: [],
	};
	tables.set(key, table);
	return table;
}

function groupedConstraints(rows: ConstraintRow[]): Map<string, ConstraintRow[]> {
	const groups = new Map<string, ConstraintRow[]>();
	for (const row of rows) {
		const key = `${row.table_name}:${row.constraint_name}`;
		const group = groups.get(key);
		if (group) {
			group.push(row);
		} else {
			groups.set(key, [row]);
		}
	}

	for (const group of groups.values()) {
		group.sort((a, b) => (a.ordinal_position ?? 0) - (b.ordinal_position ?? 0));
	}

	return groups;
}

export function buildKgSchemaMetadata(input: {
	columns: ColumnRow[];
	constraints: ConstraintRow[];
	indexes: IndexRow[];
	generatedAt?: string;
}): KgSchemaMetadata {
	const tables = new Map<string, SchemaTable>();

	for (const row of input.columns) {
		const table = ensureTable(tables, row.table_name);
		table.columns.push({
			name: row.column_name,
			type: displayType(row),
			nullable: row.is_nullable === 'YES',
			default: row.column_default,
			position: row.ordinal_position,
		});
	}

	for (const group of groupedConstraints(input.constraints).values()) {
		const first = group[0];
		if (!first) {
			continue;
		}

		const table = ensureTable(tables, first.table_name);
		const columns = group.flatMap((row) => (row.column_name ? [row.column_name] : []));
		const type = first.constraint_type.toLowerCase().replaceAll(' ', '_');

		if (first.constraint_type === 'PRIMARY KEY') {
			table.primaryKey = columns;
		}

		if (first.constraint_type === 'FOREIGN KEY') {
			table.foreignKeys.push({
				name: first.constraint_name,
				columns,
				references: {
					schema: first.foreign_table_schema ?? '',
					table: first.foreign_table_name
						? `${first.foreign_table_schema ?? 'public'}.${first.foreign_table_name}`
						: '',
					columns: group.flatMap((row) =>
						row.foreign_column_name ? [row.foreign_column_name] : []
					),
				},
				definition: first.constraint_definition,
			});
		}

		table.constraints.push({
			name: first.constraint_name,
			type,
			columns,
			definition: first.constraint_definition,
		});
	}

	for (const row of input.indexes) {
		const table = ensureTable(tables, row.table_name);
		table.indexes.push({
			name: row.index_name,
			definition: row.index_definition,
		});
	}

	const sortedTables = [...tables.values()]
		.map((table) => ({
			...table,
			columns: table.columns.sort((a, b) => a.position - b.position),
			foreignKeys: table.foreignKeys.sort((a, b) => a.name.localeCompare(b.name)),
			constraints: table.constraints.sort((a, b) => a.name.localeCompare(b.name)),
			indexes: table.indexes.sort((a, b) => a.name.localeCompare(b.name)),
		}))
		.sort((a, b) => a.name.localeCompare(b.name));

	return {
		schema: 'kg',
		generatedAt: input.generatedAt ?? new Date().toISOString(),
		tables: sortedTables,
	};
}

export async function loadKgSchemaMetadata(db: KgDb): Promise<KgSchemaMetadata> {
	const [columns, constraints, indexes] = await Promise.all([
		db.execute(sql<ColumnRow>`
			SELECT
				table_name,
				column_name,
				ordinal_position,
				data_type,
				udt_name,
				is_nullable,
				column_default
			FROM information_schema.columns
			JOIN information_schema.tables USING (table_schema, table_name)
			WHERE table_schema = 'kg'
				AND table_type = 'BASE TABLE'
			ORDER BY table_name, ordinal_position
		`),
		db.execute(sql<ConstraintRow>`
			SELECT
				tc.table_name,
				tc.constraint_name,
				tc.constraint_type,
				kcu.column_name,
				kcu.ordinal_position,
				ccu.table_schema AS foreign_table_schema,
				ccu.table_name AS foreign_table_name,
				ccu.column_name AS foreign_column_name,
				pg_get_constraintdef(pc.oid, true) AS constraint_definition
			FROM information_schema.table_constraints tc
			JOIN pg_constraint pc
				ON pc.conname = tc.constraint_name
				AND pc.connamespace = 'kg'::regnamespace
				AND pc.conrelid = (quote_ident(tc.table_schema) || '.' || quote_ident(tc.table_name))::regclass
			LEFT JOIN information_schema.key_column_usage kcu
				ON kcu.constraint_schema = tc.constraint_schema
				AND kcu.constraint_name = tc.constraint_name
				AND kcu.table_schema = tc.table_schema
				AND kcu.table_name = tc.table_name
			LEFT JOIN information_schema.constraint_column_usage ccu
				ON ccu.constraint_schema = tc.constraint_schema
				AND ccu.constraint_name = tc.constraint_name
			JOIN information_schema.tables ist
				ON ist.table_schema = tc.table_schema
				AND ist.table_name = tc.table_name
			WHERE tc.table_schema = 'kg'
				AND ist.table_type = 'BASE TABLE'
			ORDER BY tc.table_name, tc.constraint_name, kcu.ordinal_position NULLS LAST
		`),
		db.execute(sql<IndexRow>`
			SELECT
				tablename AS table_name,
				indexname AS index_name,
				indexdef AS index_definition
			FROM pg_indexes
			WHERE schemaname = 'kg'
				AND tablename IN (
					SELECT table_name
					FROM information_schema.tables
					WHERE table_schema = 'kg'
						AND table_type = 'BASE TABLE'
				)
			ORDER BY tablename, indexname
		`),
	]);

	return buildKgSchemaMetadata({
		columns: columns as unknown as ColumnRow[],
		constraints: constraints as unknown as ConstraintRow[],
		indexes: indexes as unknown as IndexRow[],
	});
}
