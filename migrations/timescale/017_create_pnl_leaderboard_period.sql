-- Return type for the PnL leaderboard function.
DO $$ BEGIN
    CREATE TYPE pnl_leaderboard_entry AS (
    rank                        BIGINT,
    account_id                  TEXT,
    total_pnl_raw               NUMERIC,
    total_pnl_formatted         NUMERIC(30,4),
    realized_pnl_raw            NUMERIC,
    realized_pnl_formatted      NUMERIC(30,4),
    unrealized_pnl_raw          NUMERIC,
    unrealized_pnl_formatted    NUMERIC(30,4),
    pnl_pct                     NUMERIC(20,4),
    realized_pnl_pct            NUMERIC(20,4),
    unrealized_pnl_pct          NUMERIC(20,4),
    total_position_count        BIGINT,
    active_position_count       BIGINT,
    winning_positions           BIGINT,
    losing_positions            BIGINT,
    win_rate                    NUMERIC(10,2),
    total_deposits_raw          NUMERIC,
    total_deposits_formatted    NUMERIC(30,4),
    total_redemptions_raw       NUMERIC,
    total_redemptions_formatted NUMERIC(30,4),
    total_volume_raw            NUMERIC,
    total_volume_formatted      NUMERIC(30,4),
    equity_at_start_raw         NUMERIC,
    equity_at_end_raw           NUMERIC,
    equity_at_end_formatted     NUMERIC(30,4)
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Period-based PnL leaderboard.
--
-- Computes per-account profit/loss for an arbitrary date range by:
-- 1. Finding active accounts from position_change_daily
-- 2. Computing cumulative position snapshots at start and end from position_change_hourly
-- 3. Looking up share prices at start and end from share_price_stats_hourly (with raw fallback)
-- 4. Calculating PnL = (equity_at_end - equity_at_start) - deposits + withdrawals
--
-- The realized/unrealized split uses per-share cost basis:
-- - Fully closed position: all PnL is realized
-- - No redemptions in period: all PnL is unrealized
-- - Partial: realized = redemption_proceeds - proportional_cost_basis

-- Drop the specific 10-param overload to avoid ambiguity with the 11-param
-- version created by 022 (which supersedes this migration's function).
DROP FUNCTION IF EXISTS get_pnl_leaderboard_period(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, TEXT);

CREATE OR REPLACE FUNCTION get_pnl_leaderboard_period(
    p_start_date    TIMESTAMPTZ,
    p_end_date      TIMESTAMPTZ,
    p_limit         INTEGER   DEFAULT 100,
    p_offset        INTEGER   DEFAULT 0,
    p_sort_by       TEXT      DEFAULT 'total_pnl',
    p_sort_order    TEXT      DEFAULT 'DESC',
    p_min_positions INTEGER   DEFAULT 1,
    p_min_volume    NUMERIC   DEFAULT 0,
    p_min_deposit   NUMERIC   DEFAULT 0,
    p_term_id       TEXT      DEFAULT NULL
)
RETURNS SETOF pnl_leaderboard_entry AS $$
DECLARE
    v_limit         INTEGER;
    v_offset        INTEGER;
    v_hour_start    TIMESTAMPTZ;
    v_hour_end      TIMESTAMPTZ;
    v_bucket_start  TIMESTAMPTZ;
    v_bucket_end    TIMESTAMPTZ;
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

    SET LOCAL work_mem = '64MB';

    ---------------------------------------------------------------------------
    -- Step 1: Active accounts (from daily aggregate for speed)
    ---------------------------------------------------------------------------
    CREATE TEMP TABLE _tmp_active ON COMMIT DROP AS
    SELECT DISTINCT account_id
    FROM position_change_daily
    WHERE bucket >= v_bucket_start
      AND bucket <= v_bucket_end
      AND (p_term_id IS NULL OR term_id = p_term_id);

    ANALYZE _tmp_active;

    ---------------------------------------------------------------------------
    -- Step 2: Cumulative position snapshots at start and end of period
    --
    -- SUM(hourly deltas up to T) gives the cumulative position at time T.
    ---------------------------------------------------------------------------
    CREATE TEMP TABLE _tmp_positions ON COMMIT DROP AS
    WITH
    snap_end AS (
        SELECT
            pch.account_id, pch.term_id, pch.curve_id,
            SUM(pch.shares_delta) AS shares_at_end,
            SUM(pch.assets_in)    AS cum_assets_in_end,
            SUM(pch.assets_out)   AS cum_assets_out_end
        FROM _tmp_active aa
        JOIN position_change_hourly pch ON pch.account_id = aa.account_id
        WHERE pch.bucket <= v_hour_end
          AND (p_term_id IS NULL OR pch.term_id = p_term_id)
        GROUP BY pch.account_id, pch.term_id, pch.curve_id
    ),
    snap_start AS (
        SELECT
            pch.account_id, pch.term_id, pch.curve_id,
            SUM(pch.shares_delta) AS shares_at_start,
            SUM(pch.assets_in)    AS cum_assets_in_start,
            SUM(pch.assets_out)   AS cum_assets_out_start
        FROM _tmp_active aa
        JOIN position_change_hourly pch ON pch.account_id = aa.account_id
        WHERE pch.bucket < v_hour_start
          AND (p_term_id IS NULL OR pch.term_id = p_term_id)
        GROUP BY pch.account_id, pch.term_id, pch.curve_id
    )
    SELECT
        e.account_id,
        e.term_id,
        e.curve_id,
        COALESCE(s.shares_at_start, 0)::NUMERIC       AS shares_at_start,
        e.shares_at_end::NUMERIC                        AS shares_at_end,
        -- Period activity = end cumulative - start cumulative
        (e.cum_assets_in_end  - COALESCE(s.cum_assets_in_start,  0))::NUMERIC AS period_deposits,
        (e.cum_assets_out_end - COALESCE(s.cum_assets_out_start, 0))::NUMERIC AS period_redemptions,
        -- For min_deposit filter
        e.cum_assets_in_end::NUMERIC                    AS cumulative_deposits,
        -- Had activity in period?
        ((e.cum_assets_in_end  - COALESCE(s.cum_assets_in_start,  0)) > 0
         OR
         (e.cum_assets_out_end - COALESCE(s.cum_assets_out_start, 0)) > 0
        ) AS had_activity
    FROM snap_end e
    LEFT JOIN snap_start s
        ON e.account_id = s.account_id
       AND e.term_id    = s.term_id
       AND e.curve_id   = s.curve_id;

    ANALYZE _tmp_positions;

    ---------------------------------------------------------------------------
    -- Step 3: Price lookups from share_price_stats_hourly cagg
    ---------------------------------------------------------------------------

    -- Price at start: latest close_price at or before p_start_date
    CREATE TEMP TABLE _tmp_price_start ON COMMIT DROP AS
    SELECT DISTINCT ON (c.term_id, c.curve_id)
        c.term_id, c.curve_id, c.close_price AS share_price
    FROM share_price_stats_hourly c
    INNER JOIN (
        SELECT DISTINCT term_id, curve_id FROM _tmp_positions
        WHERE shares_at_start > 0
    ) pd ON c.term_id = pd.term_id AND c.curve_id = pd.curve_id
    WHERE c.bucket <= v_hour_start
    ORDER BY c.term_id, c.curve_id, c.bucket DESC;

    -- Fallback: raw share_price_history for vaults not covered by the cagg
    INSERT INTO _tmp_price_start (term_id, curve_id, share_price)
    SELECT DISTINCT ON (sph.term_id, sph.curve_id)
        sph.term_id, sph.curve_id, sph.share_price
    FROM share_price_history sph
    INNER JOIN (
        SELECT DISTINCT term_id, curve_id FROM _tmp_positions
        WHERE shares_at_start > 0
    ) pd ON sph.term_id = pd.term_id AND sph.curve_id = pd.curve_id
    WHERE sph.ts <= p_start_date
      AND NOT EXISTS (
          SELECT 1 FROM _tmp_price_start ps
          WHERE ps.term_id = sph.term_id AND ps.curve_id = sph.curve_id
      )
    ORDER BY sph.term_id, sph.curve_id, sph.ts DESC;

    -- Price at end: latest close_price at or before p_end_date
    CREATE TEMP TABLE _tmp_price_end ON COMMIT DROP AS
    SELECT DISTINCT ON (c.term_id, c.curve_id)
        c.term_id, c.curve_id, c.close_price AS share_price
    FROM share_price_stats_hourly c
    INNER JOIN (
        SELECT DISTINCT term_id, curve_id FROM _tmp_positions
        WHERE shares_at_end > 0
    ) pd ON c.term_id = pd.term_id AND c.curve_id = pd.curve_id
    WHERE c.bucket <= v_hour_end
    ORDER BY c.term_id, c.curve_id, c.bucket DESC;

    -- Fallback for end prices
    INSERT INTO _tmp_price_end (term_id, curve_id, share_price)
    SELECT DISTINCT ON (sph.term_id, sph.curve_id)
        sph.term_id, sph.curve_id, sph.share_price
    FROM share_price_history sph
    INNER JOIN (
        SELECT DISTINCT term_id, curve_id FROM _tmp_positions
        WHERE shares_at_end > 0
    ) pd ON sph.term_id = pd.term_id AND sph.curve_id = pd.curve_id
    WHERE sph.ts <= p_end_date
      AND NOT EXISTS (
          SELECT 1 FROM _tmp_price_end pe
          WHERE pe.term_id = sph.term_id AND pe.curve_id = sph.curve_id
      )
    ORDER BY sph.term_id, sph.curve_id, sph.ts DESC;

    ---------------------------------------------------------------------------
    -- Step 4: Compute PnL and rank
    ---------------------------------------------------------------------------
    RETURN QUERY
    WITH
    position_metrics AS (
        SELECT
            p.account_id,
            p.term_id,
            p.curve_id,
            p.shares_at_start,
            p.shares_at_end,
            p.period_deposits,
            p.period_redemptions,
            p.had_activity,
            p.cumulative_deposits,
            -- Mark-to-market equity
            TRUNC(p.shares_at_start * COALESCE(ps.share_price, 0) / 1e18) AS equity_at_start,
            TRUNC(p.shares_at_end   * COALESCE(pe.share_price, 0) / 1e18) AS equity_at_end
        FROM _tmp_positions p
        LEFT JOIN _tmp_price_start ps ON p.term_id = ps.term_id AND p.curve_id = ps.curve_id
        LEFT JOIN _tmp_price_end   pe ON p.term_id = pe.term_id AND p.curve_id = pe.curve_id
    ),

    position_pnl AS (
        SELECT
            pm.*,
            (pm.equity_at_end - pm.equity_at_start
             + pm.period_redemptions - pm.period_deposits)::NUMERIC AS total_pnl,
            CASE WHEN (pm.equity_at_end - pm.equity_at_start
                       + pm.period_redemptions - pm.period_deposits) > 0
                 THEN 1 ELSE 0 END AS is_winning,
            CASE WHEN (pm.equity_at_end - pm.equity_at_start
                       + pm.period_redemptions - pm.period_deposits) < 0
                 THEN 1 ELSE 0 END AS is_losing,
            -- Realized PnL: fully closed = all realized, no redemptions = 0,
            -- partial = redemption_proceeds - proportional_cost_basis
            CASE
                WHEN pm.shares_at_end <= 0 THEN
                    (pm.equity_at_end - pm.equity_at_start
                     + pm.period_redemptions - pm.period_deposits)::NUMERIC
                WHEN pm.period_redemptions <= 0 THEN 0::NUMERIC
                ELSE (pm.period_redemptions - TRUNC(
                    (pm.equity_at_start + pm.period_deposits)
                    * (pm.shares_at_start + pm.shares_at_end - pm.shares_at_end)  -- shares redeemed approximation
                    / NULLIF(pm.shares_at_start, 0)
                ))::NUMERIC
            END AS realized_pnl
        FROM position_metrics pm
    ),

    -- Apply min_deposit filter
    filtered AS (
        SELECT * FROM position_pnl
        WHERE p_min_deposit <= 0
           OR cumulative_deposits >= p_min_deposit * 1e18
    ),

    -- Aggregate per account
    account_agg AS (
        SELECT
            f.account_id,
            COUNT(DISTINCT (f.term_id, f.curve_id))
                FILTER (WHERE f.had_activity)               AS total_position_count,
            COUNT(DISTINCT (f.term_id, f.curve_id))
                FILTER (WHERE f.shares_at_end > 0)          AS active_position_count,
            SUM(f.is_winning) FILTER (WHERE f.had_activity) AS winning_positions,
            SUM(f.is_losing)  FILTER (WHERE f.had_activity) AS losing_positions,
            SUM(f.period_deposits)::NUMERIC                 AS total_deposits_raw,
            SUM(f.period_redemptions)::NUMERIC              AS total_redemptions_raw,
            SUM(f.total_pnl)::NUMERIC                       AS total_pnl_raw,
            SUM(f.realized_pnl)::NUMERIC                    AS realized_pnl_raw,
            SUM(f.total_pnl - f.realized_pnl)::NUMERIC     AS unrealized_pnl_raw,
            SUM(f.equity_at_start)::NUMERIC                 AS equity_at_start,
            SUM(f.equity_at_end)::NUMERIC                   AS equity_at_end
        FROM filtered f
        GROUP BY f.account_id
        HAVING
            COUNT(DISTINCT (f.term_id, f.curve_id))
                FILTER (WHERE f.had_activity) >= GREATEST(p_min_positions, 1)
            AND (SUM(f.period_deposits) + SUM(f.period_redemptions))
                >= COALESCE(p_min_volume * 1e18, 0)
    ),

    enriched AS (
        SELECT
            a.account_id,
            a.total_pnl_raw,
            COALESCE(a.realized_pnl_raw, 0)   AS realized_pnl_raw,
            COALESCE(a.unrealized_pnl_raw, 0)  AS unrealized_pnl_raw,
            COALESCE(
                (a.total_pnl_raw * 100.0
                 / NULLIF(a.equity_at_start + a.total_deposits_raw, 0))::NUMERIC(20,4),
                0::NUMERIC(20,4)
            ) AS pnl_pct,
            COALESCE(
                (a.realized_pnl_raw * 100.0
                 / NULLIF(a.equity_at_start + a.total_deposits_raw, 0))::NUMERIC(20,4),
                0::NUMERIC(20,4)
            ) AS realized_pnl_pct,
            COALESCE(
                (a.unrealized_pnl_raw * 100.0
                 / NULLIF(a.equity_at_start + a.total_deposits_raw, 0))::NUMERIC(20,4),
                0::NUMERIC(20,4)
            ) AS unrealized_pnl_pct,
            a.total_position_count,
            a.active_position_count,
            a.winning_positions,
            a.losing_positions,
            COALESCE(
                (a.winning_positions * 100.0
                 / NULLIF(a.total_position_count, 0))::NUMERIC(10,2),
                0::NUMERIC(10,2)
            ) AS win_rate,
            a.total_deposits_raw,
            a.total_redemptions_raw,
            (a.total_deposits_raw + a.total_redemptions_raw)::NUMERIC AS total_volume_raw,
            a.equity_at_start,
            a.equity_at_end
        FROM account_agg a
    ),

    ranked AS (
        SELECT
            e.*,
            CASE
                WHEN p_sort_by IN ('total_pnl', 'pnl') THEN
                    CASE p_sort_order
                        WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.total_pnl_raw ASC NULLS LAST)
                        ELSE            ROW_NUMBER() OVER (ORDER BY e.total_pnl_raw DESC NULLS LAST)
                    END
                WHEN p_sort_by IN ('pnl_pct', 'roi') THEN
                    CASE p_sort_order
                        WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.pnl_pct ASC NULLS LAST)
                        ELSE            ROW_NUMBER() OVER (ORDER BY e.pnl_pct DESC NULLS LAST)
                    END
                WHEN p_sort_by = 'realized_pnl' THEN
                    CASE p_sort_order
                        WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.realized_pnl_raw ASC NULLS LAST)
                        ELSE            ROW_NUMBER() OVER (ORDER BY e.realized_pnl_raw DESC NULLS LAST)
                    END
                WHEN p_sort_by = 'unrealized_pnl' THEN
                    CASE p_sort_order
                        WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.unrealized_pnl_raw ASC NULLS LAST)
                        ELSE            ROW_NUMBER() OVER (ORDER BY e.unrealized_pnl_raw DESC NULLS LAST)
                    END
                WHEN p_sort_by = 'win_rate' THEN
                    CASE p_sort_order
                        WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.win_rate ASC NULLS LAST)
                        ELSE            ROW_NUMBER() OVER (ORDER BY e.win_rate DESC NULLS LAST)
                    END
                WHEN p_sort_by IN ('total_volume', 'volume') THEN
                    CASE p_sort_order
                        WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.total_volume_raw ASC NULLS LAST)
                        ELSE            ROW_NUMBER() OVER (ORDER BY e.total_volume_raw DESC NULLS LAST)
                    END
                ELSE ROW_NUMBER() OVER (ORDER BY e.total_pnl_raw DESC NULLS LAST)
            END AS rank
        FROM enriched e
    )

    SELECT
        r.rank,
        r.account_id,
        r.total_pnl_raw,
        ROUND(r.total_pnl_raw       / 1e18, 4)::NUMERIC(30,4),
        r.realized_pnl_raw,
        ROUND(r.realized_pnl_raw    / 1e18, 4)::NUMERIC(30,4),
        r.unrealized_pnl_raw,
        ROUND(r.unrealized_pnl_raw  / 1e18, 4)::NUMERIC(30,4),
        r.pnl_pct,
        r.realized_pnl_pct,
        r.unrealized_pnl_pct,
        r.total_position_count,
        r.active_position_count,
        r.winning_positions,
        r.losing_positions,
        r.win_rate,
        r.total_deposits_raw,
        ROUND(r.total_deposits_raw      / 1e18, 4)::NUMERIC(30,4),
        r.total_redemptions_raw,
        ROUND(r.total_redemptions_raw   / 1e18, 4)::NUMERIC(30,4),
        r.total_volume_raw,
        ROUND(r.total_volume_raw        / 1e18, 4)::NUMERIC(30,4),
        r.equity_at_start,
        r.equity_at_end,
        ROUND(r.equity_at_end          / 1e18, 4)::NUMERIC(30,4)
    FROM ranked r
    ORDER BY r.rank
    LIMIT v_limit OFFSET v_offset;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_pnl_leaderboard_period(TIMESTAMPTZ, TIMESTAMPTZ, INTEGER, INTEGER, TEXT, TEXT, INTEGER, NUMERIC, NUMERIC, TEXT) IS
    'Period-based PnL leaderboard using position_change_hourly continuous aggregate '
    'for cumulative position snapshots and share_price_stats_hourly for price lookups. '
    'Sort options: total_pnl/pnl, pnl_pct/roi, realized_pnl, unrealized_pnl, win_rate, '
    'total_volume/volume. Filters: p_min_deposit (ETH), p_min_positions, p_min_volume (ETH), '
    'p_term_id (scope to single vault).';
