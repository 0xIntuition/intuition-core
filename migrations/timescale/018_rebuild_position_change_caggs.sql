-- Rebuild position_change_hourly and position_change_daily continuous aggregates
-- to add shares_in/shares_out columns needed for per-share cost basis in the
-- realized/unrealized PnL split.
--
-- DESTRUCTIVE: Drops and recreates both caggs. Requires full refresh after.
-- Also adds missing refresh policies for share_price_stats caggs.

-- ========================================
-- Step 1: Remove existing policies
-- ========================================
SELECT remove_continuous_aggregate_policy('position_change_daily', if_exists => true);
SELECT remove_continuous_aggregate_policy('position_change_hourly', if_exists => true);

-- ========================================
-- Step 2: Drop caggs (derived from raw hypertable, safe to recreate)
-- ========================================
DROP MATERIALIZED VIEW IF EXISTS position_change_daily CASCADE;
DROP MATERIALIZED VIEW IF EXISTS position_change_hourly CASCADE;

-- ========================================
-- Step 3: Recreate position_change_hourly with shares_in/shares_out
-- ========================================
CREATE MATERIALIZED VIEW IF NOT EXISTS position_change_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', ts) AS bucket,
    account_id,
    term_id,
    curve_id,
    SUM(shares_delta)               AS shares_delta,
    SUM(assets_in)                  AS assets_in,
    SUM(assets_out)                 AS assets_out,
    COUNT(*)                        AS event_count,
    SUM(GREATEST(shares_delta, 0))  AS shares_in,
    SUM(GREATEST(-shares_delta, 0)) AS shares_out
FROM position_change
GROUP BY bucket, account_id, term_id, curve_id
WITH NO DATA;

DO $$ BEGIN
    ALTER MATERIALIZED VIEW position_change_hourly
        SET (timescaledb.materialized_only = false);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT add_continuous_aggregate_policy('position_change_hourly',
    start_offset    => INTERVAL '3 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists   => TRUE
);

CREATE INDEX IF NOT EXISTS idx_pch_account_bucket
    ON position_change_hourly (account_id, term_id, curve_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_pch_term_bucket
    ON position_change_hourly (term_id, curve_id, bucket DESC);

-- ========================================
-- Step 4: Recreate position_change_daily
-- ========================================
CREATE MATERIALIZED VIEW IF NOT EXISTS position_change_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', ts) AS bucket,
    account_id,
    term_id,
    curve_id,
    SUM(shares_delta)               AS shares_delta,
    SUM(assets_in)                  AS assets_in,
    SUM(assets_out)                 AS assets_out,
    COUNT(*)                        AS event_count,
    SUM(GREATEST(shares_delta, 0))  AS shares_in,
    SUM(GREATEST(-shares_delta, 0)) AS shares_out
FROM position_change
GROUP BY bucket, account_id, term_id, curve_id
WITH NO DATA;

DO $$ BEGIN
    ALTER MATERIALIZED VIEW position_change_daily
        SET (timescaledb.materialized_only = false);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT add_continuous_aggregate_policy('position_change_daily',
    start_offset    => INTERVAL '3 days',
    end_offset      => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists   => TRUE
);

CREATE INDEX IF NOT EXISTS idx_pcd_account_bucket
    ON position_change_daily (account_id, bucket DESC);

CREATE INDEX IF NOT EXISTS idx_pcd_term_bucket
    ON position_change_daily (term_id, curve_id, bucket DESC);

-- ========================================
-- Step 5: Add missing refresh policies for share_price_stats caggs
-- ========================================
SELECT add_continuous_aggregate_policy('share_price_stats_hourly',
    start_offset    => INTERVAL '3 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists   => TRUE
);

SELECT add_continuous_aggregate_policy('share_price_stats_daily',
    start_offset    => INTERVAL '3 days',
    end_offset      => INTERVAL '1 day',
    schedule_interval => INTERVAL '1 day',
    if_not_exists   => TRUE
);

-- ========================================
-- POST-MIGRATION: Run these manually to backfill all caggs:
--
-- psql "$DATABASE_URL" -c "SET statement_timeout='60min'; CALL refresh_continuous_aggregate('position_change_hourly', NULL, NULL);"
-- psql "$DATABASE_URL" -c "SET statement_timeout='60min'; CALL refresh_continuous_aggregate('position_change_daily', NULL, NULL);"
-- psql "$DATABASE_URL" -c "SET statement_timeout='60min'; CALL refresh_continuous_aggregate('share_price_stats_hourly', NULL, NULL);"
-- psql "$DATABASE_URL" -c "SET statement_timeout='60min'; CALL refresh_continuous_aggregate('share_price_stats_daily', NULL, NULL);"
-- ========================================
