-- Bootstrap migration tracking. This file is idempotent — safe to re-run.
--
-- For existing environments where 001–027 are already applied, this seeds
-- the tracking table so the runner skips them on future deploys.
-- On fresh environments (no event_store table), nothing is seeded so all
-- migrations run normally.

CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Only seed prior migrations if this is an existing database.
-- We detect this by checking for the event_store table (created by 001).
-- On a fresh DB this INSERT is skipped entirely, so 001–027 run as normal.
INSERT INTO schema_migrations (filename)
SELECT unnest(ARRAY[
    '000_create_schema_migrations.sql',
    '001_create_event_store.sql',
    '002_create_typed_event_tables.sql',
    '003_create_projection_checkpoints.sql',
    '004_create_event_log_tables.sql',
    '005_create_account_table.sql',
    '006_create_term_table.sql',
    '007_create_vault_state_tables.sql',
    '008_create_position_tables.sql',
    '009_create_vault_holders_index.sql',
    '010_create_signals_tables.sql',
    '011_create_term_aggregates_tables.sql',
    '012_create_protocol_stats_tables.sql',
    '013_create_leaderboard_tables.sql',
    '014_add_event_id_to_term_market_cap_history.sql',
    '015_add_hypertable_event_id_indexes.sql',
    '016_create_position_change_hourly.sql',
    '017_create_pnl_leaderboard_period.sql',
    '018_rebuild_position_change_caggs.sql',
    '019_create_position_cumulative_hourly.sql',
    '020_create_cumulative_refresh.sql',
    '021_add_account_metadata_columns.sql',
    '022_replace_pnl_leaderboard_period.sql',
    '023_expand_leaderboard_cache.sql',
    '024_add_sequence_number_to_typed_tables.sql',
    '025_add_position_version.sql',
    '026_fix_leaderboard_functions.sql',
    '027_fix_timescaledb_job_signatures.sql'
])
WHERE EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'event_store')
ON CONFLICT DO NOTHING;
