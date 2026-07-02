-- Fix term_market_cap_history.total_market_cap which was set to total_assets
-- by migration 028. For non-standard bonding curves (curve_id=2), market_cap
-- differs significantly from total_assets.
--
-- We join on event_id to share_price_history (which has share_price and
-- total_shares) to recompute the correct value.

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
            'UPDATE %I.%I tmch
             SET total_market_cap = sph.total_shares * sph.share_price / 1000000000000000000::numeric
             FROM share_price_history sph
             WHERE tmch.event_id = sph.event_id
               AND sph.total_shares > 0
               AND sph.share_price > 0
               AND tmch.total_market_cap <> (sph.total_shares * sph.share_price / 1000000000000000000::numeric)',
            r.chunk_schema, r.chunk_name
        );
        GET DIAGNOSTICS updated = ROW_COUNT;
        IF updated > 0 THEN
            RAISE NOTICE 'term_market_cap_history chunk %.% — % rows updated', r.chunk_schema, r.chunk_name, updated;
        END IF;
    END LOOP;
END;
$$;

VACUUM ANALYZE term_market_cap_history;
