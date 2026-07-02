-- Replace pnl_leaderboard_entry type and get_pnl_leaderboard_period function
-- with optimized version using position_cumulative_hourly for O(1) lookups.
--
-- Key improvements over migration 017:
-- 1. O(1) cumulative snapshot lookups (DISTINCT ON) vs O(N) SUM scans
-- 2. Correct per-share cost basis with shares_acquired/redeemed_in_period
-- 3. Protocol account exclusion (ProtocolVault, AtomWallet)
-- 4. Current-hour price patch from raw share_price_history
-- 5. Expanded 37-column return type (account_label, best/worst trade, etc.)
-- 6. Separate realized/unrealized PnL % denominators

-- ========================================
-- Step 1: Drop old type (CASCADE drops dependent function)
-- ========================================
DROP TYPE IF EXISTS pnl_leaderboard_entry CASCADE;

-- ========================================
-- Step 2: Expanded return type (37 columns, matching old system parity)
-- ========================================
DO $$ BEGIN
CREATE TYPE pnl_leaderboard_entry AS (
    rank                            BIGINT,
    account_id                      TEXT,
    account_label                   TEXT,
    account_image                   TEXT,
    total_pnl_raw                   NUMERIC,
    total_pnl_formatted             NUMERIC(30,4),
    realized_pnl_raw                NUMERIC,
    realized_pnl_formatted          NUMERIC(30,4),
    unrealized_pnl_raw              NUMERIC,
    unrealized_pnl_formatted        NUMERIC(30,4),
    pnl_pct                         NUMERIC(20,4),
    realized_pnl_pct                NUMERIC(20,4),
    unrealized_pnl_pct              NUMERIC(20,4),
    pnl_change_raw                  NUMERIC,
    pnl_change_formatted            NUMERIC(30,4),
    total_position_count            BIGINT,
    active_position_count           BIGINT,
    winning_positions               BIGINT,
    losing_positions                BIGINT,
    win_rate                        NUMERIC(10,2),
    total_deposits_raw              NUMERIC,
    total_deposits_formatted        NUMERIC(30,4),
    total_redemptions_raw           NUMERIC,
    total_redemptions_formatted     NUMERIC(30,4),
    total_volume_raw                NUMERIC,
    total_volume_formatted          NUMERIC(30,4),
    current_equity_value_raw        NUMERIC,
    current_equity_value_formatted  NUMERIC(30,4),
    best_trade_pnl_raw              NUMERIC,
    best_trade_pnl_formatted        NUMERIC(30,4),
    worst_trade_pnl_raw             NUMERIC,
    worst_trade_pnl_formatted       NUMERIC(30,4),
    redeemable_assets_raw           NUMERIC,
    redeemable_assets_formatted     NUMERIC(30,4),
    first_position_at               TIMESTAMPTZ,
    last_activity_at                TIMESTAMPTZ
);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ========================================
-- Step 3: Optimized function using cumulative snapshots
-- ========================================
CREATE OR REPLACE FUNCTION get_pnl_leaderboard_period(
    p_start_date                    TIMESTAMPTZ,
    p_end_date                      TIMESTAMPTZ,
    p_limit                         INTEGER   DEFAULT 100,
    p_offset                        INTEGER   DEFAULT 0,
    p_sort_by                       TEXT      DEFAULT 'total_pnl',
    p_sort_order                    TEXT      DEFAULT 'DESC',
    p_exclude_protocol_accounts     BOOLEAN   DEFAULT TRUE,
    p_min_positions                 INTEGER   DEFAULT 1,
    p_min_volume                    NUMERIC   DEFAULT 0,
    p_term_id                       TEXT      DEFAULT NULL,
    p_min_deposit                   NUMERIC   DEFAULT 0
)
RETURNS SETOF pnl_leaderboard_entry AS $$
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
    -- Step 2: Cumulative snapshots at start and end — O(1) per position!
    --
    -- DISTINCT ON + ORDER BY bucket DESC on the unique index gives us the
    -- latest cumulative row at or before the target time.
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
        WHERE pc.bucket < v_hour_start
          AND (p_term_id IS NULL OR pc.term_id = p_term_id)
        ORDER BY pc.account_id, pc.term_id, pc.curve_id, pc.bucket DESC
    )
    SELECT
        e.account_id,
        e.term_id,
        e.curve_id,
        COALESCE(s.shares_at_start, 0)::NUMERIC       AS shares_at_start,
        e.shares_at_end::NUMERIC                        AS shares_at_end,
        -- Period activity from cumulative diffs
        (e.cum_assets_in_end  - COALESCE(s.cum_assets_in_start,  0))::NUMERIC AS period_deposits,
        (e.cum_assets_out_end - COALESCE(s.cum_assets_out_start, 0))::NUMERIC AS period_redemptions,
        -- Gross share flows (for cost basis)
        (e.cum_shares_in_end  - COALESCE(s.cum_shares_in_start,  0))::NUMERIC AS shares_acquired_in_period,
        (e.cum_shares_out_end - COALESCE(s.cum_shares_out_start, 0))::NUMERIC AS shares_redeemed_in_period,
        -- For min_deposit filter
        e.cum_assets_in_end::NUMERIC AS cumulative_deposits,
        -- Had activity?
        ((e.cum_assets_in_end - COALESCE(s.cum_assets_in_start, 0)) > 0
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
    -- Step 3: Price lookups (cagg + raw fallback + current-hour patch)
    ---------------------------------------------------------------------------

    -- Start prices from share_price_stats_hourly cagg
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

    -- Fallback: raw share_price_history for vaults not covered by cagg
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

    -- End prices from share_price_stats_hourly cagg
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

    -- Current-hour patch: if p_end_date is in the current incomplete hour,
    -- update end prices from raw share_price_history for freshest data
    IF p_end_date > v_cagg_cutoff THEN
        -- Update existing cagg entries with newer raw data
        WITH raw_current AS (
            SELECT DISTINCT ON (sph.term_id, sph.curve_id)
                sph.term_id, sph.curve_id, sph.share_price
            FROM share_price_history sph
            WHERE sph.ts > v_cagg_cutoff
              AND sph.ts <= p_end_date
              AND EXISTS (
                  SELECT 1 FROM _tmp_price_end pe
                  WHERE pe.term_id = sph.term_id AND pe.curve_id = sph.curve_id
              )
            ORDER BY sph.term_id, sph.curve_id, sph.ts DESC
        )
        UPDATE _tmp_price_end pe
        SET share_price = rc.share_price
        FROM raw_current rc
        WHERE pe.term_id = rc.term_id AND pe.curve_id = rc.curve_id;

        -- Insert for vaults that had NO cagg entry but DO have raw data
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
    END IF;

    -- Also fallback for end prices when cagg has no data at all
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
    -- Step 4: Compute PnL, aggregate per account, rank, return
    ---------------------------------------------------------------------------
    RETURN QUERY
    WITH
    position_metrics AS (
        SELECT
            p.account_id, p.term_id, p.curve_id,
            p.shares_at_start, p.shares_at_end,
            p.period_deposits, p.period_redemptions,
            p.shares_acquired_in_period, p.shares_redeemed_in_period,
            p.had_activity, p.cumulative_deposits,
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
             + pm.period_redemptions - pm.period_deposits)::NUMERIC AS period_total_pnl,
            CASE WHEN (pm.equity_at_end - pm.equity_at_start
                       + pm.period_redemptions - pm.period_deposits) > 0
                 THEN 1 ELSE 0 END AS is_winning,
            CASE WHEN (pm.equity_at_end - pm.equity_at_start
                       + pm.period_redemptions - pm.period_deposits) < 0
                 THEN 1 ELSE 0 END AS is_losing,
            -- Realized PnL with correct per-share cost basis
            CASE
                -- Fully closed: all PnL is realized
                WHEN pm.shares_at_end <= 0 THEN
                    (pm.equity_at_end - pm.equity_at_start
                     + pm.period_redemptions - pm.period_deposits)::NUMERIC
                -- No redemptions: all PnL is unrealized
                WHEN pm.shares_redeemed_in_period <= 0 THEN 0::NUMERIC
                -- Partial: realized = redemption_proceeds - proportional_cost_basis
                -- cost_per_share = (equity_at_start + deposits) / (shares_at_start + shares_in)
                ELSE (pm.period_redemptions - TRUNC(
                    (pm.equity_at_start + pm.period_deposits)
                    * pm.shares_redeemed_in_period
                    / NULLIF(pm.shares_at_start + pm.shares_acquired_in_period, 0)
                ))::NUMERIC
            END AS realized_pnl
        FROM position_metrics pm
    ),

    filtered AS (
        SELECT * FROM position_pnl
        WHERE p_min_deposit <= 0 OR cumulative_deposits >= p_min_deposit * 1e18
    ),

    account_agg AS (
        SELECT
            f.account_id,
            COUNT(DISTINCT (f.term_id, f.curve_id))
                FILTER (WHERE f.had_activity)               AS total_position_count,
            COUNT(DISTINCT (f.term_id, f.curve_id))
                FILTER (WHERE f.shares_at_end > 0)          AS active_position_count,
            SUM(f.is_winning) FILTER (WHERE f.had_activity) AS winning_positions,
            SUM(f.is_losing)  FILTER (WHERE f.had_activity) AS losing_positions,
            SUM(f.period_deposits)::NUMERIC                 AS period_deposits_raw,
            SUM(f.period_redemptions)::NUMERIC              AS period_redemptions_raw,
            SUM(f.period_total_pnl)::NUMERIC                AS total_pnl_raw,
            SUM(f.realized_pnl)::NUMERIC                    AS realized_pnl_raw,
            SUM(f.period_total_pnl - f.realized_pnl)::NUMERIC AS unrealized_pnl_raw,
            SUM(f.equity_at_start)::NUMERIC                 AS equity_at_start,
            SUM(f.equity_at_end)::NUMERIC                   AS equity_at_end,
            MAX(f.period_total_pnl)                         AS best_trade_pnl_raw,
            MIN(f.period_total_pnl)                         AS worst_trade_pnl_raw,
            -- Separate denominators for realized vs unrealized PnL %
            SUM(CASE
                WHEN f.shares_at_end <= 0 THEN f.equity_at_start + f.period_deposits
                WHEN f.period_redemptions <= 0 THEN 0
                ELSE TRUNC((f.equity_at_start + f.period_deposits) * f.shares_redeemed_in_period
                     / NULLIF(f.shares_at_start + f.shares_acquired_in_period, 0))
            END)::NUMERIC AS denominator_closed,
            SUM(CASE
                WHEN f.shares_at_end <= 0 THEN 0
                WHEN f.period_redemptions <= 0 THEN f.equity_at_start + f.period_deposits
                ELSE TRUNC((f.equity_at_start + f.period_deposits) * f.shares_at_end
                     / NULLIF(f.shares_at_start + f.shares_acquired_in_period, 0))
            END)::NUMERIC AS denominator_open
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
            am.account_id,
            a.account_label,
            a.account_image,
            am.total_pnl_raw,
            COALESCE(am.realized_pnl_raw, 0)   AS realized_pnl_raw,
            COALESCE(am.unrealized_pnl_raw, 0)  AS unrealized_pnl_raw,
            COALESCE(
                (am.total_pnl_raw * 100.0
                 / NULLIF(am.equity_at_start + am.period_deposits_raw, 0))::NUMERIC(20,4),
                0::NUMERIC(20,4)
            ) AS pnl_pct,
            COALESCE(
                (COALESCE(am.realized_pnl_raw, 0) * 100.0
                 / NULLIF(am.denominator_closed, 0))::NUMERIC(20,4),
                0::NUMERIC(20,4)
            ) AS realized_pnl_pct,
            COALESCE(
                (COALESCE(am.unrealized_pnl_raw, 0) * 100.0
                 / NULLIF(am.denominator_open, 0))::NUMERIC(20,4),
                0::NUMERIC(20,4)
            ) AS unrealized_pnl_pct,
            am.total_pnl_raw                    AS pnl_change_raw,
            am.total_position_count,
            am.active_position_count,
            am.winning_positions,
            am.losing_positions,
            COALESCE(
                (am.winning_positions * 100.0
                 / NULLIF(am.total_position_count, 0))::NUMERIC(10,2),
                0::NUMERIC(10,2)
            ) AS win_rate,
            am.period_deposits_raw              AS total_deposits_raw,
            am.period_redemptions_raw           AS total_redemptions_raw,
            (am.period_deposits_raw + am.period_redemptions_raw)::NUMERIC AS total_volume_raw,
            am.equity_at_end                    AS current_equity_value_raw,
            am.best_trade_pnl_raw,
            am.worst_trade_pnl_raw,
            ast.first_position_at,
            ast.last_activity_at
        FROM account_agg am
        JOIN account a ON am.account_id = a.account_id
        LEFT JOIN account_stats ast ON ast.account_id = am.account_id
        WHERE NOT p_exclude_protocol_accounts
           OR a.account_type NOT IN ('ProtocolVault', 'AtomWallet')
    ),

    ranked AS (
        SELECT e.*,
            CASE
                WHEN p_sort_by IN ('total_pnl', 'pnl') THEN
                    CASE p_sort_order WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.total_pnl_raw ASC NULLS LAST)
                    ELSE ROW_NUMBER() OVER (ORDER BY e.total_pnl_raw DESC NULLS LAST) END
                WHEN p_sort_by IN ('pnl_pct', 'roi') THEN
                    CASE p_sort_order WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.pnl_pct ASC NULLS LAST)
                    ELSE ROW_NUMBER() OVER (ORDER BY e.pnl_pct DESC NULLS LAST) END
                WHEN p_sort_by = 'realized_pnl' THEN
                    CASE p_sort_order WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.realized_pnl_raw ASC NULLS LAST)
                    ELSE ROW_NUMBER() OVER (ORDER BY e.realized_pnl_raw DESC NULLS LAST) END
                WHEN p_sort_by = 'unrealized_pnl' THEN
                    CASE p_sort_order WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.unrealized_pnl_raw ASC NULLS LAST)
                    ELSE ROW_NUMBER() OVER (ORDER BY e.unrealized_pnl_raw DESC NULLS LAST) END
                WHEN p_sort_by = 'realized_pnl_pct' THEN
                    CASE p_sort_order WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.realized_pnl_pct ASC NULLS LAST)
                    ELSE ROW_NUMBER() OVER (ORDER BY e.realized_pnl_pct DESC NULLS LAST) END
                WHEN p_sort_by = 'unrealized_pnl_pct' THEN
                    CASE p_sort_order WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.unrealized_pnl_pct ASC NULLS LAST)
                    ELSE ROW_NUMBER() OVER (ORDER BY e.unrealized_pnl_pct DESC NULLS LAST) END
                WHEN p_sort_by = 'win_rate' THEN
                    CASE p_sort_order WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.win_rate ASC NULLS LAST)
                    ELSE ROW_NUMBER() OVER (ORDER BY e.win_rate DESC NULLS LAST) END
                WHEN p_sort_by IN ('total_volume', 'volume') THEN
                    CASE p_sort_order WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.total_volume_raw ASC NULLS LAST)
                    ELSE ROW_NUMBER() OVER (ORDER BY e.total_volume_raw DESC NULLS LAST) END
                WHEN p_sort_by IN ('position_count', 'positions') THEN
                    CASE p_sort_order WHEN 'ASC' THEN ROW_NUMBER() OVER (ORDER BY e.total_position_count ASC NULLS LAST)
                    ELSE ROW_NUMBER() OVER (ORDER BY e.total_position_count DESC NULLS LAST) END
                ELSE ROW_NUMBER() OVER (ORDER BY e.total_pnl_raw DESC NULLS LAST)
            END AS rank
        FROM enriched e
    )

    SELECT
        r.rank,
        r.account_id,
        r.account_label,
        r.account_image,
        r.total_pnl_raw,
        ROUND(r.total_pnl_raw / 1e18, 4)::NUMERIC(30,4),
        r.realized_pnl_raw,
        ROUND(r.realized_pnl_raw / 1e18, 4)::NUMERIC(30,4),
        r.unrealized_pnl_raw,
        ROUND(r.unrealized_pnl_raw / 1e18, 4)::NUMERIC(30,4),
        r.pnl_pct,
        r.realized_pnl_pct,
        r.unrealized_pnl_pct,
        r.pnl_change_raw,
        ROUND(r.pnl_change_raw / 1e18, 4)::NUMERIC(30,4),
        r.total_position_count,
        r.active_position_count,
        r.winning_positions,
        r.losing_positions,
        r.win_rate,
        r.total_deposits_raw,
        ROUND(r.total_deposits_raw / 1e18, 4)::NUMERIC(30,4),
        r.total_redemptions_raw,
        ROUND(r.total_redemptions_raw / 1e18, 4)::NUMERIC(30,4),
        r.total_volume_raw,
        ROUND(r.total_volume_raw / 1e18, 4)::NUMERIC(30,4),
        r.current_equity_value_raw,
        ROUND(r.current_equity_value_raw / 1e18, 4)::NUMERIC(30,4),
        r.best_trade_pnl_raw,
        ROUND(r.best_trade_pnl_raw / 1e18, 4)::NUMERIC(30,4),
        r.worst_trade_pnl_raw,
        ROUND(r.worst_trade_pnl_raw / 1e18, 4)::NUMERIC(30,4),
        NULL::NUMERIC,          -- redeemable_assets_raw (placeholder)
        NULL::NUMERIC(30,4),    -- redeemable_assets_formatted
        r.first_position_at,
        r.last_activity_at
    FROM ranked r
    ORDER BY r.rank
    LIMIT v_limit OFFSET v_offset;
END;
$$ LANGUAGE plpgsql;

COMMENT ON FUNCTION get_pnl_leaderboard_period IS
    'Period-based PnL leaderboard using position_cumulative_hourly for O(1) snapshot lookups. '
    'Features: protocol account exclusion, current-hour price patch, per-share cost basis, '
    'separate realized/unrealized PnL % denominators, best/worst trade tracking. '
    'Sort: total_pnl, pnl_pct/roi, realized_pnl, unrealized_pnl, realized_pnl_pct, '
    'unrealized_pnl_pct, win_rate, total_volume/volume, position_count/positions.';
