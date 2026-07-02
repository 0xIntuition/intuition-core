-- Position current state (PK: account_id + term_id + curve_id)
CREATE TABLE IF NOT EXISTS position (
    account_id TEXT NOT NULL,
    term_id TEXT NOT NULL,
    curve_id TEXT NOT NULL,
    shares NUMERIC NOT NULL DEFAULT 0,
    total_deposits NUMERIC NOT NULL DEFAULT 0,
    total_deposits_value NUMERIC NOT NULL DEFAULT 0,
    total_shares_acquired NUMERIC NOT NULL DEFAULT 0,
    cost_basis NUMERIC NOT NULL DEFAULT 0,
    realized_pnl NUMERIC NOT NULL DEFAULT 0,
    opened_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (account_id, term_id, curve_id)
);

CREATE INDEX IF NOT EXISTS idx_position_account ON position (account_id);
CREATE INDEX IF NOT EXISTS idx_position_term ON position (term_id, curve_id);

-- Position change time-series (hypertable)
CREATE TABLE IF NOT EXISTS position_change (
    event_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    term_id TEXT NOT NULL,
    curve_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    shares_delta NUMERIC NOT NULL,
    assets_in NUMERIC NOT NULL DEFAULT 0,
    assets_out NUMERIC NOT NULL DEFAULT 0,
    execution_price NUMERIC NOT NULL DEFAULT 0,
    block_number BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);

SELECT create_hypertable('position_change', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_pc_account ON position_change (account_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_pc_term ON position_change (term_id, curve_id, ts DESC);
