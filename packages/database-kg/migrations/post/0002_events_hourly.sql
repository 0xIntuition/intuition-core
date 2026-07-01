-- kg.events_hourly — hourly rollup of the graph mutation log.
--
-- Continuous aggregate over the kg.events hypertable, bucketed by hour and
-- grouped by entity kind + event type. Mirrors the production definition
-- (materialized-only, refreshed every 15 minutes over a trailing 3-hour
-- window). Applied only when the timescaledb extension is available — the
-- runner skips this file on plain Postgres.
--
-- Idempotent: IF NOT EXISTS / if_not_exists on both statements, since post
-- migrations re-run on every migrate.
CREATE MATERIALIZED VIEW IF NOT EXISTS kg.events_hourly
WITH (timescaledb.continuous, timescaledb.materialized_only = true) AS
SELECT
	time_bucket(INTERVAL '1 hour', event_time) AS bucket,
	entity_kind,
	event_type,
	count(*) AS event_count
FROM kg.events
GROUP BY bucket, entity_kind, event_type
WITH NO DATA;
--> statement-breakpoint
SELECT add_continuous_aggregate_policy(
	'kg.events_hourly',
	start_offset => INTERVAL '3 hours',
	end_offset => INTERVAL '15 minutes',
	schedule_interval => INTERVAL '15 minutes',
	if_not_exists => true
);
