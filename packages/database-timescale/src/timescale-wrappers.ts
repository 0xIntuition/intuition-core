import { bigint, numeric, text, timestamp } from 'drizzle-orm/pg-core';
import { defineExistingTimescaleMaterializedView } from './drizzle/materialized-view';
import { accountPnlSnapshot } from './schemas/timescale/accounts';
import {
	depositedEvents,
	eventStore,
	redeemedEvents,
	sharePriceChangedEvents,
} from './schemas/timescale/events';
import { positionChange, positionCumulativeHourly } from './schemas/timescale/positions';
import { statsHistory } from './schemas/timescale/stats';
import { termMarketCapHistory } from './schemas/timescale/terms';
import { sharePriceHistory } from './schemas/timescale/vaults';

const defineSharePriceStatsMaterializedView = (
	name: 'share_price_stats_hourly' | 'share_price_stats_daily'
) =>
	defineExistingTimescaleMaterializedView(name, {
		bucket: timestamp('bucket', { withTimezone: true }),
		termId: text('term_id'),
		curveId: text('curve_id'),
		openPrice: numeric('open_price'),
		highPrice: numeric('high_price'),
		lowPrice: numeric('low_price'),
		closePrice: numeric('close_price'),
		totalAssets: numeric('total_assets'),
		totalShares: numeric('total_shares'),
		marketCap: numeric('market_cap'),
		numChanges: bigint('num_changes', { mode: 'bigint' }),
	});

const definePositionChangeAggregateMaterializedView = (
	name: 'position_change_hourly' | 'position_change_daily'
) =>
	defineExistingTimescaleMaterializedView(name, {
		bucket: timestamp('bucket', { withTimezone: true }),
		accountId: text('account_id'),
		termId: text('term_id'),
		curveId: text('curve_id'),
		sharesDelta: numeric('shares_delta'),
		assetsIn: numeric('assets_in'),
		assetsOut: numeric('assets_out'),
		eventCount: bigint('event_count', { mode: 'bigint' }),
		sharesIn: numeric('shares_in'),
		sharesOut: numeric('shares_out'),
	});

const defineSignalAggregateMaterializedView = (name: 'signal_hourly' | 'signal_daily') =>
	defineExistingTimescaleMaterializedView(name, {
		bucket: timestamp('bucket', { withTimezone: true }),
		accountId: text('account_id'),
		termId: text('term_id'),
		curveId: text('curve_id'),
		signalType: text('signal_type'),
		totalDelta: numeric('total_delta'),
		numSignals: bigint('num_signals', { mode: 'bigint' }),
	});

export const account_pnl_snapshot = accountPnlSnapshot;
export const deposited_events = depositedEvents;
export const event_store = eventStore;
export const position_change = positionChange;
export const position_cumulative_hourly = positionCumulativeHourly;
export const redeemed_events = redeemedEvents;
export const share_price_changed_events = sharePriceChangedEvents;
export const share_price_history = sharePriceHistory;
export const stats_history = statsHistory;
export const term_market_cap_history = termMarketCapHistory;

export const position_change_daily =
	definePositionChangeAggregateMaterializedView('position_change_daily');
export const position_change_hourly =
	definePositionChangeAggregateMaterializedView('position_change_hourly');
export const share_price_stats_daily =
	defineSharePriceStatsMaterializedView('share_price_stats_daily');
export const share_price_stats_hourly = defineSharePriceStatsMaterializedView(
	'share_price_stats_hourly'
);
export const signal_daily = defineSignalAggregateMaterializedView('signal_daily');
export const signal_hourly = defineSignalAggregateMaterializedView('signal_hourly');
