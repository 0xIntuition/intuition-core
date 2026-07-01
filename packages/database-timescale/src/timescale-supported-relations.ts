import type { ManifestColumn } from './timescale-generation/types';

export type SupportedTimescaleRelationKind = 'hypertable' | 'materializedView';

export type SupportedTimescaleRelationManifest =
	| {
			kind: 'hypertable';
			name: string;
	  }
	| {
			columns: readonly ManifestColumn[];
			kind: 'materializedView';
			name: string;
	  };

export const supportedTimescaleRelations = [
	{ kind: 'hypertable', name: 'account_pnl_snapshot' },
	{ kind: 'hypertable', name: 'deposited_events' },
	{ kind: 'hypertable', name: 'event_store' },
	{ kind: 'hypertable', name: 'position_change' },
	{ kind: 'hypertable', name: 'position_cumulative_hourly' },
	{ kind: 'hypertable', name: 'redeemed_events' },
	{ kind: 'hypertable', name: 'share_price_changed_events' },
	{ kind: 'hypertable', name: 'share_price_history' },
	{ kind: 'hypertable', name: 'signal' },
	{ kind: 'hypertable', name: 'stats_history' },
	{ kind: 'hypertable', name: 'term_market_cap_history' },
	{
		columns: [
			{ name: 'bucket', notNull: false, type: 'timestamptz' },
			{ name: 'account_id', notNull: false, type: 'text' },
			{ name: 'term_id', notNull: false, type: 'text' },
			{ name: 'curve_id', notNull: false, type: 'text' },
			{ name: 'shares_delta', notNull: false, type: 'numeric' },
			{ name: 'assets_in', notNull: false, type: 'numeric' },
			{ name: 'assets_out', notNull: false, type: 'numeric' },
			{ name: 'event_count', notNull: false, precision: 64, scale: 0, type: 'bigint' },
			{ name: 'shares_in', notNull: false, type: 'numeric' },
			{ name: 'shares_out', notNull: false, type: 'numeric' },
		],
		kind: 'materializedView',
		name: 'position_change_daily',
	},
	{
		columns: [
			{ name: 'bucket', notNull: false, type: 'timestamptz' },
			{ name: 'account_id', notNull: false, type: 'text' },
			{ name: 'term_id', notNull: false, type: 'text' },
			{ name: 'curve_id', notNull: false, type: 'text' },
			{ name: 'shares_delta', notNull: false, type: 'numeric' },
			{ name: 'assets_in', notNull: false, type: 'numeric' },
			{ name: 'assets_out', notNull: false, type: 'numeric' },
			{ name: 'event_count', notNull: false, precision: 64, scale: 0, type: 'bigint' },
			{ name: 'shares_in', notNull: false, type: 'numeric' },
			{ name: 'shares_out', notNull: false, type: 'numeric' },
		],
		kind: 'materializedView',
		name: 'position_change_hourly',
	},
	{
		columns: [
			{ name: 'bucket', notNull: false, type: 'timestamptz' },
			{ name: 'term_id', notNull: false, type: 'text' },
			{ name: 'curve_id', notNull: false, type: 'text' },
			{ name: 'open_price', notNull: false, type: 'numeric' },
			{ name: 'high_price', notNull: false, type: 'numeric' },
			{ name: 'low_price', notNull: false, type: 'numeric' },
			{ name: 'close_price', notNull: false, type: 'numeric' },
			{ name: 'total_assets', notNull: false, type: 'numeric' },
			{ name: 'total_shares', notNull: false, type: 'numeric' },
			{ name: 'market_cap', notNull: false, type: 'numeric' },
			{ name: 'num_changes', notNull: false, precision: 64, scale: 0, type: 'bigint' },
		],
		kind: 'materializedView',
		name: 'share_price_stats_daily',
	},
	{
		columns: [
			{ name: 'bucket', notNull: false, type: 'timestamptz' },
			{ name: 'term_id', notNull: false, type: 'text' },
			{ name: 'curve_id', notNull: false, type: 'text' },
			{ name: 'open_price', notNull: false, type: 'numeric' },
			{ name: 'high_price', notNull: false, type: 'numeric' },
			{ name: 'low_price', notNull: false, type: 'numeric' },
			{ name: 'close_price', notNull: false, type: 'numeric' },
			{ name: 'total_assets', notNull: false, type: 'numeric' },
			{ name: 'total_shares', notNull: false, type: 'numeric' },
			{ name: 'market_cap', notNull: false, type: 'numeric' },
			{ name: 'num_changes', notNull: false, precision: 64, scale: 0, type: 'bigint' },
		],
		kind: 'materializedView',
		name: 'share_price_stats_hourly',
	},
	{
		columns: [
			{ name: 'bucket', notNull: false, type: 'timestamptz' },
			{ name: 'account_id', notNull: false, type: 'text' },
			{ name: 'term_id', notNull: false, type: 'text' },
			{ name: 'curve_id', notNull: false, type: 'text' },
			{ name: 'signal_type', notNull: false, type: 'text' },
			{ name: 'total_delta', notNull: false, type: 'numeric' },
			{ name: 'num_signals', notNull: false, precision: 64, scale: 0, type: 'bigint' },
		],
		kind: 'materializedView',
		name: 'signal_daily',
	},
	{
		columns: [
			{ name: 'bucket', notNull: false, type: 'timestamptz' },
			{ name: 'account_id', notNull: false, type: 'text' },
			{ name: 'term_id', notNull: false, type: 'text' },
			{ name: 'curve_id', notNull: false, type: 'text' },
			{ name: 'signal_type', notNull: false, type: 'text' },
			{ name: 'total_delta', notNull: false, type: 'numeric' },
			{ name: 'num_signals', notNull: false, precision: 64, scale: 0, type: 'bigint' },
		],
		kind: 'materializedView',
		name: 'signal_hourly',
	},
] as const satisfies readonly SupportedTimescaleRelationManifest[];

export const hypertableSupport = {
	account_pnl_snapshot: 'supported',
	deposited_events: 'supported',
	event_store: 'supported',
	position_change: 'supported',
	position_cumulative_hourly: 'supported',
	redeemed_events: 'supported',
	share_price_changed_events: 'supported',
	share_price_history: 'supported',
	signal: 'supported',
	stats_history: 'supported',
	term_market_cap_history: 'supported',
} as const;

export const materializedViewSupport = {
	position_change_daily: 'supported',
	position_change_hourly: 'supported',
	share_price_stats_daily: 'supported',
	share_price_stats_hourly: 'supported',
	signal_daily: 'supported',
	signal_hourly: 'supported',
} as const;

export const supportedHypertableRelations = supportedTimescaleRelations.filter(
	(relation) => relation.kind === 'hypertable'
) as Extract<SupportedTimescaleRelationManifest, { kind: 'hypertable' }>[];

export const supportedMaterializedViewRelations = supportedTimescaleRelations.filter(
	(relation) => relation.kind === 'materializedView'
) as Extract<SupportedTimescaleRelationManifest, { kind: 'materializedView' }>[];

export function assertRegisteredHypertables(hypertables: Iterable<string>): void {
	const unregisteredHypertables = [...new Set(hypertables)].filter(
		(tableName) => !(tableName in hypertableSupport)
	);

	if (unregisteredHypertables.length === 0) {
		return;
	}

	throw new Error(
		`Unregistered hypertable discovered in migrations: ${unregisteredHypertables.join(
			', '
		)}. Classify it in packages/database-timescale/src/timescale-supported-relations.ts.`
	);
}

export function assertRegisteredMaterializedViews(materializedViews: Iterable<string>): void {
	const unregisteredMaterializedViews = [...new Set(materializedViews)].filter(
		(viewName) => !(viewName in materializedViewSupport)
	);

	if (unregisteredMaterializedViews.length === 0) {
		return;
	}

	throw new Error(
		`Unregistered materialized view discovered in migrations: ${unregisteredMaterializedViews.join(
			', '
		)}. Classify it in packages/database-timescale/src/timescale-supported-relations.ts.`
	);
}
