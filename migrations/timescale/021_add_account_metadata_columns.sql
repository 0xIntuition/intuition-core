-- Add metadata columns to account table for leaderboard display and protocol filtering.
--
-- account_type: 'Default', 'ProtocolVault', 'AtomWallet'
--   Used to exclude protocol accounts from PnL leaderboards.
-- account_label: display name (ENS name, linked identity, etc.)
-- account_image: avatar URL

ALTER TABLE account ADD COLUMN IF NOT EXISTS account_type TEXT NOT NULL DEFAULT 'Default';
ALTER TABLE account ADD COLUMN IF NOT EXISTS account_label TEXT;
ALTER TABLE account ADD COLUMN IF NOT EXISTS account_image TEXT;

CREATE INDEX IF NOT EXISTS idx_account_type ON account (account_type);
