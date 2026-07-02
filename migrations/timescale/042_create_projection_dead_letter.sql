-- Projection Dead Letter Table
--
-- Captures events that failed with an `ErrorClass::Fatal` classification in
-- any projection.  Fatal errors (`InvalidEventData`, `MissingField`,
-- `Serialization`, `Config`) indicate a persistent bug — retrying does not
-- help and silently skipping would advance the checkpoint past a broken
-- event forever.
--
-- The worker inserts the offending event into this table *before* returning
-- an `Err` so the checkpoint stays pinned on the failing sequence.  An
-- operator can then inspect the row, fix the projection code, clear the
-- entry, and let the worker replay from the unchanged checkpoint.
--
-- Design notes:
--   - `sequence_number` is NOT unique: the same sequence may be written by
--     multiple projections if they all fail on the same event.
--   - `resolved_at` is filled when the operator marks the entry handled.
--     A partial index excludes resolved rows from the hot-path lookup.
--   - `error_class` is stored as text to keep the table forward-compatible
--     with new `ErrorClass` variants without requiring schema changes.

CREATE TABLE IF NOT EXISTS projection_dead_letter (
  id BIGSERIAL PRIMARY KEY,
  projection_name TEXT NOT NULL,
  sequence_number BIGINT NOT NULL,
  event_type TEXT NOT NULL,
  error_class TEXT NOT NULL,
  error_message TEXT NOT NULL,
  event_data JSONB NOT NULL,
  block_number BIGINT NOT NULL,
  log_index INTEGER NOT NULL,
  tx_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT,
  CONSTRAINT uq_projection_dead_letter
    UNIQUE (projection_name, sequence_number)
);

-- Fast lookup of unresolved entries by projection — the operator dashboard
-- and the `classify → dead-letter` write path both hit this index first.
CREATE INDEX IF NOT EXISTS idx_projection_dead_letter_unresolved
  ON projection_dead_letter (projection_name, created_at DESC)
  WHERE resolved_at IS NULL;

-- Secondary lookup by sequence number for cross-projection forensics
-- ("which projections broke on this event?").
CREATE INDEX IF NOT EXISTS idx_projection_dead_letter_sequence
  ON projection_dead_letter (sequence_number);
