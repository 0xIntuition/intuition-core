-- Canonical PG fact tables for all event types.
-- event_id = '{transaction_hash}-{log_index}-{event_type}' for idempotent inserts.

CREATE TABLE IF NOT EXISTS event (
    event_id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_event_type_ts ON event (event_type, ts);
CREATE INDEX IF NOT EXISTS idx_event_block ON event (block_number DESC);

CREATE TABLE IF NOT EXISTS deposit_fact (
    event_id TEXT PRIMARY KEY REFERENCES event(event_id),
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    term_id TEXT NOT NULL,
    curve_id TEXT NOT NULL,
    vault_type INTEGER,
    assets NUMERIC NOT NULL,
    assets_after_fees NUMERIC NOT NULL,
    shares NUMERIC NOT NULL,
    total_shares NUMERIC NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deposit_fact_sender ON deposit_fact (sender_id, ts);
CREATE INDEX IF NOT EXISTS idx_deposit_fact_term ON deposit_fact (term_id, ts);

CREATE TABLE IF NOT EXISTS redemption_fact (
    event_id TEXT PRIMARY KEY REFERENCES event(event_id),
    sender_id TEXT NOT NULL,
    receiver_id TEXT NOT NULL,
    term_id TEXT NOT NULL,
    curve_id TEXT NOT NULL,
    vault_type INTEGER,
    shares NUMERIC NOT NULL,
    total_shares NUMERIC NOT NULL,
    assets NUMERIC NOT NULL,
    fees NUMERIC NOT NULL,
    block_number BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_redemption_fact_sender ON redemption_fact (sender_id, ts);
CREATE INDEX IF NOT EXISTS idx_redemption_fact_term ON redemption_fact (term_id, ts);

CREATE TABLE IF NOT EXISTS fee_transfer_fact (
    event_id TEXT PRIMARY KEY REFERENCES event(event_id),
    sender_id TEXT NOT NULL,
    amount NUMERIC NOT NULL,
    epoch TEXT,
    block_number BIGINT NOT NULL,
    transaction_hash TEXT NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_fee_transfer_sender ON fee_transfer_fact (sender_id, ts);
