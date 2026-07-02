-- Fix market_cap values inflated by 10^18 due to multiplying two wei-scaled
-- values (total_shares * share_price) without normalizing.
--
-- The correct market_cap equals total_assets (already stored alongside
-- market_cap in every affected table), so we overwrite market_cap with
-- total_assets. This avoids any precision loss from dividing by 1e18.
--
-- Hypertable UPDATEs are batched per-chunk to avoid overwhelming the DB
-- with a single massive transaction (WAL spike, 100% CPU, lock contention).

-- 1. Small tables first (instant)
UPDATE vault
SET    market_cap = total_assets
WHERE  total_assets > 0;

UPDATE term_summary
SET    total_market_cap = total_assets
WHERE  total_assets > 0;

UPDATE predicate_object_summary
SET    total_market_cap = total_assets
WHERE  total_assets > 0;

UPDATE subject_predicate_summary
SET    total_market_cap = total_assets
WHERE  total_assets > 0;

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
            'UPDATE %I.%I SET market_cap = total_assets WHERE total_assets > 0 AND market_cap <> total_assets',
            r.chunk_schema, r.chunk_name
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        RAISE NOTICE 'share_price_history chunk %.% — % rows updated', r.chunk_schema, r.chunk_name, updated;
    END LOOP;
END;
$$;

-- 3. term_market_cap_history hypertable — update chunk by chunk
DO $$
DECLARE
    r RECORD;
    updated BIGINT;
BEGIN
    FOR r IN
        SELECT chunk_schema, chunk_name
        FROM timescaledb_information.chunks
        WHERE hypertable_name = 'term_market_cap_history'
        ORDER BY range_start
    LOOP
        EXECUTE format(
            'UPDATE %I.%I SET total_market_cap = total_assets WHERE total_assets > 0 AND total_market_cap <> total_assets',
            r.chunk_schema, r.chunk_name
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        RAISE NOTICE 'term_market_cap_history chunk %.% — % rows updated', r.chunk_schema, r.chunk_name, updated;
    END LOOP;
END;
$$;

-- 4. Reclaim dead tuples
VACUUM ANALYZE share_price_history;
VACUUM ANALYZE term_market_cap_history;

-- 5. Refresh continuous aggregates with bounded range.
--    CALL doesn't support subqueries as arguments, so we use a DO block.
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
