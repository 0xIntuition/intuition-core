CREATE TABLE IF NOT EXISTS signal (
    event_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    term_id TEXT NOT NULL,
    curve_id TEXT NOT NULL,
    signal_type TEXT NOT NULL CHECK (signal_type IN ('deposit', 'redemption')),
    delta NUMERIC NOT NULL,
    block_number BIGINT NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);

SELECT create_hypertable('signal', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_signal_account ON signal (account_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_signal_term ON signal (term_id, curve_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_signal_type ON signal (signal_type, ts DESC);

-- Continuous aggregates
CREATE MATERIALIZED VIEW IF NOT EXISTS signal_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', ts) AS bucket,
    account_id,
    term_id,
    curve_id,
    signal_type,
    sum(delta) AS total_delta,
    count(*) AS num_signals
FROM signal
GROUP BY bucket, account_id, term_id, curve_id, signal_type
WITH NO DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS signal_daily
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 day', ts) AS bucket,
    account_id,
    term_id,
    curve_id,
    signal_type,
    sum(delta) AS total_delta,
    count(*) AS num_signals
FROM signal
GROUP BY bucket, account_id, term_id, curve_id, signal_type
WITH NO DATA;
