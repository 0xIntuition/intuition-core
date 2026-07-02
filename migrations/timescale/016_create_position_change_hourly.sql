-- Continuous aggregate: hourly bucketed deltas from position_change.
-- Enables efficient period-based PnL computation by pre-aggregating the
-- millions of raw position_change rows into hourly buckets per position.
--
-- Cumulative position at time T = SUM(deltas) WHERE bucket <= T.

CREATE MATERIALIZED VIEW IF NOT EXISTS position_change_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', ts) AS bucket,
    account_id,
    term_id,
    curve_id,
    SUM(shares_delta) AS shares_delta,
    SUM(assets_in)    AS assets_in,
    SUM(assets_out)   AS assets_out,
    COUNT(*)          AS event_count
FROM position_change
GROUP BY bucket, account_id, term_id, curve_id
WITH NO DATA;

-- Refresh policy: every hour, covering the last 3 hours for safety overlap.
SELECT add_continuous_aggregate_policy('position_change_hourly',
    start_offset    => INTERVAL '3 hours',
    end_offset      => INTERVAL '1 hour',
    schedule_interval => INTERVAL '1 hour',
    if_not_exists   => TRUE
);

-- Index for leaderboard queries: "for account X, sum all buckets <= T"
CREATE INDEX IF NOT EXISTS idx_pch_account_bucket
    ON position_change_hourly (account_id, term_id, curve_id, bucket DESC);

-- Index for vault-centric queries: "all positions in vault Y"
CREATE INDEX IF NOT EXISTS idx_pch_term_bucket
    ON position_change_hourly (term_id, curve_id, bucket DESC);

-- Also create a daily aggregate for fast "which accounts were active on day X" lookups.
CREATE MATERIALIZED VIEW IF NOT EXISTS position_change_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', ts) AS bucket,
    account_id,
    term_id,
    curve_id,
    SUM(shares_delta) AS shares_delta,
    SUM(assets_in)    AS assets_in,
    SUM(assets_out)   AS assets_out,
    COUNT(*)          AS event_count
FROM position_change
GROUP BY bucket, account_id, term_id, curve_id
WITH NO DATA;

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
