-- Add a version counter to the position table for reliable insert-vs-update
-- detection, replacing the unreliable (xmax = 0) PostgreSQL internal trick.
--
-- version = 0 means the row was just created by this statement.
-- version > 0 means at least one deposit has been processed for this position.
--
-- The deposit upsert increments version on each DO UPDATE.
-- The redeem upsert does NOT increment version, so version specifically
-- reflects deposit history — used to determine whether holder_count was
-- previously incremented and should be decremented on close.

ALTER TABLE position
    ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 0;

-- Backfill existing rows: any row that already exists had at least one deposit.
UPDATE position SET version = 1 WHERE version = 0;
