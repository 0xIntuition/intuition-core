CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    total_atoms BIGINT NOT NULL DEFAULT 0,
    total_triples BIGINT NOT NULL DEFAULT 0,
    total_accounts BIGINT NOT NULL DEFAULT 0,
    total_deposits_count BIGINT NOT NULL DEFAULT 0,
    total_redemptions_count BIGINT NOT NULL DEFAULT 0,
    total_deposit_volume NUMERIC NOT NULL DEFAULT 0,
    total_redemption_volume NUMERIC NOT NULL DEFAULT 0,
    total_fees NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure singleton row exists
INSERT INTO stats (id) VALUES (1) ON CONFLICT DO NOTHING;

CREATE TABLE IF NOT EXISTS stats_history (
    total_atoms BIGINT NOT NULL,
    total_triples BIGINT NOT NULL,
    total_accounts BIGINT NOT NULL,
    total_deposits_count BIGINT NOT NULL,
    total_redemptions_count BIGINT NOT NULL,
    total_deposit_volume NUMERIC NOT NULL,
    total_redemption_volume NUMERIC NOT NULL,
    total_fees NUMERIC NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);

SELECT create_hypertable('stats_history', 'ts', if_not_exists => TRUE);
