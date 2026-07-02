-- Migration: Create Event Store (Source of Truth)
-- Description: Creates the immutable append-only event log with TimescaleDB hypertable

BEGIN;

-- Enable TimescaleDB extension
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- Main Event Store Table
CREATE TABLE IF NOT EXISTS event_store (
    -- Auto-incrementing sequence number (global ordering)
    sequence_number BIGSERIAL NOT NULL,

    -- Blockchain Identifiers
    block_number BIGINT NOT NULL,
    block_timestamp TIMESTAMPTZ NOT NULL,
    block_hash TEXT NOT NULL,
    transaction_hash TEXT NOT NULL,
    log_index INTEGER NOT NULL,

    -- Event Data
    event_type TEXT NOT NULL CHECK (event_type IN (
        'AtomCreated',
        'TripleCreated',
        'Deposited',
        'Redeemed',
        'SharePriceChanged',
        'ProtocolFeeAccrued'
    )),
    event_data JSONB NOT NULL,

    -- Extracted Keys for Indexing (Generated Columns)
    term_id TEXT GENERATED ALWAYS AS (event_data->>'term_id') STORED,
    entity_id TEXT GENERATED ALWAYS AS (
        CASE
            WHEN event_type IN ('Deposited', 'AtomCreated') THEN event_data->>'receiver'
            WHEN event_type = 'Redeemed' THEN event_data->>'sender'
            ELSE NULL
        END
    ) STORED,

    -- Reorg Handling
    is_canonical BOOLEAN DEFAULT true NOT NULL,

    -- Metadata
    ingested_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

    -- Primary Key (using block_timestamp for hypertable partitioning)
    PRIMARY KEY (block_timestamp, sequence_number),

    -- Unique Constraint (prevents duplicate events)
    -- Note: block_timestamp is required for TimescaleDB hypertables
    UNIQUE (transaction_hash, log_index, block_timestamp)
);

-- Convert to TimescaleDB Hypertable
-- Chunks are 1 week each for efficient compression and querying
SELECT create_hypertable(
    'event_store',
    'block_timestamp',
    chunk_time_interval => INTERVAL '1 week',
    if_not_exists => TRUE
);

-- Indexes for projection workers (read by sequence_number)
CREATE INDEX IF NOT EXISTS idx_event_sequence ON event_store (sequence_number) WHERE is_canonical = true;

-- Index for event type filtering
CREATE INDEX IF NOT EXISTS idx_event_type ON event_store (event_type, sequence_number) WHERE is_canonical = true;

-- Index for block number lookups (useful for reorg detection)
CREATE INDEX IF NOT EXISTS idx_event_block ON event_store (block_number DESC);

-- Index for term_id lookups (debugging specific vaults)
CREATE INDEX IF NOT EXISTS idx_event_term_id ON event_store (term_id, block_timestamp) WHERE term_id IS NOT NULL;

-- Index for entity_id lookups (debugging specific users)
CREATE INDEX IF NOT EXISTS idx_event_entity_id ON event_store (entity_id, block_timestamp) WHERE entity_id IS NOT NULL;

-- Enable TimescaleDB Compression
-- Compresses chunks older than 1 month to save storage
DO $$ BEGIN
    ALTER TABLE event_store SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'event_type',
        timescaledb.compress_orderby = 'block_timestamp, sequence_number'
    );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add compression policy (compress chunks older than 1 month)
DO $$ BEGIN
    PERFORM add_compression_policy('event_store', INTERVAL '1 month');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- Add retention policy (optional: drop chunks older than 2 years)
-- Uncomment if you want automatic data deletion:
-- SELECT add_retention_policy('event_store', INTERVAL '2 years');

COMMIT;
