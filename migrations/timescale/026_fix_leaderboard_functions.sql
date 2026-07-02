-- Fix get_pnl_leaderboard_period to work when called multiple times in the
-- same transaction (e.g. from refresh_period_leaderboard_cache's loop).
--
-- Issues fixed:
--   1. Temp tables used ON COMMIT DROP but the refresh loop calls the function
--      24 times in one transaction. Second call crashes with "relation already
--      exists". Fixed by adding DROP TABLE IF EXISTS before each CREATE.
--   2. Column references: account.label → account.account_label,
--      account.image → account.account_image (matching actual schema).
--   3. Joined account_stats instead of account_pnl_state for
--      first_position_at / last_activity_at columns.
--   4. Cast rank as BIGINT (pnl_leaderboard_entry expects bigint, not integer).
--   5. Widened pnl_pct, realized_pnl_pct, unrealized_pnl_pct to unbounded
--      NUMERIC — wei-scale raw values overflow NUMERIC(20,4) when computing
--      percentages.

-- ========================================
-- Step 1: Widen pct fields in composite type and cache table
-- ========================================

DO $$ BEGIN
    ALTER TYPE pnl_leaderboard_entry ALTER ATTRIBUTE pnl_pct TYPE NUMERIC;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TYPE pnl_leaderboard_entry ALTER ATTRIBUTE realized_pnl_pct TYPE NUMERIC;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TYPE pnl_leaderboard_entry ALTER ATTRIBUTE unrealized_pnl_pct TYPE NUMERIC;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DROP VIEW IF EXISTS leaderboard_current;

DO $$ BEGIN
    ALTER TABLE leaderboard_cache ALTER COLUMN pnl_pct TYPE NUMERIC;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE leaderboard_cache ALTER COLUMN realized_pnl_pct TYPE NUMERIC;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE leaderboard_cache ALTER COLUMN unrealized_pnl_pct TYPE NUMERIC;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

CREATE OR REPLACE VIEW leaderboard_current AS
SELECT lc.*
FROM leaderboard_cache lc
JOIN leaderboard_cache_version lcv
    ON lc.period = lcv.period
   AND lc.sort_key = lcv.sort_key
   AND lc.cache_version = lcv.active_version;

-- ========================================
-- Step 2: Replace get_pnl_leaderboard_period
-- ========================================

CREATE OR REPLACE FUNCTION get_pnl_leaderboard_period(
    p_start_date TIMESTAMPTZ,
    p_end_date   TIMESTAMPTZ,
    p_limit      INTEGER DEFAULT 100,
    p_offset     INTEGER DEFAULT 0,
    p_sort_by    TEXT DEFAULT 'total_pnl',
    p_sort_order TEXT DEFAULT 'DESC',
    p_exclude_protocol_accounts BOOLEAN DEFAULT TRUE,
    p_min_positions INTEGER DEFAULT 1,
    p_min_volume    NUMERIC DEFAULT 0,
    p_term_id       TEXT DEFAULT NULL,
    p_min_deposit   NUMERIC DEFAULT 0
)
RETURNS SETOF pnl_leaderboard_entry
LANGUAGE plpgsql AS $$
DECLARE
    v_limit         INTEGER;
    v_offset        INTEGER;
    v_hour_start    TIMESTAMPTZ;
    v_hour_end      TIMESTAMPTZ;
    v_bucket_start  TIMESTAMPTZ;
    v_bucket_end    TIMESTAMPTZ;
    v_cagg_cutoff   TIMESTAMPTZ;
BEGIN
    IF p_start_date IS NULL OR p_end_date IS NULL THEN
        RAISE EXCEPTION 'p_start_date and p_end_date are required';
    END IF;
    IF p_start_date >= p_end_date THEN
        RAISE EXCEPTION 'p_start_date must be before p_end_date';
    END IF;

    v_limit  := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 10000);
    v_offset := GREATEST(COALESCE(p_offset, 0), 0);

    v_hour_start   := date_trunc('hour', p_start_date);
    v_hour_end     := date_trunc('hour', p_end_date);
    v_bucket_start := date_trunc('day', p_start_date);
    v_bucket_end   := date_trunc('day', p_end_date);
    v_cagg_cutoff  := date_trunc('hour', NOW());

    SET LOCAL work_mem = '64MB';

    ---------------------------------------------------------------------------
    -- Drop any leftover temp tables from a previous call in the same tx
    ---------------------------------------------------------------------------
    DROP TABLE IF EXISTS _tmp_active;
    DROP TABLE IF EXISTS _tmp_positions;
    DROP TABLE IF EXISTS _tmp_price_start;
    DROP TABLE IF EXISTS _tmp_price_end;

    ---------------------------------------------------------------------------
    -- Step 1: Active accounts (day-level filter + protocol exclusion)
    ---------------------------------------------------------------------------
    CREATE TEMP TABLE _tmp_active ON COMMIT DROP AS
    SELECT DISTINCT pcd.account_id
    FROM position_change_daily pcd
    WHERE pcd.bucket >= v_bucket_start
      AND pcd.bucket <= v_bucket_end
      AND (p_term_id IS NULL OR pcd.term_id = p_term_id)
      AND (NOT p_exclude_protocol_accounts
           OR pcd.account_id NOT IN (
               SELECT a.account_id FROM account a
               WHERE a.account_type IN ('ProtocolVault', 'AtomWallet')
           ));

    ANALYZE _tmp_active;

    ---------------------------------------------------------------------------
    -- Step 2: Cumulative snapshots at start and end
    ---------------------------------------------------------------------------
    CREATE TEMP TABLE _tmp_positions ON COMMIT DROP AS
    WITH
    snap_end AS (
        SELECT DISTINCT ON (pc.account_id, pc.term_id, pc.curve_id)
            pc.account_id, pc.term_id, pc.curve_id,
            pc.cumulative_shares     AS shares_at_end,
            pc.cumulative_assets_in  AS cum_assets_in_end,
            pc.cumulative_assets_out AS cum_assets_out_end,
            pc.cumulative_shares_in  AS cum_shares_in_end,
            pc.cumulative_shares_out AS cum_shares_out_end
        FROM _tmp_active aa
        JOIN position_cumulative_hourly pc ON pc.account_id = aa.account_id
        WHERE pc.bucket <= v_hour_end
          AND (p_term_id IS NULL OR pc.term_id = p_term_id)
        ORDER BY pc.account_id, pc.term_id, pc.curve_id, pc.bucket DESC
    ),
    snap_start AS (
        SELECT DISTINCT ON (pc.account_id, pc.term_id, pc.curve_id)
            pc.account_id, pc.term_id, pc.curve_id,
            pc.cumulative_shares     AS shares_at_start,
            pc.cumulative_assets_in  AS cum_assets_in_start,
            pc.cumulative_assets_out AS cum_assets_out_start,
            pc.cumulative_shares_in  AS cum_shares_in_start,
            pc.cumulative_shares_out AS cum_shares_out_start
        FROM _tmp_active aa
        JOIN position_cumulative_hourly pc ON pc.account_id = aa.account_id
        WHERE pc.bucket <= v_hour_start
          AND (p_term_id IS NULL OR pc.term_id = p_term_id)
        ORDER BY pc.account_id, pc.term_id, pc.curve_id, pc.bucket DESC
    )
    SELECT
        e.account_id, e.term_id, e.curve_id,
        e.shares_at_end, e.cum_assets_in_end, e.cum_assets_out_end,
        e.cum_shares_in_end, e.cum_shares_out_end,
        COALESCE(s.shares_at_start, 0)          AS shares_at_start,
        COALESCE(s.cum_assets_in_start, 0)      AS cum_assets_in_start,
        COALESCE(s.cum_assets_out_start, 0)     AS cum_assets_out_start,
        COALESCE(s.cum_shares_in_start, 0)      AS cum_shares_in_start,
        COALESCE(s.cum_shares_out_start, 0)     AS cum_shares_out_start,
        (e.cum_assets_in_end  - COALESCE(s.cum_assets_in_start, 0))  AS period_assets_in,
        (e.cum_assets_out_end - COALESCE(s.cum_assets_out_start, 0)) AS period_assets_out,
        (e.cum_shares_in_end  - COALESCE(s.cum_shares_in_start, 0))  AS period_shares_in,
        (e.cum_shares_out_end - COALESCE(s.cum_shares_out_start, 0)) AS period_shares_out
    FROM snap_end e
    LEFT JOIN snap_start s
        ON e.account_id = s.account_id
       AND e.term_id    = s.term_id
       AND e.curve_id   = s.curve_id;

    ANALYZE _tmp_positions;

    ---------------------------------------------------------------------------
    -- Step 3: Share prices at start and end of period
    ---------------------------------------------------------------------------
    CREATE TEMP TABLE _tmp_price_start ON COMMIT DROP AS
    SELECT DISTINCT ON (sph.term_id, sph.curve_id)
        sph.term_id, sph.curve_id, sph.close_price AS share_price
    FROM share_price_stats_hourly sph
    WHERE sph.bucket <= v_hour_start
      AND (term_id, curve_id) IN (
          SELECT DISTINCT term_id, curve_id FROM _tmp_positions)
    ORDER BY sph.term_id, sph.curve_id, sph.bucket DESC;

    -- Fallback: earliest known price if no price exists before start
    INSERT INTO _tmp_price_start (term_id, curve_id, share_price)
    SELECT DISTINCT ON (sph.term_id, sph.curve_id)
        sph.term_id, sph.curve_id, sph.close_price
    FROM share_price_stats_hourly sph
    WHERE (term_id, curve_id) IN (
          SELECT DISTINCT term_id, curve_id FROM _tmp_positions)
      AND NOT EXISTS (
          SELECT 1 FROM _tmp_price_start ps
          WHERE ps.term_id = sph.term_id AND ps.curve_id = sph.curve_id)
    ORDER BY sph.term_id, sph.curve_id, sph.bucket ASC;

    CREATE TEMP TABLE _tmp_price_end ON COMMIT DROP AS
    SELECT DISTINCT ON (sph.term_id, sph.curve_id)
        sph.term_id, sph.curve_id, sph.close_price AS share_price
    FROM share_price_stats_hourly sph
    WHERE sph.bucket <= v_hour_end
      AND sph.bucket <= v_cagg_cutoff
      AND (term_id, curve_id) IN (
          SELECT DISTINCT term_id, curve_id FROM _tmp_positions)
    ORDER BY sph.term_id, sph.curve_id, sph.bucket DESC;

    -- Real-time fallback for price_end when cagg hasn't materialized yet
    IF v_hour_end > v_cagg_cutoff THEN
        UPDATE _tmp_price_end pe
        SET share_price = sub.share_price
        FROM (
            SELECT DISTINCT ON (term_id, curve_id)
                term_id, curve_id, share_price
            FROM share_price_history
            WHERE ts <= p_end_date AND ts > v_cagg_cutoff
            ORDER BY term_id, curve_id, ts DESC
        ) sub
        WHERE pe.term_id = sub.term_id AND pe.curve_id = sub.curve_id;

        INSERT INTO _tmp_price_end (term_id, curve_id, share_price)
        SELECT DISTINCT ON (sph.term_id, sph.curve_id)
            sph.term_id, sph.curve_id, sph.share_price
        FROM share_price_history sph
        WHERE sph.ts <= p_end_date AND sph.ts > v_cagg_cutoff
          AND (term_id, curve_id) IN (
              SELECT DISTINCT term_id, curve_id FROM _tmp_positions)
          AND NOT EXISTS (
              SELECT 1 FROM _tmp_price_end pe2
              WHERE pe2.term_id = sph.term_id AND pe2.curve_id = sph.curve_id)
        ORDER BY sph.term_id, sph.curve_id, sph.ts DESC;
    END IF;

    -- Last resort: use vault.current_share_price
    INSERT INTO _tmp_price_end (term_id, curve_id, share_price)
    SELECT v.term_id, v.curve_id, v.current_share_price
    FROM vault v
    WHERE (v.term_id, v.curve_id) IN (
          SELECT DISTINCT term_id, curve_id FROM _tmp_positions)
      AND NOT EXISTS (
          SELECT 1 FROM _tmp_price_end pe3
          WHERE pe3.term_id = v.term_id AND pe3.curve_id = v.curve_id);

    ---------------------------------------------------------------------------
    -- Step 4: Final aggregation + ranking
    ---------------------------------------------------------------------------
    RETURN QUERY
    WITH per_position AS (
        SELECT
            p.account_id, p.term_id, p.curve_id,
            -- Unrealized PnL
            (p.shares_at_end * COALESCE(pe.share_price, 0))
              - (p.cum_assets_in_end - p.cum_assets_out_end) AS unrealized_pnl,
            -- Realized PnL
            p.period_assets_out
              - p.period_shares_out * COALESCE(
                  p.cum_assets_in_end / NULLIF(p.cum_shares_in_end, 0), 0
                ) AS realized_pnl,
            CASE WHEN p.shares_at_end > 0 THEN 1 ELSE 0 END AS is_active,
            p.period_assets_in,
            p.period_assets_out,
            p.shares_at_end * COALESCE(pe.share_price, 0) AS equity_value,
            -- PnL at period start (for change calculation)
            (p.shares_at_start * COALESCE(ps.share_price, 0))
              - (p.cum_assets_in_start - p.cum_assets_out_start)
              + (p.cum_assets_out_start
                 - p.cum_shares_out_start * COALESCE(
                     p.cum_assets_in_start / NULLIF(p.cum_shares_in_start, 0), 0
                   )) AS total_pnl_at_start,
            p.period_assets_in + p.period_assets_out AS position_volume
        FROM _tmp_positions p
        LEFT JOIN _tmp_price_start ps
            ON p.term_id = ps.term_id AND p.curve_id = ps.curve_id
        LEFT JOIN _tmp_price_end pe
            ON p.term_id = pe.term_id AND p.curve_id = pe.curve_id
    ),
    account_agg AS (
        SELECT
            pp.account_id,
            SUM(pp.unrealized_pnl)                           AS unrealized_pnl_raw,
            SUM(pp.realized_pnl)                             AS realized_pnl_raw,
            SUM(pp.unrealized_pnl + pp.realized_pnl)         AS total_pnl_raw,
            COUNT(*)::BIGINT                                  AS total_position_count,
            SUM(pp.is_active)::BIGINT                         AS active_position_count,
            COUNT(*) FILTER (WHERE pp.unrealized_pnl + pp.realized_pnl > 0)::BIGINT AS winning_positions,
            COUNT(*) FILTER (WHERE pp.unrealized_pnl + pp.realized_pnl < 0)::BIGINT AS losing_positions,
            SUM(pp.period_assets_in)                          AS total_deposits_raw,
            SUM(pp.period_assets_out)                         AS total_redemptions_raw,
            SUM(pp.position_volume)                           AS total_volume_raw,
            SUM(pp.equity_value)                              AS current_equity_value_raw,
            MAX(pp.unrealized_pnl + pp.realized_pnl)          AS best_trade_pnl_raw,
            MIN(pp.unrealized_pnl + pp.realized_pnl)          AS worst_trade_pnl_raw,
            SUM(pp.total_pnl_at_start)                        AS total_pnl_at_start
        FROM per_position pp
        GROUP BY pp.account_id
        HAVING COUNT(*) >= p_min_positions
           AND SUM(pp.position_volume) >= p_min_volume
           AND SUM(pp.period_assets_in) >= p_min_deposit
    )
    SELECT
        ROW_NUMBER() OVER (ORDER BY
            CASE p_sort_by
                WHEN 'total_pnl'      THEN aa.total_pnl_raw
                WHEN 'realized_pnl'   THEN aa.realized_pnl_raw
                WHEN 'unrealized_pnl' THEN aa.unrealized_pnl_raw
                WHEN 'pnl_pct'        THEN CASE WHEN aa.total_deposits_raw > 0
                                               THEN aa.total_pnl_raw / aa.total_deposits_raw * 100
                                               ELSE 0 END
                WHEN 'win_rate'        THEN CASE WHEN aa.total_position_count > 0
                                               THEN aa.winning_positions::NUMERIC / aa.total_position_count * 100
                                               ELSE 0 END
                WHEN 'total_volume'    THEN aa.total_volume_raw
                ELSE aa.total_pnl_raw
            END DESC NULLS LAST
        )::BIGINT AS rank,

        aa.account_id,
        acct.account_label,
        acct.account_image,

        -- Raw + formatted PnL
        aa.total_pnl_raw,
        ROUND(aa.total_pnl_raw / 1e18, 4)::NUMERIC(30,4),
        aa.realized_pnl_raw,
        ROUND(aa.realized_pnl_raw / 1e18, 4)::NUMERIC(30,4),
        aa.unrealized_pnl_raw,
        ROUND(aa.unrealized_pnl_raw / 1e18, 4)::NUMERIC(30,4),

        -- Percentage fields (unbounded NUMERIC to avoid overflow)
        CASE WHEN aa.total_deposits_raw > 0
             THEN ROUND(aa.total_pnl_raw / aa.total_deposits_raw * 100, 4)
             ELSE 0 END,
        CASE WHEN aa.total_deposits_raw > 0
             THEN ROUND(aa.realized_pnl_raw / aa.total_deposits_raw * 100, 4)
             ELSE 0 END,
        CASE WHEN aa.total_deposits_raw > 0
             THEN ROUND(aa.unrealized_pnl_raw / aa.total_deposits_raw * 100, 4)
             ELSE 0 END,

        -- PnL change
        (aa.total_pnl_raw - aa.total_pnl_at_start),
        ROUND((aa.total_pnl_raw - aa.total_pnl_at_start) / 1e18, 4)::NUMERIC(30,4),

        -- Position counts
        aa.total_position_count,
        aa.active_position_count,
        aa.winning_positions,
        aa.losing_positions,
        CASE WHEN aa.total_position_count > 0
             THEN ROUND(aa.winning_positions::NUMERIC / aa.total_position_count * 100, 2)
             ELSE 0 END::NUMERIC(10,2),

        -- Volume fields
        aa.total_deposits_raw,
        ROUND(aa.total_deposits_raw / 1e18, 4)::NUMERIC(30,4),
        aa.total_redemptions_raw,
        ROUND(aa.total_redemptions_raw / 1e18, 4)::NUMERIC(30,4),
        aa.total_volume_raw,
        ROUND(aa.total_volume_raw / 1e18, 4)::NUMERIC(30,4),

        -- Equity
        aa.current_equity_value_raw,
        ROUND(aa.current_equity_value_raw / 1e18, 4)::NUMERIC(30,4),

        -- Best/worst trade
        aa.best_trade_pnl_raw,
        ROUND(aa.best_trade_pnl_raw / 1e18, 4)::NUMERIC(30,4),
        aa.worst_trade_pnl_raw,
        ROUND(aa.worst_trade_pnl_raw / 1e18, 4)::NUMERIC(30,4),

        -- Redeemable (= equity value)
        aa.current_equity_value_raw,
        ROUND(aa.current_equity_value_raw / 1e18, 4)::NUMERIC(30,4),

        -- Timestamps from account_stats
        ast.first_position_at,
        ast.last_activity_at

    FROM account_agg aa
    LEFT JOIN account acct ON acct.account_id = aa.account_id
    LEFT JOIN account_stats ast ON ast.account_id = aa.account_id
    ORDER BY
        CASE p_sort_by
            WHEN 'total_pnl'      THEN aa.total_pnl_raw
            WHEN 'realized_pnl'   THEN aa.realized_pnl_raw
            WHEN 'unrealized_pnl' THEN aa.unrealized_pnl_raw
            WHEN 'pnl_pct'        THEN CASE WHEN aa.total_deposits_raw > 0
                                           THEN aa.total_pnl_raw / aa.total_deposits_raw * 100
                                           ELSE 0 END
            WHEN 'win_rate'        THEN CASE WHEN aa.total_position_count > 0
                                           THEN aa.winning_positions::NUMERIC / aa.total_position_count * 100
                                           ELSE 0 END
            WHEN 'total_volume'    THEN aa.total_volume_raw
            ELSE aa.total_pnl_raw
        END DESC NULLS LAST
    LIMIT v_limit OFFSET v_offset;
END;
$$;

-- ========================================
-- Step 3: Re-register scheduled jobs
-- ========================================
-- Drop all existing instances of these jobs to avoid duplicates,
-- then re-register with fresh function OIDs.

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
