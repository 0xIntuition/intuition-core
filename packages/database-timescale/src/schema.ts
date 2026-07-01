import type { InferSelectViewModel } from 'drizzle-orm';

export * from './schemas/timescale';
export * from './timescale-wrappers';

import type { signal } from './schemas/timescale/signals';
import type { stats } from './schemas/timescale/stats';
import type { vault } from './schemas/timescale/vaults';
import type {
	account_pnl_snapshot,
	deposited_events,
	event_store,
	position_change,
	position_change_daily,
	position_change_hourly,
	position_cumulative_hourly,
	redeemed_events,
	share_price_changed_events,
	share_price_history,
	share_price_stats_daily,
	share_price_stats_hourly,
	signal_daily,
	signal_hourly,
	stats_history,
	term_market_cap_history,
} from './timescale-wrappers';

export type VaultRow = typeof vault.$inferSelect;
export type StatsRow = typeof stats.$inferSelect;

export type AccountPnlSnapshotRow = typeof account_pnl_snapshot.$inferSelect;
export type DepositedEventsRow = typeof deposited_events.$inferSelect;
export type EventStoreRow = typeof event_store.$inferSelect;
export type PositionChangeRow = typeof position_change.$inferSelect;
export type PositionCumulativeHourlyRow = typeof position_cumulative_hourly.$inferSelect;
export type RedeemedEventsRow = typeof redeemed_events.$inferSelect;
export type SharePriceChangedEventsRow = typeof share_price_changed_events.$inferSelect;
export type SharePriceHistoryRow = typeof share_price_history.$inferSelect;
export type SignalRow = typeof signal.$inferSelect;
export type StatsHistoryRow = typeof stats_history.$inferSelect;
export type TermMarketCapHistoryRow = typeof term_market_cap_history.$inferSelect;

export type PositionChangeDailyRow = InferSelectViewModel<typeof position_change_daily>;
export type PositionChangeHourlyRow = InferSelectViewModel<typeof position_change_hourly>;
export type SharePriceStatsDailyRow = InferSelectViewModel<typeof share_price_stats_daily>;
export type SharePriceStatsHourlyRow = InferSelectViewModel<typeof share_price_stats_hourly>;
export type SignalDailyRow = InferSelectViewModel<typeof signal_daily>;
export type SignalHourlyRow = InferSelectViewModel<typeof signal_hourly>;
