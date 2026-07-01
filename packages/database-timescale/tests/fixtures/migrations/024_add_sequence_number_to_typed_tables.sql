-- Add sequence_number and hex ID columns to typed event tables, backfill
-- from event_store, set NOT NULL, and create indexes.
--
-- sequence_number: enables projection workers to read from typed tables
-- instead of the monolithic event_store, using the same checkpoint cursor.
--
-- term_id_hex (and subject/predicate/object_id_hex for triples): the original
-- hex debug format string (e.g. 0x000...002a) that projections expect.
-- Typed tables store these as NUMERIC, but all downstream dimension tables
-- and projection logic use the hex string representation.

-- ========================================
-- Step 1: Add nullable columns
-- ========================================

ALTER TABLE atom_created_events
    ADD COLUMN IF NOT EXISTS sequence_number BIGINT,
    ADD COLUMN IF NOT EXISTS term_id_hex TEXT;

ALTER TABLE triple_created_events
    ADD COLUMN IF NOT EXISTS sequence_number BIGINT,
    ADD COLUMN IF NOT EXISTS term_id_hex TEXT,
    ADD COLUMN IF NOT EXISTS subject_id_hex TEXT,
    ADD COLUMN IF NOT EXISTS predicate_id_hex TEXT,
    ADD COLUMN IF NOT EXISTS object_id_hex TEXT;

ALTER TABLE deposited_events
    ADD COLUMN IF NOT EXISTS sequence_number BIGINT,
    ADD COLUMN IF NOT EXISTS term_id_hex TEXT;

ALTER TABLE redeemed_events
    ADD COLUMN IF NOT EXISTS sequence_number BIGINT,
    ADD COLUMN IF NOT EXISTS term_id_hex TEXT;

ALTER TABLE share_price_changed_events
    ADD COLUMN IF NOT EXISTS sequence_number BIGINT,
    ADD COLUMN IF NOT EXISTS term_id_hex TEXT;

ALTER TABLE protocol_fee_accrued_events
    ADD COLUMN IF NOT EXISTS sequence_number BIGINT;

-- ========================================
-- Step 2: Backfill from event_store
-- ========================================

-- atom_created_events (regular table)
UPDATE atom_created_events t
SET sequence_number = es.sequence_number,
    term_id_hex     = es.event_data ->> 'term_id'
FROM event_store es
WHERE es.transaction_hash = t.transaction_hash
  AND es.log_index        = t.log_index
  AND es.event_type       = 'AtomCreated'
  AND es.is_canonical     = true
  AND t.sequence_number IS NULL;

-- triple_created_events (regular table)
UPDATE triple_created_events t
SET sequence_number  = es.sequence_number,
    term_id_hex      = es.event_data ->> 'term_id',
    subject_id_hex   = es.event_data ->> 'subject_id',
    predicate_id_hex = es.event_data ->> 'predicate_id',
    object_id_hex    = es.event_data ->> 'object_id'
FROM event_store es
WHERE es.transaction_hash = t.transaction_hash
  AND es.log_index        = t.log_index
  AND es.event_type       = 'TripleCreated'
  AND es.is_canonical     = true
  AND t.sequence_number IS NULL;

-- deposited_events (hypertable — include block_timestamp for chunk pruning)
UPDATE deposited_events t
SET sequence_number = es.sequence_number,
    term_id_hex     = es.event_data ->> 'term_id'
FROM event_store es
WHERE es.transaction_hash = t.transaction_hash
  AND es.log_index        = t.log_index
  AND es.block_timestamp  = t.block_timestamp
  AND es.event_type       = 'Deposited'
  AND es.is_canonical     = true
  AND t.sequence_number IS NULL;

-- redeemed_events (hypertable)
UPDATE redeemed_events t
SET sequence_number = es.sequence_number,
    term_id_hex     = es.event_data ->> 'term_id'
FROM event_store es
WHERE es.transaction_hash = t.transaction_hash
  AND es.log_index        = t.log_index
  AND es.block_timestamp  = t.block_timestamp
  AND es.event_type       = 'Redeemed'
  AND es.is_canonical     = true
  AND t.sequence_number IS NULL;

-- share_price_changed_events (hypertable)
UPDATE share_price_changed_events t
SET sequence_number = es.sequence_number,
    term_id_hex     = es.event_data ->> 'term_id'
FROM event_store es
WHERE es.transaction_hash = t.transaction_hash
  AND es.log_index        = t.log_index
  AND es.block_timestamp  = t.block_timestamp
  AND es.event_type       = 'SharePriceChanged'
  AND es.is_canonical     = true
  AND t.sequence_number IS NULL;

-- protocol_fee_accrued_events (regular table — no hex IDs needed)
UPDATE protocol_fee_accrued_events t
SET sequence_number = es.sequence_number
FROM event_store es
WHERE es.transaction_hash = t.transaction_hash
  AND es.log_index        = t.log_index
  AND es.event_type       = 'ProtocolFeeAccrued'
  AND es.is_canonical     = true
  AND t.sequence_number IS NULL;

-- ========================================
-- Step 3: Set NOT NULL constraints (idempotent: SET NOT NULL is safe to re-run)
-- ========================================

DO $$ BEGIN
    ALTER TABLE atom_created_events ALTER COLUMN sequence_number SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE atom_created_events ALTER COLUMN term_id_hex SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE triple_created_events ALTER COLUMN sequence_number SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE triple_created_events ALTER COLUMN term_id_hex SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE triple_created_events ALTER COLUMN subject_id_hex SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE triple_created_events ALTER COLUMN predicate_id_hex SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE triple_created_events ALTER COLUMN object_id_hex SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE deposited_events ALTER COLUMN sequence_number SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE deposited_events ALTER COLUMN term_id_hex SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE redeemed_events ALTER COLUMN sequence_number SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE redeemed_events ALTER COLUMN term_id_hex SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE share_price_changed_events ALTER COLUMN sequence_number SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;
DO $$ BEGIN
    ALTER TABLE share_price_changed_events ALTER COLUMN term_id_hex SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE protocol_fee_accrued_events ALTER COLUMN sequence_number SET NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL; END $$;

-- ========================================
-- Step 4: Create indexes for projection reads
-- ========================================
-- These enable: WHERE sequence_number > $1 ORDER BY sequence_number LIMIT $2
-- Unique constraint ensures 1:1 mapping with event_store rows.

CREATE UNIQUE INDEX IF NOT EXISTS ux_atom_created_seq
    ON atom_created_events (sequence_number);

CREATE UNIQUE INDEX IF NOT EXISTS ux_triple_created_seq
    ON triple_created_events (sequence_number);

-- Hypertables cannot have UNIQUE indexes unless they include the partition
-- column.  Use plain indexes for the three hypertables; regular tables keep
-- their UNIQUE constraint.
CREATE INDEX IF NOT EXISTS idx_deposited_seq
    ON deposited_events (sequence_number ASC);

CREATE INDEX IF NOT EXISTS idx_redeemed_seq
    ON redeemed_events (sequence_number ASC);

CREATE INDEX IF NOT EXISTS idx_spc_seq
    ON share_price_changed_events (sequence_number ASC);

CREATE INDEX IF NOT EXISTS idx_protocol_fee_seq
    ON protocol_fee_accrued_events (sequence_number ASC);
