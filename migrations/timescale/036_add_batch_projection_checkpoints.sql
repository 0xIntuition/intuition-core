-- Create a dedicated checkpoint table for batch projections (timer-driven jobs).
--
-- The existing `projection_checkpoints` table is designed for event-sequence
-- projections and uses a composite key on (projection_name, sink_name).
-- Batch projections need a simpler model: keyed by projection_name alone with
-- a freeform JSONB metadata blob for storing arbitrary state such as backfill
-- progress, last weekly cohort run timestamp, etc.
--
-- Keeping this separate avoids retrofitting nullable columns onto the
-- event-sequence checkpoint table and makes the access pattern explicit.

CREATE TABLE IF NOT EXISTS batch_projection_checkpoints (
    projection_name TEXT    PRIMARY KEY,
    metadata        JSONB,
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE batch_projection_checkpoints SET (
    autovacuum_vacuum_scale_factor = 0.0,
    autovacuum_vacuum_threshold    = 5
);
