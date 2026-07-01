import {
	type ListPositionChangeAggregateRowsInput,
	type ListPositionChangeRowsInput,
	type ListSharePriceStatsRowsInput,
	type ListSignalAggregateRowsInput,
	listPositionChangeDailyRows,
	listPositionChangeHourlyRows,
	listPositionChangeRows,
	listSharePriceStatsDailyRows,
	listSharePriceStatsHourlyRows,
	listSignalDailyRows,
	listSignalHourlyRows,
} from '../../src/actions';
import { createTimescaleConnection } from '../../src/client';
import {
	type AccountPnlSnapshotRow,
	account_pnl_snapshot,
	type DepositedEventsRow,
	deposited_events,
	type EventStoreRow,
	event_store,
	type PositionChangeDailyRow,
	type PositionChangeHourlyRow,
	type PositionChangeRow,
	type PositionCumulativeHourlyRow,
	position_change,
	position_change_daily,
	position_change_hourly,
	position_cumulative_hourly,
	type RedeemedEventsRow,
	redeemed_events,
	type SharePriceChangedEventsRow,
	type SharePriceHistoryRow,
	type SharePriceStatsDailyRow,
	type SharePriceStatsHourlyRow,
	type SignalDailyRow,
	type SignalHourlyRow,
	type SignalRow,
	type StatsHistoryRow,
	share_price_changed_events,
	share_price_history,
	share_price_stats_daily,
	share_price_stats_hourly,
	signal,
	signal_daily,
	signal_hourly,
	stats_history,
	type TermMarketCapHistoryRow,
	term_market_cap_history,
} from '../../src/schema';

const positionChangeInput: ListPositionChangeRowsInput = {
	accountId: '0xabc',
	limit: 5,
};

const positionChangeAggregateInput: ListPositionChangeAggregateRowsInput = {
	curveId: 'curve-1',
	limit: 24,
	termId: 'term-1',
};

const sharePriceStatsInput: ListSharePriceStatsRowsInput = {
	curveId: 'curve-1',
	limit: 24,
	termId: 'term-1',
};

const signalAggregateInput: ListSignalAggregateRowsInput = {
	accountId: '0xabc',
	limit: 24,
	signalType: 'buy',
};

async function typecheckFixtures(): Promise<void> {
	const connection = createTimescaleConnection({
		connectionString: 'postgres://user:password@127.0.0.1:5432/blockchain_events',
		max: 1,
	});

	const positionChanges: PositionChangeRow[] = await listPositionChangeRows(
		connection.db,
		positionChangeInput
	);
	const positionChangeHourly: PositionChangeHourlyRow[] = await listPositionChangeHourlyRows(
		connection.db,
		positionChangeAggregateInput
	);
	const positionChangeDaily: PositionChangeDailyRow[] = await listPositionChangeDailyRows(
		connection.db,
		positionChangeAggregateInput
	);
	const sharePriceStatsHourly: SharePriceStatsHourlyRow[] = await listSharePriceStatsHourlyRows(
		connection.db,
		sharePriceStatsInput
	);
	const sharePriceStatsDaily: SharePriceStatsDailyRow[] = await listSharePriceStatsDailyRows(
		connection.db,
		sharePriceStatsInput
	);
	const signalHourly: SignalHourlyRow[] = await listSignalHourlyRows(
		connection.db,
		signalAggregateInput
	);
	const signalDaily: SignalDailyRow[] = await listSignalDailyRows(
		connection.db,
		signalAggregateInput
	);

	const positionChange = positionChanges[0];
	if (positionChange) {
		const eventId: string = positionChange.eventId;
		const timestamp: Date = positionChange.ts;
		void eventId;
		void timestamp;
	}

	const dailyPrice = sharePriceStatsDaily[0];
	if (dailyPrice) {
		const bucket: Date | null = dailyPrice.bucket;
		const closePrice: string | null = dailyPrice.closePrice;
		void bucket;
		void closePrice;
	}

	const hourlySignal = signalHourly[0];
	if (hourlySignal) {
		const signalType: string | null = hourlySignal.signalType;
		const numSignals: bigint | null = hourlySignal.numSignals;
		void signalType;
		void numSignals;
	}

	const accountPnlSnapshotRows: AccountPnlSnapshotRow[] = await connection.db
		.select()
		.from(account_pnl_snapshot)
		.limit(1);
	const depositedEventRows: DepositedEventsRow[] = await connection.db
		.select()
		.from(deposited_events)
		.limit(1);
	const eventStoreRows: EventStoreRow[] = await connection.db.select().from(event_store).limit(1);
	const positionCumulativeHourlyRows: PositionCumulativeHourlyRow[] = await connection.db
		.select()
		.from(position_cumulative_hourly)
		.limit(1);
	const redeemedEventRows: RedeemedEventsRow[] = await connection.db
		.select()
		.from(redeemed_events)
		.limit(1);
	const sharePriceChangedEventRows: SharePriceChangedEventsRow[] = await connection.db
		.select()
		.from(share_price_changed_events)
		.limit(1);
	const sharePriceHistoryRows: SharePriceHistoryRow[] = await connection.db
		.select()
		.from(share_price_history)
		.limit(1);
	const signalRows: SignalRow[] = await connection.db.select().from(signal).limit(1);
	const statsHistoryRows: StatsHistoryRow[] = await connection.db
		.select()
		.from(stats_history)
		.limit(1);
	const termMarketCapHistoryRows: TermMarketCapHistoryRow[] = await connection.db
		.select()
		.from(term_market_cap_history)
		.limit(1);

	await connection.db.select().from(position_change).limit(1);
	await connection.db.select().from(position_change_hourly).limit(1);
	await connection.db.select().from(position_change_daily).limit(1);
	await connection.db.select().from(share_price_stats_hourly).limit(1);
	await connection.db.select().from(share_price_stats_daily).limit(1);
	await connection.db.select().from(signal_hourly).limit(1);
	await connection.db.select().from(signal_daily).limit(1);

	void accountPnlSnapshotRows;
	void depositedEventRows;
	void eventStoreRows;
	void positionCumulativeHourlyRows;
	void redeemedEventRows;
	void sharePriceChangedEventRows;
	void sharePriceHistoryRows;
	void signalRows;
	void signalDaily;
	void positionChangeHourly;
	void positionChangeDaily;
	void sharePriceStatsHourly;
	void statsHistoryRows;
	void termMarketCapHistoryRows;

	await connection.close();
}

void typecheckFixtures;
