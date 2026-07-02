-- 045_enable_pgvector_and_embedding_tables.sql
-- Enables pgvector 0.8+ and creates post_embeddings + user_interest_vectors
-- tables using halfvec(512) with HNSW indexes tuned for our corpus scale.
--
-- Design notes:
--   - halfvec(512) uses float16 storage: 2× memory reduction vs vector(512) with
--     ≥99.5% recall at our embedding scale (Matryoshka 512d).
--   - HNSW m=24 improves recall for small corpora; ef_construction=80 balances
--     build time vs quality. See ADR Spike 03 for benchmarks.
--   - post_id / user_id as TEXT to match SurrealDB record IDs and the
--     recommendation subject IDs used in recommendation_events.
--   - model_id format enforced by CHECK: provider:model:dim (e.g.
--     "openai:text-embedding-3-small:512") — enables multi-model experiments
--     without schema change.
--   - content_hash BYTEA (sha256, 32 bytes) — enables edit detection so the
--     embed worker can skip unchanged posts.
-- All statements use IF NOT EXISTS / CREATE OR REPLACE for full idempotency.

-- ============================================================
-- Extensions
-- ============================================================

-- pgvector >= 0.8 — required for halfvec type and HNSW indexes.
CREATE EXTENSION IF NOT EXISTS vector;

-- pg_trgm — fuzzy text similarity; used for hybrid search fallback (+).
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================
-- Table: post_embeddings
-- ============================================================
CREATE TABLE IF NOT EXISTS post_embeddings (
    -- SurrealDB post record ID (e.g., "post:01j9tzh8…"). TEXT, not UUID, because
    -- SurrealDB uses string record IDs — matches recommendation_events.content_id.
    post_id         TEXT            PRIMARY KEY,

    -- 512-dimensional float16 embedding. halfvec saves ~1 KB per row vs float32.
    embedding       halfvec(512)    NOT NULL,

    -- Embedding model identifier: provider:model:dim (e.g.
    -- "openai:text-embedding-3-small:512"). Regex CHECK enforces this format so
    -- downstream readers can parse it deterministically.
    model_id        TEXT            NOT NULL,

    -- SHA-256 digest of the source text (exactly 32 bytes). Used by the embed
    -- worker to skip re-embedding when post content has not changed.
    content_hash    BYTEA           NOT NULL,

    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Enforce model_id format: lowercase provider:model:dim (e.g. "openai:text-embedding-3-small:512").
    -- Regex intent:
    --   * First char of provider + model must be alphanumeric, which rules
    --     out '__shadow', '-hidden', '.', etc. — common typos, never
    --     intentional.
    --   * Provider: [a-z0-9][a-z0-9_-]* — lowercase, digits, underscore, hyphen.
    --   * Model:    [a-z0-9][a-z0-9._-]* — same plus dot (e.g. "text-embedding-3.5").
    --   * Dimension: [0-9]+ — deliberately unbounded so A/B experiments can
    --     register large models (e.g. 4096-dim) without a schema migration.
    CONSTRAINT post_embeddings_model_id_format
        CHECK (model_id ~ '^[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9._-]*:[0-9]+$'),

    -- SHA-256 is always exactly 32 bytes
    CONSTRAINT post_embeddings_content_hash_sha256
        CHECK (octet_length(content_hash) = 32)
);

COMMENT ON TABLE post_embeddings IS
    'Semantic embeddings for posts. Populated by recommendation-service embedding pipeline.';

COMMENT ON COLUMN post_embeddings.post_id IS
    'SurrealDB post record ID (string form, e.g. "post:ulid123"). Matches recommendation_events.content_id.';

COMMENT ON COLUMN post_embeddings.embedding IS
    '512-dimensional float16 embedding. halfvec(512) uses 1 KB per row (2× less than float32).';

COMMENT ON COLUMN post_embeddings.model_id IS
    'Provider:model:dim — e.g. "openai:text-embedding-3-small:512". Regex-checked to enable future multi-model experiments.';

COMMENT ON COLUMN post_embeddings.content_hash IS
    'SHA-256 of the source text (always 32 bytes). Used by embed worker to skip unchanged posts.';

-- HNSW index using cosine distance on halfvec columns.
-- m=24: each node maintains up to 24 bi-directional links per layer — better
--       recall than the default m=16 for small-to-medium corpora.
-- ef_construction=80: search width during index build; higher = better recall,
--                     slower build. 80 is a good default for < 10M rows.
-- ef_search (query-time recall expansion) is set per-connection in db.rs via
-- hnsw.ef_search = 100 — not stored in the index definition.
CREATE INDEX IF NOT EXISTS post_embeddings_hnsw_idx
    ON post_embeddings
    USING hnsw (embedding halfvec_cosine_ops)
    WITH (m = 24, ef_construction = 80);

COMMENT ON INDEX post_embeddings_hnsw_idx IS
    'HNSW index for approximate nearest-neighbour queries on halfvec(512) embeddings using cosine distance.';

-- btree index on model_id: allows filtering by model version without
-- polluting the primary ANN query. Useful when running A/B model experiments.
CREATE INDEX IF NOT EXISTS post_embeddings_model_id_idx
    ON post_embeddings (model_id);

-- ============================================================
-- Table: user_interest_vectors
-- ============================================================
CREATE TABLE IF NOT EXISTS user_interest_vectors (
    -- Trusted recommendation subject ID. Matches recommendation_events.user_id.
    user_id             TEXT            PRIMARY KEY,

    -- 512-dimensional float16 interest embedding (exponentially time-decayed
    -- weighted sum of the user's interaction embeddings over 30 days).
    embedding           halfvec(512)    NOT NULL,

    -- Count of events contributing to this vector. event_count = 0 means the
    -- vector was bootstrapped from cold-start defaults.
    event_count         INTEGER         NOT NULL CHECK (event_count >= 0),

    -- Timestamp of the most-recent event included in the computation.
    -- Used by the recompute worker to find stale vectors.
    last_event_time     TIMESTAMPTZ     NOT NULL,

    -- When this row was last written. Separate from last_event_time so we can
    -- distinguish "user had no new events" from "row was never refreshed".
    computed_at         TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Model used to produce the interaction embeddings that were averaged.
    -- Same regex as post_embeddings.model_id — see that constraint for intent.
    model_id            TEXT            NOT NULL,

    CONSTRAINT user_interest_vectors_model_id_format
        CHECK (model_id ~ '^[a-z0-9][a-z0-9_-]*:[a-z0-9][a-z0-9._-]*:[0-9]+$')
);

COMMENT ON TABLE user_interest_vectors IS
    'Per-user 512d interest embedding with exponential time decay. Computed by .';

COMMENT ON COLUMN user_interest_vectors.user_id IS
    'Trusted recommendation subject ID. Matches recommendation_events.user_id and does not require wallet linkage.';

COMMENT ON COLUMN user_interest_vectors.event_count IS
    'Number of interaction events used to compute this embedding. 0 = cold-start bootstrap.';

-- Index used by the interest-vector recompute worker to find stale entries
-- (users whose last event is newer than their computed_at timestamp).
CREATE INDEX IF NOT EXISTS user_interest_vectors_last_event_time_idx
    ON user_interest_vectors (last_event_time DESC);

-- Index used by freshness queries: "give me vectors not refreshed in N minutes".
CREATE INDEX IF NOT EXISTS user_interest_vectors_computed_at_idx
    ON user_interest_vectors (computed_at);

-- ============================================================
-- updated_at trigger for post_embeddings
-- ============================================================

-- Keep updated_at accurate when the embed worker re-embeds an edited post.
-- user_interest_vectors does not need this — the worker always overwrites the
-- whole row, so computed_at serves the same purpose.
CREATE OR REPLACE FUNCTION post_embeddings_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- DROP + CREATE is the idempotent pattern for triggers in PostgreSQL (no
-- CREATE OR REPLACE TRIGGER before PG 14, and even in 14+ we keep the
-- explicit DROP for compatibility with older cluster versions).
DROP TRIGGER IF EXISTS post_embeddings_set_updated_at_trg ON post_embeddings;
CREATE TRIGGER post_embeddings_set_updated_at_trg
    BEFORE UPDATE ON post_embeddings
    FOR EACH ROW
    EXECUTE FUNCTION post_embeddings_set_updated_at();
