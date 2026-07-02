-- Add unique indexes on (event_id, ts) for hypertables that use ON CONFLICT (event_id, ts).
-- TimescaleDB requires the partitioning column in any unique index.
CREATE UNIQUE INDEX IF NOT EXISTS idx_sph_event_id ON share_price_history (event_id, ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_pc_event_id ON position_change (event_id, ts);
