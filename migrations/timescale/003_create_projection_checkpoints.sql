-- Projection checkpoints: tracks the last processed sequence number per (projection, sink) pair.
-- Each worker resumes from its checkpoint on restart.
CREATE TABLE IF NOT EXISTS projection_checkpoints (
    checkpoint_key       TEXT PRIMARY KEY,             -- "AtomCreated:surrealdb"
    projection_name      TEXT NOT NULL,
    sink_name            TEXT NOT NULL,
    last_sequence_number BIGINT NOT NULL DEFAULT 0,
    last_block_number    BIGINT NOT NULL DEFAULT 0,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (projection_name, sink_name)
);
