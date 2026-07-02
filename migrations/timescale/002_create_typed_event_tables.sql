-- Migration: Create Typed Event Tables (Dual-Write Targets)
-- Description: Creates per-event-type tables with native columns for fast typed access.
--              Written atomically alongside event_store in the same transaction.

BEGIN;

--------------------------------------------------------------------------------
-- 1. atom_created_events (regular table — lower volume, entity lookups)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS atom_created_events (
    block_number      BIGINT      NOT NULL,
    block_timestamp   TIMESTAMPTZ NOT NULL,
    block_hash        TEXT        NOT NULL,
    transaction_hash  TEXT        NOT NULL,
    log_index         INTEGER     NOT NULL,

    creator           TEXT        NOT NULL,
    term_id           NUMERIC     NOT NULL,
    atom_data         TEXT        NOT NULL,
    atom_wallet       TEXT        NOT NULL,

    PRIMARY KEY (transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_atom_created_creator
    ON atom_created_events (creator, block_timestamp);
CREATE INDEX IF NOT EXISTS idx_atom_created_term
    ON atom_created_events (term_id);

--------------------------------------------------------------------------------
-- 2. triple_created_events (regular table — lower volume, entity lookups)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS triple_created_events (
    block_number      BIGINT      NOT NULL,
    block_timestamp   TIMESTAMPTZ NOT NULL,
    block_hash        TEXT        NOT NULL,
    transaction_hash  TEXT        NOT NULL,
    log_index         INTEGER     NOT NULL,

    creator           TEXT        NOT NULL,
    term_id           NUMERIC     NOT NULL,
    subject_id        NUMERIC     NOT NULL,
    predicate_id      NUMERIC     NOT NULL,
    object_id         NUMERIC     NOT NULL,

    PRIMARY KEY (transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_triple_created_creator
    ON triple_created_events (creator, block_timestamp);
CREATE INDEX IF NOT EXISTS idx_triple_created_term
    ON triple_created_events (term_id);
CREATE INDEX IF NOT EXISTS idx_triple_created_subject
    ON triple_created_events (subject_id);

--------------------------------------------------------------------------------
-- 3. deposited_events (hypertable — high volume, time-range queries)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS deposited_events (
    block_number      BIGINT      NOT NULL,
    block_timestamp   TIMESTAMPTZ NOT NULL,
    block_hash        TEXT        NOT NULL,
    transaction_hash  TEXT        NOT NULL,
    log_index         INTEGER     NOT NULL,

    sender            TEXT        NOT NULL,
    receiver          TEXT        NOT NULL,
    term_id           NUMERIC     NOT NULL,
    curve_id          NUMERIC     NOT NULL,
    assets            NUMERIC     NOT NULL,
    assets_after_fees NUMERIC     NOT NULL,
    shares            NUMERIC     NOT NULL,
    total_shares      NUMERIC     NOT NULL,
    vault_type        INTEGER     NOT NULL,

    PRIMARY KEY (block_timestamp, transaction_hash, log_index)
);

-- Hypertable conversion
SELECT create_hypertable(
    'deposited_events',
    'block_timestamp',
    chunk_time_interval => INTERVAL '1 week',
    if_not_exists => TRUE
);

-- Unique index for ON CONFLICT (hypertable PK includes block_timestamp)
CREATE UNIQUE INDEX IF NOT EXISTS ux_deposited_tx_log
    ON deposited_events (transaction_hash, log_index, block_timestamp);

CREATE INDEX IF NOT EXISTS idx_deposited_sender
    ON deposited_events (sender, block_timestamp);
CREATE INDEX IF NOT EXISTS idx_deposited_receiver
    ON deposited_events (receiver, block_timestamp);
CREATE INDEX IF NOT EXISTS idx_deposited_term
    ON deposited_events (term_id, block_timestamp);

--------------------------------------------------------------------------------
-- 4. redeemed_events (hypertable — high volume, time-range queries)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS redeemed_events (
    block_number      BIGINT      NOT NULL,
    block_timestamp   TIMESTAMPTZ NOT NULL,
    block_hash        TEXT        NOT NULL,
    transaction_hash  TEXT        NOT NULL,
    log_index         INTEGER     NOT NULL,

    sender            TEXT        NOT NULL,
    receiver          TEXT        NOT NULL,
    term_id           NUMERIC     NOT NULL,
    curve_id          NUMERIC     NOT NULL,
    shares            NUMERIC     NOT NULL,
    total_shares      NUMERIC     NOT NULL,
    assets            NUMERIC     NOT NULL,
    fees              NUMERIC     NOT NULL,
    vault_type        INTEGER     NOT NULL,

    PRIMARY KEY (block_timestamp, transaction_hash, log_index)
);

SELECT create_hypertable(
    'redeemed_events',
    'block_timestamp',
    chunk_time_interval => INTERVAL '1 week',
    if_not_exists => TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_redeemed_tx_log
    ON redeemed_events (transaction_hash, log_index, block_timestamp);

CREATE INDEX IF NOT EXISTS idx_redeemed_sender
    ON redeemed_events (sender, block_timestamp);
CREATE INDEX IF NOT EXISTS idx_redeemed_receiver
    ON redeemed_events (receiver, block_timestamp);
CREATE INDEX IF NOT EXISTS idx_redeemed_term
    ON redeemed_events (term_id, block_timestamp);

--------------------------------------------------------------------------------
-- 5. share_price_changed_events (hypertable — highest volume, time-series)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS share_price_changed_events (
    block_number      BIGINT      NOT NULL,
    block_timestamp   TIMESTAMPTZ NOT NULL,
    block_hash        TEXT        NOT NULL,
    transaction_hash  TEXT        NOT NULL,
    log_index         INTEGER     NOT NULL,

    term_id           NUMERIC     NOT NULL,
    curve_id          NUMERIC     NOT NULL,
    share_price       NUMERIC     NOT NULL,
    total_assets      NUMERIC     NOT NULL,
    total_shares      NUMERIC     NOT NULL,
    vault_type        INTEGER     NOT NULL,

    PRIMARY KEY (block_timestamp, transaction_hash, log_index)
);

SELECT create_hypertable(
    'share_price_changed_events',
    'block_timestamp',
    chunk_time_interval => INTERVAL '1 week',
    if_not_exists => TRUE
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_share_price_changed_tx_log
    ON share_price_changed_events (transaction_hash, log_index, block_timestamp);

CREATE INDEX IF NOT EXISTS idx_spc_term_curve
    ON share_price_changed_events (term_id, curve_id, block_timestamp);

-- Compression policy for share_price_changed_events (highest volume)
DO $$ BEGIN
    ALTER TABLE share_price_changed_events SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'term_id, curve_id',
        timescaledb.compress_orderby = 'block_timestamp DESC'
    );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

DO $$ BEGIN
    PERFORM add_compression_policy('share_price_changed_events', INTERVAL '1 month');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

--------------------------------------------------------------------------------
-- 6. protocol_fee_accrued_events (regular table — lowest volume)
--------------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS protocol_fee_accrued_events (
    block_number      BIGINT      NOT NULL,
    block_timestamp   TIMESTAMPTZ NOT NULL,
    block_hash        TEXT        NOT NULL,
    transaction_hash  TEXT        NOT NULL,
    log_index         INTEGER     NOT NULL,

    epoch             NUMERIC     NOT NULL,
    sender            TEXT        NOT NULL,
    amount            NUMERIC     NOT NULL,

    PRIMARY KEY (transaction_hash, log_index)
);

CREATE INDEX IF NOT EXISTS idx_protocol_fee_sender
    ON protocol_fee_accrued_events (sender, block_timestamp);
CREATE INDEX IF NOT EXISTS idx_protocol_fee_epoch
    ON protocol_fee_accrued_events (epoch);

COMMIT;
