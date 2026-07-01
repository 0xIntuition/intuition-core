import { and, desc, eq, gte, lte } from 'drizzle-orm';
import { createTimescaleConnection, type TimescaleDb } from './client';
import { createEnvTimescaleConnection, getTimescaleConnectionString } from './client-env';
import {
	type PositionChangeDailyRow,
	type PositionChangeHourlyRow,
	type PositionChangeRow,
	position_change,
	position_change_daily,
	position_change_hourly,
	type SharePriceStatsDailyRow,
	type SharePriceStatsHourlyRow,
	type SignalDailyRow,
	type SignalHourlyRow,
	share_price_stats_daily,
	share_price_stats_hourly,
	signal_daily,
	signal_hourly,
} from './schema';

export type ListPositionChangeRowsInput = {
	accountId?: string;
	curveId?: string;
	fromTs?: Date;
	limit?: number;
	termId?: string;
	toTs?: Date;
};

export type ListPositionChangeAggregateRowsInput = {
	accountId?: string;
	curveId?: string;
	fromBucket?: Date;
	limit?: number;
	termId?: string;
	toBucket?: Date;
};

export type ListSharePriceStatsRowsInput = {
	curveId?: string;
	fromBucket?: Date;
	limit?: number;
	termId?: string;
	toBucket?: Date;
};

export type ListSignalAggregateRowsInput = {
	accountId?: string;
	curveId?: string;
	fromBucket?: Date;
	limit?: number;
	signalType?: string;
	termId?: string;
	toBucket?: Date;
};

export type RefreshMaterializedViewOptions = {
	concurrently?: boolean;
	withNoData?: boolean;
};

export async function listPositionChangeRows(
	db: TimescaleDb,
	input: ListPositionChangeRowsInput = {}
): Promise<PositionChangeRow[]> {
	const filters = [
		input.accountId ? eq(position_change.accountId, input.accountId) : undefined,
		input.termId ? eq(position_change.termId, input.termId) : undefined,
		input.curveId ? eq(position_change.curveId, input.curveId) : undefined,
		input.fromTs ? gte(position_change.ts, input.fromTs) : undefined,
		input.toTs ? lte(position_change.ts, input.toTs) : undefined,
	].filter((value) => value !== undefined);

	if (filters.length === 0) {
		return db
			.select()
			.from(position_change)
			.orderBy(desc(position_change.ts))
			.limit(input.limit ?? 100);
	}

	return db
		.select()
		.from(position_change)
		.where(and(...filters))
		.orderBy(desc(position_change.ts))
		.limit(input.limit ?? 100);
}

export async function listPositionChangeHourlyRows(
	db: TimescaleDb,
	input: ListPositionChangeAggregateRowsInput = {}
): Promise<PositionChangeHourlyRow[]> {
	const filters = [
		input.accountId ? eq(position_change_hourly.accountId, input.accountId) : undefined,
		input.termId ? eq(position_change_hourly.termId, input.termId) : undefined,
		input.curveId ? eq(position_change_hourly.curveId, input.curveId) : undefined,
		input.fromBucket ? gte(position_change_hourly.bucket, input.fromBucket) : undefined,
		input.toBucket ? lte(position_change_hourly.bucket, input.toBucket) : undefined,
	].filter((value) => value !== undefined);

	if (filters.length === 0) {
		return db
			.select()
			.from(position_change_hourly)
			.orderBy(desc(position_change_hourly.bucket))
			.limit(input.limit ?? 100);
	}

	return db
		.select()
		.from(position_change_hourly)
		.where(and(...filters))
		.orderBy(desc(position_change_hourly.bucket))
		.limit(input.limit ?? 100);
}

export async function listPositionChangeDailyRows(
	db: TimescaleDb,
	input: ListPositionChangeAggregateRowsInput = {}
): Promise<PositionChangeDailyRow[]> {
	const filters = [
		input.accountId ? eq(position_change_daily.accountId, input.accountId) : undefined,
		input.termId ? eq(position_change_daily.termId, input.termId) : undefined,
		input.curveId ? eq(position_change_daily.curveId, input.curveId) : undefined,
		input.fromBucket ? gte(position_change_daily.bucket, input.fromBucket) : undefined,
		input.toBucket ? lte(position_change_daily.bucket, input.toBucket) : undefined,
	].filter((value) => value !== undefined);

	if (filters.length === 0) {
		return db
			.select()
			.from(position_change_daily)
			.orderBy(desc(position_change_daily.bucket))
			.limit(input.limit ?? 100);
	}

	return db
		.select()
		.from(position_change_daily)
		.where(and(...filters))
		.orderBy(desc(position_change_daily.bucket))
		.limit(input.limit ?? 100);
}

export async function listSharePriceStatsHourlyRows(
	db: TimescaleDb,
	input: ListSharePriceStatsRowsInput = {}
): Promise<SharePriceStatsHourlyRow[]> {
	const filters = [
		input.termId ? eq(share_price_stats_hourly.termId, input.termId) : undefined,
		input.curveId ? eq(share_price_stats_hourly.curveId, input.curveId) : undefined,
		input.fromBucket ? gte(share_price_stats_hourly.bucket, input.fromBucket) : undefined,
		input.toBucket ? lte(share_price_stats_hourly.bucket, input.toBucket) : undefined,
	].filter((value) => value !== undefined);

	if (filters.length === 0) {
		return db
			.select()
			.from(share_price_stats_hourly)
			.orderBy(desc(share_price_stats_hourly.bucket))
			.limit(input.limit ?? 100);
	}

	return db
		.select()
		.from(share_price_stats_hourly)
		.where(and(...filters))
		.orderBy(desc(share_price_stats_hourly.bucket))
		.limit(input.limit ?? 100);
}

export async function listSharePriceStatsDailyRows(
	db: TimescaleDb,
	input: ListSharePriceStatsRowsInput = {}
): Promise<SharePriceStatsDailyRow[]> {
	const filters = [
		input.termId ? eq(share_price_stats_daily.termId, input.termId) : undefined,
		input.curveId ? eq(share_price_stats_daily.curveId, input.curveId) : undefined,
		input.fromBucket ? gte(share_price_stats_daily.bucket, input.fromBucket) : undefined,
		input.toBucket ? lte(share_price_stats_daily.bucket, input.toBucket) : undefined,
	].filter((value) => value !== undefined);

	if (filters.length === 0) {
		return db
			.select()
			.from(share_price_stats_daily)
			.orderBy(desc(share_price_stats_daily.bucket))
			.limit(input.limit ?? 100);
	}

	return db
		.select()
		.from(share_price_stats_daily)
		.where(and(...filters))
		.orderBy(desc(share_price_stats_daily.bucket))
		.limit(input.limit ?? 100);
}

export async function listSignalHourlyRows(
	db: TimescaleDb,
	input: ListSignalAggregateRowsInput = {}
): Promise<SignalHourlyRow[]> {
	const filters = [
		input.accountId ? eq(signal_hourly.accountId, input.accountId) : undefined,
		input.termId ? eq(signal_hourly.termId, input.termId) : undefined,
		input.curveId ? eq(signal_hourly.curveId, input.curveId) : undefined,
		input.signalType ? eq(signal_hourly.signalType, input.signalType) : undefined,
		input.fromBucket ? gte(signal_hourly.bucket, input.fromBucket) : undefined,
		input.toBucket ? lte(signal_hourly.bucket, input.toBucket) : undefined,
	].filter((value) => value !== undefined);

	if (filters.length === 0) {
		return db
			.select()
			.from(signal_hourly)
			.orderBy(desc(signal_hourly.bucket))
			.limit(input.limit ?? 100);
	}

	return db
		.select()
		.from(signal_hourly)
		.where(and(...filters))
		.orderBy(desc(signal_hourly.bucket))
		.limit(input.limit ?? 100);
}

export async function listSignalDailyRows(
	db: TimescaleDb,
	input: ListSignalAggregateRowsInput = {}
): Promise<SignalDailyRow[]> {
	const filters = [
		input.accountId ? eq(signal_daily.accountId, input.accountId) : undefined,
		input.termId ? eq(signal_daily.termId, input.termId) : undefined,
		input.curveId ? eq(signal_daily.curveId, input.curveId) : undefined,
		input.signalType ? eq(signal_daily.signalType, input.signalType) : undefined,
		input.fromBucket ? gte(signal_daily.bucket, input.fromBucket) : undefined,
		input.toBucket ? lte(signal_daily.bucket, input.toBucket) : undefined,
	].filter((value) => value !== undefined);

	if (filters.length === 0) {
		return db
			.select()
			.from(signal_daily)
			.orderBy(desc(signal_daily.bucket))
			.limit(input.limit ?? 100);
	}

	return db
		.select()
		.from(signal_daily)
		.where(and(...filters))
		.orderBy(desc(signal_daily.bucket))
		.limit(input.limit ?? 100);
}

export async function refreshPositionChangeHourly(
	db: TimescaleDb,
	options: RefreshMaterializedViewOptions = {}
): Promise<void> {
	await refreshMaterializedView(db, position_change_hourly, options);
}

export async function refreshPositionChangeDaily(
	db: TimescaleDb,
	options: RefreshMaterializedViewOptions = {}
): Promise<void> {
	await refreshMaterializedView(db, position_change_daily, options);
}

export async function refreshSharePriceStatsHourly(
	db: TimescaleDb,
	options: RefreshMaterializedViewOptions = {}
): Promise<void> {
	await refreshMaterializedView(db, share_price_stats_hourly, options);
}

export async function refreshSharePriceStatsDaily(
	db: TimescaleDb,
	options: RefreshMaterializedViewOptions = {}
): Promise<void> {
	await refreshMaterializedView(db, share_price_stats_daily, options);
}

export async function refreshSignalHourly(
	db: TimescaleDb,
	options: RefreshMaterializedViewOptions = {}
): Promise<void> {
	await refreshMaterializedView(db, signal_hourly, options);
}

export async function refreshSignalDaily(
	db: TimescaleDb,
	options: RefreshMaterializedViewOptions = {}
): Promise<void> {
	await refreshMaterializedView(db, signal_daily, options);
}

async function refreshMaterializedView(
	db: TimescaleDb,
	view:
		| typeof position_change_hourly
		| typeof position_change_daily
		| typeof share_price_stats_hourly
		| typeof share_price_stats_daily
		| typeof signal_hourly
		| typeof signal_daily,
	options: RefreshMaterializedViewOptions
): Promise<void> {
	let query = db.refreshMaterializedView(view);

	if (options.concurrently) {
		query = query.concurrently();
	}

	if (options.withNoData) {
		query = query.withNoData();
	}

	await query;
}

export type { TimescaleConnection, TimescaleDb } from './client';
export { createEnvTimescaleConnection, createTimescaleConnection, getTimescaleConnectionString };
