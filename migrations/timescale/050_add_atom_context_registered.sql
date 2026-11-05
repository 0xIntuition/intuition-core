-- Migration: Ingest AtomContextRegistered as a canonical typed event
-- Description: Extends the append-only event-store contract and creates the
--              regular dual-write target for ordered opaque atom URI bytes.

BEGIN;

-- The original event_type CHECK is a closed-world whitelist. TimescaleDB does
-- not support ADD CONSTRAINT on hypertables while columnstore is enabled, and
-- disabling columnstore requires decompressing every historical compressed
-- chunk. DROP CONSTRAINT is supported on compressed hypertables. Remove the
-- brittle whitelist once; generated event decoding plus the typed dual-write
-- tables remain the canonical event contract for this and future additions.
ALTER TABLE event_store
    DROP CONSTRAINT IF EXISTS event_store_event_type_check;

-- Regular table: context registration is creation-adjacent, low-volume data.
-- uris is an ordered JSON array of 0x-prefixed byte strings exactly as emitted
-- by the contract; ingestion performs no decoding or normalization.
CREATE TABLE IF NOT EXISTS atom_context_registered_events (
    block_number      BIGINT      NOT NULL,
    block_timestamp   TIMESTAMPTZ NOT NULL,
    block_hash        TEXT        NOT NULL,
    transaction_hash  TEXT        NOT NULL,
    log_index         INTEGER     NOT NULL,

    registrant        TEXT        NOT NULL,
    term_id           NUMERIC     NOT NULL,
    term_id_hex       TEXT        NOT NULL,
    uris              JSONB       NOT NULL CHECK (jsonb_typeof(uris) = 'array'),
    sequence_number   BIGINT      NOT NULL,

    PRIMARY KEY (transaction_hash, log_index)
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_atom_context_registered_seq
    ON atom_context_registered_events (sequence_number);

CREATE INDEX IF NOT EXISTS idx_atom_context_registered_term
    ON atom_context_registered_events (term_id, sequence_number);

CREATE INDEX IF NOT EXISTS idx_atom_context_registered_term_hex
    ON atom_context_registered_events (term_id_hex, sequence_number);

COMMIT;
