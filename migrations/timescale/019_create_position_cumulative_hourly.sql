-- position_cumulative_hourly: running totals per (account, term, curve) at hourly granularity.
--
-- Enables O(1) point-in-time position lookups for period leaderboards.
-- Instead of SUM(deltas WHERE bucket <= T) which scans millions of rows,
-- a simple DISTINCT ON ... ORDER BY bucket DESC gives the snapshot instantly.

CREATE TABLE IF NOT EXISTS position_cumulative_hourly (
    bucket              TIMESTAMPTZ NOT NULL,
    account_id          TEXT        NOT NULL,
    term_id             TEXT        NOT NULL,
    curve_id            TEXT        NOT NULL,
    cumulative_shares       NUMERIC NOT NULL DEFAULT 0,
    cumulative_assets_in    NUMERIC NOT NULL DEFAULT 0,
    cumulative_assets_out   NUMERIC NOT NULL DEFAULT 0,
    cumulative_shares_in    NUMERIC NOT NULL DEFAULT 0,
    cumulative_shares_out   NUMERIC NOT NULL DEFAULT 0
);

SELECT create_hypertable('position_cumulative_hourly', 'bucket',
    if_not_exists => true
);

-- Primary lookup: "latest cumulative snapshot for (account, term, curve) at time T"
-- DISTINCT ON + ORDER BY bucket DESC uses this for O(1) lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_pcumh_pk
    ON position_cumulative_hourly (account_id, term_id, curve_id, bucket DESC);

-- For vault-scoped queries: "all positions in vault Y at time T"
CREATE INDEX IF NOT EXISTS idx_pcumh_term
    ON position_cumulative_hourly (term_id, curve_id, bucket DESC);

-- Compression: historical chunks are append-only, safe to compress
DO $$ BEGIN
    ALTER TABLE position_cumulative_hourly
        SET (timescaledb.compress,
             timescaledb.compress_segmentby = 'account_id, term_id, curve_id',
             timescaledb.compress_orderby = 'bucket DESC');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    PERFORM add_compression_policy('position_cumulative_hourly',
        compress_after => INTERVAL '30 days',
        if_not_exists => true
    );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
