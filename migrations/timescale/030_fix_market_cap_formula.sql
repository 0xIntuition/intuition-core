-- Fix market_cap values for non-standard bonding curves (e.g. curve_id=2).
--
-- Migration 028 set market_cap = total_assets, which is only correct for
-- standard ERC4626 vaults (curve_id=1). For other curves, sharePrice is not
-- derived from totalAssets/totalShares, so market_cap must be computed as
-- total_shares * share_price / 1e18.
--
-- term_market_cap_history lacks share_price/total_shares columns, so it
-- cannot be recomputed here. Going forward the code writes the correct
-- value; historical term-level rows retain the total_assets approximation.

-- 1. vault table: recompute market_cap from snapshot fields
UPDATE vault
SET    market_cap = total_shares * current_share_price / 1000000000000000000::numeric
WHERE  total_shares > 0 AND current_share_price > 0;

-- 2. share_price_history hypertable — update chunk by chunk
DO $$
DECLARE
    r RECORD;
    updated BIGINT;
BEGIN
    FOR r IN
        SELECT chunk_schema, chunk_name
        FROM timescaledb_information.chunks
        WHERE hypertable_name = 'share_price_history'
        ORDER BY range_start
    LOOP
        EXECUTE format(
            'UPDATE %I.%I SET market_cap = total_shares * share_price / 1000000000000000000::numeric WHERE total_shares > 0 AND share_price > 0 AND market_cap <> (total_shares * share_price / 1000000000000000000::numeric)',
            r.chunk_schema, r.chunk_name
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        IF updated > 0 THEN
            RAISE NOTICE 'share_price_history chunk %.% — % rows updated', r.chunk_schema, r.chunk_name, updated;
        END IF;
    END LOOP;
END;
$$;

-- 3. term_summary: recompute from vault market_cap (sum across curves)
UPDATE term_summary ts
SET    total_market_cap = COALESCE(sub.mcap, 0)
FROM (
    SELECT term_id, SUM(market_cap) AS mcap
    FROM vault
    GROUP BY term_id
) sub
WHERE ts.term_id = sub.term_id;

-- 4. Reclaim dead tuples
VACUUM ANALYZE share_price_history;

-- 5. Refresh continuous aggregates
DO $$
DECLARE
    min_ts TIMESTAMPTZ;
BEGIN
    SELECT min(ts) INTO min_ts FROM share_price_history;
    IF min_ts IS NOT NULL THEN
        CALL refresh_continuous_aggregate('share_price_stats_hourly', min_ts, now());
        CALL refresh_continuous_aggregate('share_price_stats_daily', min_ts, now());
    END IF;
END;
$$;
