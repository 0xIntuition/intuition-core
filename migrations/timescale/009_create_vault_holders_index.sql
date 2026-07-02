CREATE TABLE IF NOT EXISTS active_vault_position (
    term_id TEXT NOT NULL,
    curve_id TEXT NOT NULL,
    account_id TEXT NOT NULL,
    shares NUMERIC NOT NULL DEFAULT 0,
    total_deposits NUMERIC NOT NULL DEFAULT 0,
    total_redemptions NUMERIC NOT NULL DEFAULT 0,
    opened_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (term_id, curve_id, account_id)
);

CREATE INDEX IF NOT EXISTS idx_avp_account ON active_vault_position (account_id);
CREATE INDEX IF NOT EXISTS idx_avp_term_curve ON active_vault_position (term_id, curve_id);
