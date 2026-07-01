export const timescaleFileGroups = [
	{
		fileName: 'events.ts',
		tableNames: [
			'projection_checkpoints',
			'event_store',
			'event',
			'deposit_fact',
			'redemption_fact',
			'fee_transfer_fact',
			'atom_created_events',
			'triple_created_events',
			'deposited_events',
			'redeemed_events',
			'share_price_changed_events',
			'protocol_fee_accrued_events',
		],
	},
	{
		fileName: 'accounts.ts',
		tableNames: [
			'account',
			'active_vault_position',
			'dirty_account',
			'account_stats',
			'account_pnl_state',
			'account_pnl_snapshot',
		],
	},
	{
		fileName: 'vaults.ts',
		tableNames: ['vault', 'share_price_history', 'dirty_vault'],
	},
	{
		fileName: 'positions.ts',
		tableNames: ['position', 'position_change', 'position_cumulative_hourly'],
	},
	{
		fileName: 'signals.ts',
		tableNames: ['signal'],
	},
	{
		fileName: 'terms.ts',
		tableNames: [
			'term',
			'term_summary',
			'term_market_cap_history',
			'predicate_object_summary',
			'subject_predicate_summary',
		],
	},
	{
		fileName: 'stats.ts',
		tableNames: ['stats', 'stats_history'],
	},
	{
		fileName: 'leaderboard.ts',
		tableNames: ['leaderboard_cache', 'leaderboard_cache_version'],
	},
] as const;

export type TimescaleFileGroup = (typeof timescaleFileGroups)[number];
