-- Expand leaderboard_cache to store all 37 columns from pnl_leaderboard_entry,
-- and create a scheduled refresh function with double-buffering.
--
-- Read path: SELECT FROM leaderboard_cache JOIN leaderboard_cache_version → <100ms
-- Write path: refresh_period_leaderboard_cache() runs every 60s via TimescaleDB job

-- ========================================
-- Step 1: Drop and recreate leaderboard_cache with expanded columns
-- ========================================
DROP TABLE IF EXISTS leaderboard_cache CASCADE;
DROP TABLE IF EXISTS leaderboard_cache_version CASCADE;

CREATE TABLE IF NOT EXISTS leaderboard_cache (
    cache_version                   INTEGER NOT NULL,
    period                          TEXT NOT NULL,
    sort_key                        TEXT NOT NULL,
    rank                            INTEGER NOT NULL,
    account_id                      TEXT NOT NULL,
    account_label                   TEXT,
    account_image                   TEXT,
    total_pnl_raw                   NUMERIC NOT NULL DEFAULT 0,
    total_pnl_formatted             NUMERIC(30,4) NOT NULL DEFAULT 0,
    realized_pnl_raw                NUMERIC NOT NULL DEFAULT 0,
    realized_pnl_formatted          NUMERIC(30,4) NOT NULL DEFAULT 0,
    unrealized_pnl_raw              NUMERIC NOT NULL DEFAULT 0,
    unrealized_pnl_formatted        NUMERIC(30,4) NOT NULL DEFAULT 0,
    pnl_pct                         NUMERIC(20,4) NOT NULL DEFAULT 0,
    realized_pnl_pct                NUMERIC(20,4) NOT NULL DEFAULT 0,
    unrealized_pnl_pct              NUMERIC(20,4) NOT NULL DEFAULT 0,
    pnl_change_raw                  NUMERIC NOT NULL DEFAULT 0,
    pnl_change_formatted            NUMERIC(30,4) NOT NULL DEFAULT 0,
    total_position_count            BIGINT NOT NULL DEFAULT 0,
    active_position_count           BIGINT NOT NULL DEFAULT 0,
    winning_positions               BIGINT NOT NULL DEFAULT 0,
    losing_positions                BIGINT NOT NULL DEFAULT 0,
    win_rate                        NUMERIC(10,2) NOT NULL DEFAULT 0,
    total_deposits_raw              NUMERIC NOT NULL DEFAULT 0,
    total_deposits_formatted        NUMERIC(30,4) NOT NULL DEFAULT 0,
    total_redemptions_raw           NUMERIC NOT NULL DEFAULT 0,
    total_redemptions_formatted     NUMERIC(30,4) NOT NULL DEFAULT 0,
    total_volume_raw                NUMERIC NOT NULL DEFAULT 0,
    total_volume_formatted          NUMERIC(30,4) NOT NULL DEFAULT 0,
    current_equity_value_raw        NUMERIC NOT NULL DEFAULT 0,
    current_equity_value_formatted  NUMERIC(30,4) NOT NULL DEFAULT 0,
    best_trade_pnl_raw              NUMERIC,
    best_trade_pnl_formatted        NUMERIC(30,4),
    worst_trade_pnl_raw             NUMERIC,
    worst_trade_pnl_formatted       NUMERIC(30,4),
    redeemable_assets_raw           NUMERIC,
    redeemable_assets_formatted     NUMERIC(30,4),
    first_position_at               TIMESTAMPTZ,
    last_activity_at                TIMESTAMPTZ,
    computed_at                     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cache_version, period, sort_key, rank)
);

CREATE INDEX IF NOT EXISTS idx_lc_period_sort
    ON leaderboard_cache (period, sort_key, cache_version DESC);

-- Active version pointer (double-buffer)
CREATE TABLE IF NOT EXISTS leaderboard_cache_version (
    period          TEXT NOT NULL,
    sort_key        TEXT NOT NULL,
    active_version  INTEGER NOT NULL DEFAULT 0,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (period, sort_key)
);

-- ========================================
-- Step 2: Cache refresh function with double-buffering
-- ========================================
CREATE OR REPLACE FUNCTION refresh_period_leaderboard_cache(config JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_period        RECORD;
    v_sort          RECORD;
    v_start_date    TIMESTAMPTZ;
    v_end_date      TIMESTAMPTZ;
    v_active        INTEGER;
    v_next          INTEGER;
    v_rows          BIGINT;
BEGIN
    v_end_date := NOW();

    -- Fixed periods to refresh
    FOR v_period IN
        SELECT unnest(ARRAY['24h', '7d', '30d', 'all_time']) AS name,
               unnest(ARRAY[
                   INTERVAL '24 hours',
                   INTERVAL '7 days',
                   INTERVAL '30 days',
                   INTERVAL '100 years'
               ]) AS lookback
    LOOP
        v_start_date := CASE
            WHEN v_period.name = 'all_time' THEN '1970-01-01'::TIMESTAMPTZ
            ELSE v_end_date - v_period.lookback
        END;

        -- Sort variants to cache
        FOR v_sort IN
            SELECT unnest(ARRAY[
                'total_pnl', 'pnl_pct', 'realized_pnl',
                'unrealized_pnl', 'win_rate', 'total_volume'
            ]) AS key
        LOOP
            -- Get next version (double-buffer flip)
            SELECT COALESCE(active_version, 0) INTO v_active
            FROM leaderboard_cache_version
            WHERE period = v_period.name AND sort_key = v_sort.key;

            IF NOT FOUND THEN v_active := 0; END IF;
            v_next := v_active + 1;

            -- Clear the target version slot
            DELETE FROM leaderboard_cache
            WHERE cache_version = v_next
              AND period = v_period.name
              AND sort_key = v_sort.key;

            -- Insert fresh results from the computation function
            INSERT INTO leaderboard_cache (
                cache_version, period, sort_key, rank,
                account_id, account_label, account_image,
                total_pnl_raw, total_pnl_formatted,
                realized_pnl_raw, realized_pnl_formatted,
                unrealized_pnl_raw, unrealized_pnl_formatted,
                pnl_pct, realized_pnl_pct, unrealized_pnl_pct,
                pnl_change_raw, pnl_change_formatted,
                total_position_count, active_position_count,
                winning_positions, losing_positions, win_rate,
                total_deposits_raw, total_deposits_formatted,
                total_redemptions_raw, total_redemptions_formatted,
                total_volume_raw, total_volume_formatted,
                current_equity_value_raw, current_equity_value_formatted,
                best_trade_pnl_raw, best_trade_pnl_formatted,
                worst_trade_pnl_raw, worst_trade_pnl_formatted,
                redeemable_assets_raw, redeemable_assets_formatted,
                first_position_at, last_activity_at,
                computed_at
            )
            SELECT
                v_next, v_period.name, v_sort.key, r.rank,
                r.account_id, r.account_label, r.account_image,
                r.total_pnl_raw, r.total_pnl_formatted,
                r.realized_pnl_raw, r.realized_pnl_formatted,
                r.unrealized_pnl_raw, r.unrealized_pnl_formatted,
                r.pnl_pct, r.realized_pnl_pct, r.unrealized_pnl_pct,
                r.pnl_change_raw, r.pnl_change_formatted,
                r.total_position_count, r.active_position_count,
                r.winning_positions, r.losing_positions, r.win_rate,
                r.total_deposits_raw, r.total_deposits_formatted,
                r.total_redemptions_raw, r.total_redemptions_formatted,
                r.total_volume_raw, r.total_volume_formatted,
                r.current_equity_value_raw, r.current_equity_value_formatted,
                r.best_trade_pnl_raw, r.best_trade_pnl_formatted,
                r.worst_trade_pnl_raw, r.worst_trade_pnl_formatted,
                r.redeemable_assets_raw, r.redeemable_assets_formatted,
                r.first_position_at, r.last_activity_at,
                NOW()
            FROM get_pnl_leaderboard_period(
                v_start_date, v_end_date,
                100, 0, v_sort.key, 'DESC', TRUE
            ) r;

            GET DIAGNOSTICS v_rows = ROW_COUNT;

            -- Flip the active version pointer (atomic)
            INSERT INTO leaderboard_cache_version (period, sort_key, active_version, updated_at)
            VALUES (v_period.name, v_sort.key, v_next, NOW())
            ON CONFLICT (period, sort_key) DO UPDATE SET
                active_version = EXCLUDED.active_version,
                updated_at     = NOW();

            -- Clean up old version slot
            DELETE FROM leaderboard_cache
            WHERE cache_version = v_active
              AND period = v_period.name
              AND sort_key = v_sort.key;

        END LOOP;
    END LOOP;

    RAISE NOTICE 'refresh_period_leaderboard_cache: completed all periods and sort keys';
END;
$$;

-- ========================================
-- Step 3: Schedule refresh every 60 seconds
-- ========================================
DO $$ BEGIN
    PERFORM add_job('refresh_period_leaderboard_cache',
        schedule_interval => INTERVAL '60 seconds',
        initial_start     => NOW() + INTERVAL '30 seconds'
    );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ========================================
-- Helper view for easy API reads
-- ========================================
CREATE OR REPLACE VIEW leaderboard_current AS
SELECT lc.*
FROM leaderboard_cache lc
JOIN leaderboard_cache_version lcv
    ON lc.period = lcv.period
   AND lc.sort_key = lcv.sort_key
   AND lc.cache_version = lcv.active_version;

COMMENT ON VIEW leaderboard_current IS
    'Convenience view: reads from the active version of leaderboard_cache. '
    'Usage: SELECT * FROM leaderboard_current WHERE period = ''7d'' AND sort_key = ''total_pnl'' ORDER BY rank;';
