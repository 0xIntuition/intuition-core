export type SupportedColumnType =
	| 'bigint'
	| 'bigserial'
	| 'boolean'
	| 'integer'
	| 'jsonb'
	| 'numeric'
	| 'text'
	| 'timestamptz';

export type ColumnDefault =
	| { kind: 'boolean'; value: boolean }
	| { kind: 'integer'; value: number }
	| { kind: 'now' }
	| { kind: 'text'; value: string };

export type ColumnDefinition = {
	defaultValue?: ColumnDefault;
	generated: boolean;
	name: string;
	notNull: boolean;
	precision?: number;
	primaryKey: boolean;
	scale?: number;
	type: SupportedColumnType;
};

export type IndexDefinition = {
	columns: string[];
	name: string;
	unique: boolean;
};

export type TableDefinition = {
	columns: ColumnDefinition[];
	indexes: IndexDefinition[];
	name: string;
	primaryKey: string[];
	uniqueConstraints: IndexDefinition[];
};

export type ManifestColumn = {
	name: string;
	notNull: boolean;
	precision?: number;
	scale?: number;
	type: SupportedColumnType;
};

export type ManifestRelation = {
	columns: ManifestColumn[];
	name: string;
};

export type ManifestTable = ManifestRelation & {
	primaryKey: string[];
};

export type CompatInventory = {
	continuousAggregates: string[];
	functions: string[];
	hypertables: string[];
	jobs: string[];
	materializedViews: string[];
	types: string[];
	views: string[];
};

export type MigrationSource = {
	fileName: string;
	sql: string;
};
