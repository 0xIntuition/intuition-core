-- Add event_id column for idempotent inserts on replay.
-- TimescaleDB requires the partitioning column (ts) in any unique index.
ALTER TABLE term_market_cap_history ADD COLUMN IF NOT EXISTS event_id TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS idx_tmch_event_id ON term_market_cap_history (event_id, ts);
