import type {
	ColumnDefault,
	ColumnDefinition,
	CompatInventory,
	IndexDefinition,
	MigrationSource,
	SupportedColumnType,
	TableDefinition,
} from './types';

export function parseTimescaleMigrations(migrations: Iterable<MigrationSource>): {
	compatInventory: CompatInventory;
	tables: Map<string, TableDefinition>;
} {
	const tables = new Map<string, TableDefinition>();
	const compatInventory = createCompatInventory();

	for (const migration of migrations) {
		const statements = splitStatements(migration.sql);
		for (const statement of statements) {
			parseStatement(statement, tables, compatInventory);
		}
	}

	return { compatInventory, tables };
}

function createCompatInventory(): CompatInventory {
	return {
		continuousAggregates: [],
		functions: [],
		hypertables: [],
		jobs: [],
		materializedViews: [],
		types: [],
		views: [],
	};
}

function parseStatement(
	statement: string,
	tables: Map<string, TableDefinition>,
	compatInventory: CompatInventory
): void {
	const normalized = statement.trim();
	if (!normalized) {
		return;
	}

	const doBlockMatch = normalized.match(/^DO\s+(\$[a-zA-Z0-9_]*\$)([\s\S]*)\1$/i);
	if (doBlockMatch) {
		parseDoBlockStatement(getMatchGroup(doBlockMatch, 2), tables, compatInventory);
		return;
	}

	const createTableMatch = normalized.match(
		/^CREATE TABLE(?: IF NOT EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]*)\)$/i
	);

	if (createTableMatch) {
		const tableName = getMatchGroup(createTableMatch, 1);
		const body = getMatchGroup(createTableMatch, 2);
		parseCreateTableStatement(tableName, body, tables);
		return;
	}

	const dropTableMatch = normalized.match(/^DROP TABLE(?: IF EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
	if (dropTableMatch) {
		tables.delete(getMatchGroup(dropTableMatch, 1));
		return;
	}

	const alterTableMatch = normalized.match(/^ALTER TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+([\s\S]*)$/i);
	if (alterTableMatch) {
		const tableName = getMatchGroup(alterTableMatch, 1);
		const operations = getMatchGroup(alterTableMatch, 2);
		parseAlterTableStatement(tableName, operations, tables);
		return;
	}

	const createIndexMatch = normalized.match(
		/^CREATE\s+(UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+ON\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*\(([\s\S]+?)\)\s*(?:WHERE[\s\S]*)?$/i
	);

	if (createIndexMatch) {
		const uniqueToken = createIndexMatch[1];
		const indexName = getMatchGroup(createIndexMatch, 2);
		const tableName = getMatchGroup(createIndexMatch, 3);
		const rawColumns = getMatchGroup(createIndexMatch, 4);
		const isNonTableRelation =
			compatInventory.materializedViews.includes(tableName) ||
			compatInventory.views.includes(tableName);

		if (isNonTableRelation && !tables.has(tableName)) {
			return;
		}

		const table = ensureTable(tables, tableName);
		const indexDefinition: IndexDefinition = {
			columns: parseIndexColumns(rawColumns),
			name: indexName,
			unique: Boolean(uniqueToken),
		};

		if (indexDefinition.columns.length > 0) {
			upsertIndex(table.indexes, indexDefinition);
		}
		return;
	}

	const materializedViewMatch = normalized.match(
		/^CREATE MATERIALIZED VIEW(?: IF NOT EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)/i
	);
	if (materializedViewMatch) {
		const viewName = getMatchGroup(materializedViewMatch, 1);
		pushUnique(compatInventory.materializedViews, viewName);
		if (
			viewName.endsWith('_hourly') ||
			viewName.endsWith('_daily') ||
			viewName === 'share_price_stats_hourly' ||
			viewName === 'share_price_stats_daily'
		) {
			pushUnique(compatInventory.continuousAggregates, viewName);
		}
		return;
	}

	const viewMatch = normalized.match(/^CREATE(?: OR REPLACE)? VIEW\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
	if (viewMatch) {
		pushUnique(compatInventory.views, getMatchGroup(viewMatch, 1));
		return;
	}

	const typeMatch = normalized.match(/^CREATE TYPE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i);
	if (typeMatch) {
		pushUnique(compatInventory.types, getMatchGroup(typeMatch, 1));
		return;
	}

	const functionMatch = normalized.match(
		/^CREATE(?: OR REPLACE)? FUNCTION\s+([a-zA-Z_][a-zA-Z0-9_]*)/i
	);
	if (functionMatch) {
		pushUnique(compatInventory.functions, getMatchGroup(functionMatch, 1));
		return;
	}

	const hypertableMatch = normalized.match(/create_hypertable\(\s*'([^']+)'/i);
	if (hypertableMatch) {
		pushUnique(compatInventory.hypertables, getMatchGroup(hypertableMatch, 1));
		return;
	}

	const jobMatch = normalized.match(/add_job\(\s*'([^']+)'/i);
	if (jobMatch) {
		pushUnique(compatInventory.jobs, getMatchGroup(jobMatch, 1));
	}
}

function parseDoBlockStatement(
	body: string,
	tables: Map<string, TableDefinition>,
	compatInventory: CompatInventory
): void {
	for (const innerStatement of splitStatements(body)) {
		const normalized = innerStatement.trim();
		if (!normalized) {
			continue;
		}

		const nestedAlterTableMatch = normalized.match(
			/(?:^|[\s])ALTER TABLE\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+([\s\S]*)$/i
		);
		if (nestedAlterTableMatch) {
			const tableName = getMatchGroup(nestedAlterTableMatch, 1);
			const operations = getMatchGroup(nestedAlterTableMatch, 2);
			parseAlterTableStatement(tableName, operations, tables);
		}

		const nestedCreateTypeMatch = normalized.match(
			/(?:^|[\s])CREATE TYPE\s+([a-zA-Z_][a-zA-Z0-9_]*)/i
		);
		if (nestedCreateTypeMatch) {
			pushUnique(compatInventory.types, getMatchGroup(nestedCreateTypeMatch, 1));
		}

		const nestedJobMatches = normalized.matchAll(/add_job\(\s*'([^']+)'/gi);
		for (const match of nestedJobMatches) {
			const jobName = match[1];
			if (jobName) {
				pushUnique(compatInventory.jobs, jobName);
			}
		}
	}
}

function parseCreateTableStatement(
	tableName: string,
	body: string,
	tables: Map<string, TableDefinition>
): void {
	const table = ensureTable(tables, tableName);
	const parts = splitTopLevel(body);

	for (const part of parts) {
		if (!part) {
			continue;
		}

		const primaryKeyMatch = part.match(
			/^(?:CONSTRAINT\s+[a-zA-Z_][a-zA-Z0-9_]*\s+)?PRIMARY KEY\s*\(([\s\S]+)\)$/i
		);
		if (primaryKeyMatch) {
			table.primaryKey = parseColumnList(getMatchGroup(primaryKeyMatch, 1));
			continue;
		}

		const uniqueConstraintMatch = part.match(
			/^(?:CONSTRAINT\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+)?UNIQUE\s*\(([\s\S]+)\)$/i
		);
		if (uniqueConstraintMatch) {
			const constraintName = uniqueConstraintMatch[1];
			const rawColumns = getMatchGroup(uniqueConstraintMatch, 2);
			upsertIndex(table.uniqueConstraints, {
				columns: parseColumnList(rawColumns),
				name: constraintName ?? `${tableName}_unique_${table.uniqueConstraints.length + 1}`,
				unique: true,
			});
			continue;
		}

		const column = parseColumnDefinition(part);
		if (!column) {
			continue;
		}

		upsertColumn(table, column);
		if (column.primaryKey && table.primaryKey.length === 0) {
			table.primaryKey = [column.name];
		}
	}
}

function parseAlterTableStatement(
	tableName: string,
	operations: string,
	tables: Map<string, TableDefinition>
): void {
	const table = ensureTable(tables, tableName);
	const parts = splitTopLevel(operations);

	for (const part of parts) {
		const normalized = part
			.trim()
			.replace(/^BEGIN\b/i, '')
			.trim();
		if (!normalized) {
			continue;
		}

		const addColumnMatch = normalized.match(
			/^ADD COLUMN(?: IF NOT EXISTS)?\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+([\s\S]+)$/i
		);
		if (addColumnMatch) {
			const columnName = getMatchGroup(addColumnMatch, 1);
			const columnRest = getMatchGroup(addColumnMatch, 2);
			const column = parseColumnDefinition(`${columnName} ${columnRest}`);
			if (column) {
				upsertColumn(table, column);
			}
			continue;
		}

		const alterColumnNotNullMatch = normalized.match(
			/^ALTER COLUMN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+SET NOT NULL$/i
		);
		if (alterColumnNotNullMatch) {
			const columnName = getMatchGroup(alterColumnNotNullMatch, 1);
			const existingColumn = table.columns.find((column) => column.name === columnName);
			if (existingColumn) {
				existingColumn.notNull = true;
			}
			continue;
		}

		const alterColumnTypeMatch = normalized.match(
			/^ALTER COLUMN\s+([a-zA-Z_][a-zA-Z0-9_]*)\s+TYPE\s+([\s\S]+)$/i
		);
		if (alterColumnTypeMatch) {
			const columnName = getMatchGroup(alterColumnTypeMatch, 1);
			const rawType = getMatchGroup(alterColumnTypeMatch, 2);
			const existingColumn = table.columns.find((column) => column.name === columnName);
			if (!existingColumn) {
				continue;
			}

			const { precision, scale, type } = parseTypeDescriptor(rawType);
			existingColumn.type = type;
			existingColumn.precision = precision;
			existingColumn.scale = scale;
		}
	}
}

function parseColumnDefinition(part: string): ColumnDefinition | null {
	const trimmed = part.trim();
	const columnNameMatch = trimmed.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+([\s\S]+)$/);
	if (!columnNameMatch) {
		return null;
	}

	const name = getMatchGroup(columnNameMatch, 1);
	const remainder = getMatchGroup(columnNameMatch, 2);
	const typeMatch = remainder.match(
		/^(BIGSERIAL|BIGINT|BOOLEAN|INTEGER|JSONB|NUMERIC(?:\(\s*\d+\s*(?:,\s*\d+\s*)?\))?|TEXT|TIMESTAMPTZ)\b/i
	);

	if (!typeMatch) {
		return null;
	}

	const { precision, scale, type } = parseTypeDescriptor(getMatchGroup(typeMatch, 1));

	return {
		defaultValue: parseColumnDefault(type, remainder),
		generated: /\bGENERATED ALWAYS AS\b/i.test(remainder),
		name,
		notNull: /\bNOT NULL\b/i.test(remainder) || /\bPRIMARY KEY\b/i.test(remainder),
		precision,
		primaryKey: /\bPRIMARY KEY\b/i.test(remainder),
		scale,
		type,
	};
}

function parseTypeDescriptor(rawType: string): {
	precision?: number;
	scale?: number;
	type: SupportedColumnType;
} {
	const normalizedRawType = rawType.trim().toUpperCase();
	const precisionScaleMatch = normalizedRawType.match(/^NUMERIC\(\s*(\d+)\s*(?:,\s*(\d+)\s*)?\)$/);

	return {
		precision: precisionScaleMatch?.[1] ? Number.parseInt(precisionScaleMatch[1], 10) : undefined,
		scale: precisionScaleMatch?.[2] ? Number.parseInt(precisionScaleMatch[2], 10) : undefined,
		type: normalizeColumnType(normalizedRawType),
	};
}

function normalizeColumnType(rawType: string): SupportedColumnType {
	if (rawType.startsWith('NUMERIC')) {
		return 'numeric';
	}

	switch (rawType) {
		case 'BIGINT':
			return 'bigint';
		case 'BIGSERIAL':
			return 'bigserial';
		case 'BOOLEAN':
			return 'boolean';
		case 'INTEGER':
			return 'integer';
		case 'JSONB':
			return 'jsonb';
		case 'TEXT':
			return 'text';
		case 'TIMESTAMPTZ':
			return 'timestamptz';
		default:
			throw new Error(`Unsupported column type: ${rawType}`);
	}
}

function parseColumnDefault(
	type: SupportedColumnType,
	remainder: string
): ColumnDefault | undefined {
	if (!/\bDEFAULT\b/i.test(remainder)) {
		return undefined;
	}

	if (type === 'timestamptz' && /\bDEFAULT\s+NOW\(\)/i.test(remainder)) {
		return { kind: 'now' };
	}

	if (type === 'boolean') {
		const booleanMatch = remainder.match(/\bDEFAULT\s+(true|false)\b/i);
		const booleanValue = booleanMatch?.[1];
		if (booleanValue) {
			return { kind: 'boolean', value: booleanValue.toLowerCase() === 'true' };
		}
	}

	if (type === 'integer') {
		const integerMatch = remainder.match(/\bDEFAULT\s+(-?\d+)\b/i);
		const integerValue = integerMatch?.[1];
		if (integerValue) {
			return { kind: 'integer', value: Number.parseInt(integerValue, 10) };
		}
	}

	if (type === 'text') {
		const textMatch = remainder.match(/\bDEFAULT\s+'((?:''|[^'])*)'/i);
		const textValue = textMatch?.[1];
		if (textValue) {
			return { kind: 'text', value: textValue.replaceAll("''", "'") };
		}
	}

	return undefined;
}

function ensureTable(tables: Map<string, TableDefinition>, tableName: string): TableDefinition {
	const existing = tables.get(tableName);
	if (existing) {
		return existing;
	}

	const created: TableDefinition = {
		columns: [],
		indexes: [],
		name: tableName,
		primaryKey: [],
		uniqueConstraints: [],
	};
	tables.set(tableName, created);
	return created;
}

function upsertColumn(table: TableDefinition, column: ColumnDefinition): void {
	const existing = table.columns.find((candidate) => candidate.name === column.name);
	if (!existing) {
		table.columns.push(column);
		return;
	}

	existing.defaultValue ??= column.defaultValue;
	existing.generated ||= column.generated;
	existing.notNull ||= column.notNull;
	existing.precision = column.precision ?? existing.precision;
	existing.primaryKey ||= column.primaryKey;
	existing.scale = column.scale ?? existing.scale;
	existing.type = column.type;
}

function upsertIndex(indexes: IndexDefinition[], nextIndex: IndexDefinition): void {
	const existingIndex = indexes.find((candidate) => candidate.name === nextIndex.name);
	if (!existingIndex) {
		indexes.push(nextIndex);
		return;
	}

	existingIndex.columns = nextIndex.columns;
	existingIndex.unique = nextIndex.unique;
}

function parseIndexColumns(rawColumns: string): string[] {
	return splitTopLevel(rawColumns)
		.map((part) => part.trim())
		.map((part) => part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)/))
		.flatMap((match) => {
			const columnName = match?.[1];
			return columnName ? [columnName] : [];
		});
}

function parseColumnList(rawColumns: string): string[] {
	return splitTopLevel(rawColumns)
		.map((part) => part.trim())
		.map((part) => part.replaceAll('"', ''))
		.filter((part): part is string => part.length > 0);
}

function splitStatements(sql: string): string[] {
	const sanitized = stripSqlComments(sql);
	const statements: string[] = [];
	let current = '';
	let singleQuote = false;
	let doubleQuote = false;
	let dollarQuoteTag: string | null = null;

	for (let index = 0; index < sanitized.length; index += 1) {
		const character = sanitized[index];
		const nextCharacter = sanitized[index + 1];

		if (dollarQuoteTag) {
			current += character;
			if (sanitized.startsWith(dollarQuoteTag, index)) {
				const remainder = dollarQuoteTag.slice(1);
				current += remainder;
				index += dollarQuoteTag.length - 1;
				dollarQuoteTag = null;
			}
			continue;
		}

		if (singleQuote) {
			current += character;
			if (character === "'" && nextCharacter === "'") {
				current += nextCharacter;
				index += 1;
				continue;
			}
			if (character === "'") {
				singleQuote = false;
			}
			continue;
		}

		if (doubleQuote) {
			current += character;
			if (character === '"') {
				doubleQuote = false;
			}
			continue;
		}

		if (character === "'") {
			singleQuote = true;
			current += character;
			continue;
		}

		if (character === '"') {
			doubleQuote = true;
			current += character;
			continue;
		}

		if (character === '$') {
			const dollarTagMatch = sanitized.slice(index).match(/^\$[a-zA-Z0-9_]*\$/);
			if (dollarTagMatch) {
				dollarQuoteTag = dollarTagMatch[0];
				current += dollarQuoteTag;
				index += dollarQuoteTag.length - 1;
				continue;
			}
		}

		if (character === ';') {
			const trimmed = current.trim();
			if (trimmed) {
				statements.push(trimmed);
			}
			current = '';
			continue;
		}

		current += character;
	}

	const trailing = current.trim();
	if (trailing) {
		statements.push(trailing);
	}

	return statements;
}

function stripSqlComments(sql: string): string {
	let result = '';
	let singleQuote = false;
	let doubleQuote = false;
	let dollarQuoteTag: string | null = null;

	for (let index = 0; index < sql.length; index += 1) {
		const character = sql[index];
		const nextCharacter = sql[index + 1];

		if (dollarQuoteTag) {
			result += character;
			if (sql.startsWith(dollarQuoteTag, index)) {
				const remainder = dollarQuoteTag.slice(1);
				result += remainder;
				index += dollarQuoteTag.length - 1;
				dollarQuoteTag = null;
			}
			continue;
		}

		if (singleQuote) {
			result += character;
			if (character === "'" && nextCharacter === "'") {
				result += nextCharacter;
				index += 1;
				continue;
			}
			if (character === "'") {
				singleQuote = false;
			}
			continue;
		}

		if (doubleQuote) {
			result += character;
			if (character === '"') {
				doubleQuote = false;
			}
			continue;
		}

		if (character === "'") {
			singleQuote = true;
			result += character;
			continue;
		}

		if (character === '"') {
			doubleQuote = true;
			result += character;
			continue;
		}

		if (character === '$') {
			const dollarTagMatch = sql.slice(index).match(/^\$[a-zA-Z0-9_]*\$/);
			if (dollarTagMatch) {
				dollarQuoteTag = dollarTagMatch[0];
				result += dollarQuoteTag;
				index += dollarQuoteTag.length - 1;
				continue;
			}
		}

		if (character === '-' && nextCharacter === '-') {
			while (index < sql.length && sql[index] !== '\n') {
				index += 1;
			}
			result += '\n';
			continue;
		}

		if (character === '/' && nextCharacter === '*') {
			index += 2;
			while (index < sql.length && !(sql[index] === '*' && sql[index + 1] === '/')) {
				index += 1;
			}
			index += 1;
			continue;
		}

		result += character;
	}

	return result;
}

function splitTopLevel(value: string): string[] {
	const parts: string[] = [];
	let current = '';
	let depth = 0;
	let singleQuote = false;
	let doubleQuote = false;
	let dollarQuoteTag: string | null = null;

	for (let index = 0; index < value.length; index += 1) {
		const character = value[index];
		const nextCharacter = value[index + 1];

		if (dollarQuoteTag) {
			current += character;
			if (value.startsWith(dollarQuoteTag, index)) {
				const remainder = dollarQuoteTag.slice(1);
				current += remainder;
				index += dollarQuoteTag.length - 1;
				dollarQuoteTag = null;
			}
			continue;
		}

		if (singleQuote) {
			current += character;
			if (character === "'" && nextCharacter === "'") {
				current += nextCharacter;
				index += 1;
				continue;
			}
			if (character === "'") {
				singleQuote = false;
			}
			continue;
		}

		if (doubleQuote) {
			current += character;
			if (character === '"') {
				doubleQuote = false;
			}
			continue;
		}

		if (character === "'") {
			singleQuote = true;
			current += character;
			continue;
		}

		if (character === '"') {
			doubleQuote = true;
			current += character;
			continue;
		}

		if (character === '$') {
			const dollarTagMatch = value.slice(index).match(/^\$[a-zA-Z0-9_]*\$/);
			if (dollarTagMatch) {
				dollarQuoteTag = dollarTagMatch[0];
				current += dollarQuoteTag;
				index += dollarQuoteTag.length - 1;
				continue;
			}
		}

		if (character === '(') {
			depth += 1;
			current += character;
			continue;
		}

		if (character === ')') {
			depth -= 1;
			current += character;
			continue;
		}

		if (character === ',' && depth === 0) {
			const trimmed = current.trim();
			if (trimmed) {
				parts.push(trimmed);
			}
			current = '';
			continue;
		}

		current += character;
	}

	const trailing = current.trim();
	if (trailing) {
		parts.push(trailing);
	}

	return parts;
}

function pushUnique(values: string[], value: string): void {
	if (!values.includes(value)) {
		values.push(value);
	}
}

function getMatchGroup(match: RegExpMatchArray, index: number): string {
	const value = match[index];
	if (!value) {
		throw new Error(`Expected regex capture group ${index} to be present`);
	}

	return value;
}
