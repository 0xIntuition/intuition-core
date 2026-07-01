import { describe, expect, it } from 'bun:test';
import { parseTimescaleMigrations } from '../src/timescale-generation/parser';
import {
	assertRegisteredHypertables,
	assertRegisteredMaterializedViews,
} from '../src/timescale-supported-relations';

describe('timescale supported relations', () => {
	it('requires every hypertable from migrations to be explicitly classified', () => {
		const { compatInventory } = parseTimescaleMigrations([
			{
				fileName: 'sample.sql',
				sql: `
					CREATE TABLE IF NOT EXISTS sample_events (
						id BIGSERIAL PRIMARY KEY,
						ts TIMESTAMPTZ NOT NULL
					);

					SELECT create_hypertable('sample_events', 'ts', if_not_exists => TRUE);
				`,
			},
		]);

		expect(() => assertRegisteredHypertables(compatInventory.hypertables)).toThrow(/sample_events/);
	});

	it('requires every materialized view from migrations to be explicitly classified', () => {
		const { compatInventory } = parseTimescaleMigrations([
			{
				fileName: 'sample.sql',
				sql: `
					CREATE MATERIALIZED VIEW IF NOT EXISTS sample_hourly AS
					SELECT 1::bigint AS total
					WITH NO DATA;
				`,
			},
		]);

		expect(() => assertRegisteredMaterializedViews(compatInventory.materializedViews)).toThrow(
			/sample_hourly/
		);
	});
});
