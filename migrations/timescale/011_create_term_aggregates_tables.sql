CREATE TABLE IF NOT EXISTS term_summary (
    term_id TEXT PRIMARY KEY,
    term_type TEXT NOT NULL,
    total_assets NUMERIC NOT NULL DEFAULT 0,
    total_market_cap NUMERIC NOT NULL DEFAULT 0,
    total_holder_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS term_market_cap_history (
    term_id TEXT NOT NULL,
    total_assets NUMERIC NOT NULL,
    total_market_cap NUMERIC NOT NULL,
    total_holder_count INTEGER NOT NULL DEFAULT 0,
    ts TIMESTAMPTZ NOT NULL
);

SELECT create_hypertable('term_market_cap_history', 'ts', if_not_exists => TRUE);

CREATE INDEX IF NOT EXISTS idx_tmch_term ON term_market_cap_history (term_id, ts DESC);

-- Predicate-Object summary for relationship queries
CREATE TABLE IF NOT EXISTS predicate_object_summary (
    predicate_id TEXT NOT NULL,
    object_id TEXT NOT NULL,
    triple_count INTEGER NOT NULL DEFAULT 0,
    total_assets NUMERIC NOT NULL DEFAULT 0,
    total_market_cap NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (predicate_id, object_id)
);

-- Subject-Predicate summary
CREATE TABLE IF NOT EXISTS subject_predicate_summary (
    subject_id TEXT NOT NULL,
    predicate_id TEXT NOT NULL,
    triple_count INTEGER NOT NULL DEFAULT 0,
    total_assets NUMERIC NOT NULL DEFAULT 0,
    total_market_cap NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (subject_id, predicate_id)
);
