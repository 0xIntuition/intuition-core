-- Refresh function for position_cumulative_hourly.
-- Incrementally appends new rows using window functions over position_change_hourly.
-- Scheduled to run hourly, 5 minutes after the cagg refresh.

-- ========================================
-- Step 1: Backfill from position_change_hourly (full history)
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
-- Step 2: Incremental refresh function
-- ========================================
CREATE OR REPLACE FUNCTION refresh_position_cumulative_hourly(config JSONB DEFAULT NULL)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_last_bucket TIMESTAMPTZ;
    v_rows_inserted BIGINT;
BEGIN
    -- Find the last materialized bucket
    SELECT MAX(bucket) INTO v_last_bucket FROM position_cumulative_hourly;

    IF v_last_bucket IS NULL THEN
        -- Table is empty; skip (initial backfill should be done via migration)
        RAISE NOTICE 'position_cumulative_hourly is empty, skipping incremental refresh';
        RETURN;
    END IF;

    SET LOCAL work_mem = '128MB';

    -- Append new hourly rows that appeared since last materialized bucket.
    -- For each (account, term, curve), carry forward from their latest cumulative row.
    INSERT INTO position_cumulative_hourly (
        bucket, account_id, term_id, curve_id,
        cumulative_shares, cumulative_assets_in, cumulative_assets_out,
        cumulative_shares_in, cumulative_shares_out
    )
    WITH
    -- New delta rows to process
    new_deltas AS (
        SELECT *
        FROM position_change_hourly
        WHERE bucket > v_last_bucket
    ),
    -- Latest cumulative values for positions that have new data
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

-- ========================================
-- Step 3: Schedule hourly refresh (5 min after cagg refresh typically completes)
-- ========================================
DO $$ BEGIN
    PERFORM add_job('refresh_position_cumulative_hourly',
        schedule_interval => INTERVAL '1 hour',
        initial_start     => date_trunc('hour', NOW()) + INTERVAL '65 minutes'
    );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
