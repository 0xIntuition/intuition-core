-- Vault current state (PK: term_id + curve_id)
CREATE TABLE IF NOT EXISTS vault (
    term_id TEXT NOT NULL,
    curve_id TEXT NOT NULL,
    total_shares NUMERIC NOT NULL DEFAULT 0,
    current_share_price NUMERIC NOT NULL DEFAULT 0,
    total_assets NUMERIC NOT NULL DEFAULT 0,
    total_deposits NUMERIC NOT NULL DEFAULT 0,
    total_redemptions NUMERIC NOT NULL DEFAULT 0,
    market_cap NUMERIC NOT NULL DEFAULT 0,
    holder_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (term_id, curve_id)
);

-- Share price time-series (hypertable)
CREATE TABLE IF NOT EXISTS share_price_history (
    event_id TEXT NOT NULL,
    term_id TEXT NOT NULL,
    curve_id TEXT NOT NULL,
    share_price NUMERIC NOT NULL,
    total_assets NUMERIC NOT NULL,
    total_shares NUMERIC NOT NULL,
    market_cap NUMERIC NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);

SELECT create_hypertable('share_price_history', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_sph_term_curve ON share_price_history (term_id, curve_id, ts DESC);

-- Continuous aggregates
CREATE MATERIALIZED VIEW IF NOT EXISTS share_price_stats_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', ts) AS bucket,
    term_id,
    curve_id,
    first(share_price, ts) AS open_price,
    max(share_price) AS high_price,
    min(share_price) AS low_price,
    last(share_price, ts) AS close_price,
    last(total_assets, ts) AS total_assets,
    last(total_shares, ts) AS total_shares,
    last(market_cap, ts) AS market_cap,
    count(*) AS num_changes
FROM share_price_history
GROUP BY bucket, term_id, curve_id
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS share_price_stats_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', ts) AS bucket,
    term_id,
    curve_id,
    first(share_price, ts) AS open_price,
    max(share_price) AS high_price,
    min(share_price) AS low_price,
    last(share_price, ts) AS close_price,
    last(total_assets, ts) AS total_assets,
    last(total_shares, ts) AS total_shares,
    last(market_cap, ts) AS market_cap,
    count(*) AS num_changes
FROM share_price_history
GROUP BY bucket, term_id, curve_id
WITH NO DATA;
