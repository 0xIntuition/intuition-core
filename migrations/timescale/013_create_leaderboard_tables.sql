-- Dirty sets for incremental leaderboard refresh
CREATE TABLE IF NOT EXISTS dirty_account (
    account_id TEXT PRIMARY KEY,
    reason TEXT,
    first_marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS dirty_vault (
    term_id TEXT NOT NULL,
    curve_id TEXT NOT NULL,
    first_marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (term_id, curve_id)
);

-- Account activity stats
CREATE TABLE IF NOT EXISTS account_stats (
    account_id TEXT PRIMARY KEY,
    total_position_count INTEGER NOT NULL DEFAULT 0,
    active_position_count INTEGER NOT NULL DEFAULT 0,
    total_deposits NUMERIC NOT NULL DEFAULT 0,
    total_redemptions NUMERIC NOT NULL DEFAULT 0,
    total_volume NUMERIC NOT NULL DEFAULT 0,
    first_position_at TIMESTAMPTZ,
    last_activity_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Account PnL state (computed by batch resolver)
CREATE TABLE IF NOT EXISTS account_pnl_state (
    account_id TEXT PRIMARY KEY,
    total_deposits NUMERIC NOT NULL DEFAULT 0,
    total_redemptions NUMERIC NOT NULL DEFAULT 0,
    realized_pnl NUMERIC NOT NULL DEFAULT 0,
    unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
    total_pnl NUMERIC NOT NULL DEFAULT 0,
    current_equity_value NUMERIC NOT NULL DEFAULT 0,
    winning_positions INTEGER NOT NULL DEFAULT 0,
    losing_positions INTEGER NOT NULL DEFAULT 0,
    last_recomputed_at TIMESTAMPTZ,
    source_watermark BIGINT NOT NULL DEFAULT 0
);

-- Account PnL snapshot time-series
CREATE TABLE IF NOT EXISTS account_pnl_snapshot (
    account_id TEXT NOT NULL,
    total_deposits NUMERIC NOT NULL,
    total_redemptions NUMERIC NOT NULL,
    realized_pnl NUMERIC NOT NULL,
    unrealized_pnl NUMERIC NOT NULL,
    total_pnl NUMERIC NOT NULL,
    current_equity_value NUMERIC NOT NULL,
    ts TIMESTAMPTZ NOT NULL
);

SELECT create_hypertable('account_pnl_snapshot', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_aps_account ON account_pnl_snapshot (account_id, ts DESC);

-- Versioned leaderboard cache
CREATE TABLE IF NOT EXISTS leaderboard_cache (
    cache_version INTEGER NOT NULL,
    period TEXT NOT NULL,
    sort_key TEXT NOT NULL,
    rank INTEGER NOT NULL,
    account_id TEXT NOT NULL,
    total_pnl NUMERIC NOT NULL DEFAULT 0,
    realized_pnl NUMERIC NOT NULL DEFAULT 0,
    unrealized_pnl NUMERIC NOT NULL DEFAULT 0,
    current_equity_value NUMERIC NOT NULL DEFAULT 0,
    total_deposits NUMERIC NOT NULL DEFAULT 0,
    total_redemptions NUMERIC NOT NULL DEFAULT 0,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (cache_version, period, sort_key, rank)
);

CREATE INDEX IF NOT EXISTS idx_lc_period_sort ON leaderboard_cache (period, sort_key, cache_version DESC);

-- Active leaderboard version pointer
CREATE TABLE IF NOT EXISTS leaderboard_cache_version (
    period TEXT NOT NULL,
    sort_key TEXT NOT NULL,
    active_version INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (period, sort_key)
);
