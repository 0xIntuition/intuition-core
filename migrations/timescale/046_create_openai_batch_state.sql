-- 046_create_openai_batch_state.sql
-- Tracks in-flight OpenAI batch API submissions for the embeddings job.
--
-- Problem this solves ( / PR #415 M3):
--   The embeddings runner uploads a JSONL file to OpenAI, then creates a batch
--   that references that file's ID.  If the process crashes after the upload
--   succeeds but before the batch is created (or recorded locally), a restart
--   re-uploads, gets a new input_file_id, invalidates any idempotency key, and
--   creates a duplicate batch.  Orphan files accumulate toward OpenAI's 10k-file
--   quota.
--
-- Fix:
--   After a successful file upload we write a row with status='uploaded'.
--   After a successful batch creation we update to status='submitted'.
--   On retry the runner checks for an existing row with a matching content_hash;
--   if one exists it reuses the stored input_file_id and skips the re-upload.
--
-- content_hash is the SHA-256 of the JSONL bytes (not the individual embeddings)
-- so it changes whenever the set of posts or their text changes.
--
-- State machine:
--   uploaded   → batch creation in progress; input_file_id is safe to reuse
--   submitted  → batch created; batch_id is known; polling for completion
--   completed  → batch finished successfully; rows written to post_embeddings
--   failed     → batch reached a terminal failure; row kept for GC reference

CREATE TABLE IF NOT EXISTS openai_batch_state (
    -- SHA-256 of the submitted JSONL bytes (32 bytes).
    -- Used as a lookup key on retry to detect whether we already uploaded
    -- this exact batch payload.
    content_hash        BYTEA           PRIMARY KEY,

    -- The file ID returned by OpenAI's /v1/files upload endpoint.
    -- Set as soon as the upload completes so retries can reuse it.
    input_file_id       TEXT            NOT NULL,

    -- The batch ID returned by /v1/batches.  NULL until batch creation succeeds.
    batch_id            TEXT,

    -- Lifecycle state: uploaded | submitted | completed | failed
    status              TEXT            NOT NULL
                            CHECK (status IN ('uploaded', 'submitted', 'completed', 'failed')),

    -- Number of items in this batch.
    item_count          INTEGER         NOT NULL CHECK (item_count > 0),

    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT openai_batch_state_content_hash_sha256
        CHECK (octet_length(content_hash) = 32)
);

COMMENT ON TABLE openai_batch_state IS
    'Tracks in-flight OpenAI file/batch API calls for the embeddings job to prevent orphan files on retry.';

COMMENT ON COLUMN openai_batch_state.content_hash IS
    'SHA-256 of the uploaded JSONL bytes. Used on restart to find and reuse an existing upload.';

COMMENT ON COLUMN openai_batch_state.input_file_id IS
    'OpenAI file ID (file_...) returned by POST /v1/files. Safe to reuse until the batch completes.';

COMMENT ON COLUMN openai_batch_state.batch_id IS
    'OpenAI batch ID (batch_...) returned by POST /v1/batches. NULL until batch creation succeeds.';

-- Index for looking up rows by status (e.g. to find orphaned uploads for GC).
CREATE INDEX IF NOT EXISTS openai_batch_state_status_idx
    ON openai_batch_state (status);

-- Keep updated_at accurate.
CREATE OR REPLACE FUNCTION openai_batch_state_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS openai_batch_state_set_updated_at_trg ON openai_batch_state;
CREATE TRIGGER openai_batch_state_set_updated_at_trg
    BEFORE UPDATE ON openai_batch_state
    FOR EACH ROW
    EXECUTE FUNCTION openai_batch_state_set_updated_at();
