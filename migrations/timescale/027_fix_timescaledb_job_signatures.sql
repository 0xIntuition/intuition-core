-- Fix TimescaleDB scheduled job function signatures.
--
-- TimescaleDB add_job() calls registered functions with (job_id INTEGER, config JSONB)
-- but both functions were defined with only (config JSONB), causing every invocation
-- to fail with a signature mismatch. Result: 686 failures / 0 successes for the
-- leaderboard cache job, and position_cumulative_hourly never populated.

-- ========================================
-- Step 1: Drop existing broken jobs
-- ========================================
DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN
        SELECT job_id FROM timescaledb_information.jobs
        WHERE proc_name IN (
            'refresh_position_cumulative_hourly',
            'refresh_period_leaderboard_cache'
        )
        AND proc_schema = 'public'
    LOOP
        PERFORM delete_job(r.job_id);
    END LOOP;
END;
$$;

-- ========================================
-- Step 2: Replace functions with correct (job_id, config) signature
-- ========================================

-- Drop old single-arg versions so there's no overload ambiguity
DROP FUNCTION IF EXISTS refresh_position_cumulative_hourly(JSONB);
DROP FUNCTION IF EXISTS refresh_period_leaderboard_cache(JSONB);

-- --- refresh_position_cumulative_hourly ---
CREATE OR REPLACE FUNCTION refresh_position_cumulative_hourly(job_id INTEGER, config JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_last_bucket TIMESTAMPTZ;
    v_rows_inserted BIGINT;
BEGIN
    SELECT MAX(bucket) INTO v_last_bucket FROM position_cumulative_hourly;

    IF v_last_bucket IS NULL THEN
        RAISE NOTICE 'position_cumulative_hourly is empty, skipping incremental refresh';
        RETURN;
    END IF;

    SET LOCAL work_mem = '128MB';

    INSERT INTO position_cumulative_hourly (
        bucket, account_id, term_id, curve_id,
        cumulative_shares, cumulative_assets_in, cumulative_assets_out,
        cumulative_shares_in, cumulative_shares_out
    )
    WITH
    new_deltas AS (
        SELECT *
        FROM position_change_hourly
        WHERE bucket > v_last_bucket
    ),
    prior AS (
        SELECT DISTINCT ON (pc.account_id, pc.term_id, pc.curve_id)
            pc.account_id, pc.term_id, pc.curve_id,
            pc.cumulative_shares,
            pc.cumulative_assets_in,
            pc.cumulative_assets_out,
            pc.cumulative_shares_in,
            pc.cumulative_shares_out
        FROM position_cumulative_hourly pc
        INNER JOIN (
            SELECT DISTINCT account_id, term_id, curve_id FROM new_deltas
        ) nd ON pc.account_id = nd.account_id
            AND pc.term_id = nd.term_id
            AND pc.curve_id = nd.curve_id
        ORDER BY pc.account_id, pc.term_id, pc.curve_id, pc.bucket DESC
    )
    SELECT
        nd.bucket,
        nd.account_id,
        nd.term_id,
        nd.curve_id,
        COALESCE(p.cumulative_shares, 0)
            + SUM(nd.shares_delta) OVER w   AS cumulative_shares,
        COALESCE(p.cumulative_assets_in, 0)
            + SUM(nd.assets_in) OVER w      AS cumulative_assets_in,
        COALESCE(p.cumulative_assets_out, 0)
            + SUM(nd.assets_out) OVER w     AS cumulative_assets_out,
        COALESCE(p.cumulative_shares_in, 0)
            + SUM(nd.shares_in) OVER w      AS cumulative_shares_in,
        COALESCE(p.cumulative_shares_out, 0)
            + SUM(nd.shares_out) OVER w     AS cumulative_shares_out
    FROM new_deltas nd
    LEFT JOIN prior p
        ON nd.account_id = p.account_id
       AND nd.term_id    = p.term_id
       AND nd.curve_id   = p.curve_id
    WINDOW w AS (
        PARTITION BY nd.account_id, nd.term_id, nd.curve_id
        ORDER BY nd.bucket
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    )
    ON CONFLICT (account_id, term_id, curve_id, bucket) DO UPDATE SET
        cumulative_shares     = EXCLUDED.cumulative_shares,
        cumulative_assets_in  = EXCLUDED.cumulative_assets_in,
        cumulative_assets_out = EXCLUDED.cumulative_assets_out,
        cumulative_shares_in  = EXCLUDED.cumulative_shares_in,
        cumulative_shares_out = EXCLUDED.cumulative_shares_out;

    GET DIAGNOSTICS v_rows_inserted = ROW_COUNT;

    RAISE NOTICE 'refresh_position_cumulative_hourly: upserted % rows, watermark was %',
        v_rows_inserted, v_last_bucket;
END;
$$;

-- --- refresh_period_leaderboard_cache ---
CREATE OR REPLACE FUNCTION refresh_period_leaderboard_cache(job_id INTEGER, config JSONB DEFAULT NULL)
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

        FOR v_sort IN
            SELECT unnest(ARRAY[
                'total_pnl', 'pnl_pct', 'realized_pnl',
                'unrealized_pnl', 'win_rate', 'total_volume'
            ]) AS key
        LOOP
            SELECT COALESCE(active_version, 0) INTO v_active
            FROM leaderboard_cache_version
            WHERE period = v_period.name AND sort_key = v_sort.key;

            IF NOT FOUND THEN v_active := 0; END IF;
            v_next := v_active + 1;

            DELETE FROM leaderboard_cache
            WHERE cache_version = v_next
              AND period = v_period.name
              AND sort_key = v_sort.key;

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

            INSERT INTO leaderboard_cache_version (period, sort_key, active_version, updated_at)
            VALUES (v_period.name, v_sort.key, v_next, NOW())
            ON CONFLICT (period, sort_key) DO UPDATE SET
                active_version = EXCLUDED.active_version,
                updated_at     = NOW();

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
-- Step 3: Re-register jobs with correct function references
-- ========================================
DO $$ BEGIN
    PERFORM add_job('refresh_position_cumulative_hourly',
        schedule_interval => INTERVAL '1 hour',
        initial_start     => date_trunc('hour', NOW()) + INTERVAL '65 minutes'
    );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    PERFORM add_job('refresh_period_leaderboard_cache',
        schedule_interval => INTERVAL '60 seconds',
        initial_start     => NOW() + INTERVAL '30 seconds'
    );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ========================================
-- Step 4: Backfill position_cumulative_hourly since it's been empty
-- ========================================
SET statement_timeout = '60min';

INSERT INTO position_cumulative_hourly (
    bucket, account_id, term_id, curve_id,
    cumulative_shares, cumulative_assets_in, cumulative_assets_out,
    cumulative_shares_in, cumulative_shares_out
)
SELECT
    bucket,
    account_id,
    term_id,
    curve_id,
    SUM(shares_delta)  OVER w AS cumulative_shares,
    SUM(assets_in)     OVER w AS cumulative_assets_in,
    SUM(assets_out)    OVER w AS cumulative_assets_out,
    SUM(shares_in)     OVER w AS cumulative_shares_in,
    SUM(shares_out)    OVER w AS cumulative_shares_out
FROM position_change_hourly
WINDOW w AS (
    PARTITION BY account_id, term_id, curve_id
    ORDER BY bucket
    ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
)
ON CONFLICT (account_id, term_id, curve_id, bucket) DO NOTHING;

RESET statement_timeout;

-- ========================================
-- Step 5: Trigger an immediate leaderboard refresh to populate the cache
-- ========================================
SELECT refresh_period_leaderboard_cache(0, NULL);
