-- Recommendation events: impression, click, dwell, engagement, dismiss, and
-- feed-request events emitted by the recommendation pipeline.
-- Used by EngagementScorer, seen-by-user filter, and LightGBM v2 training.
-- All statements use IF NOT EXISTS / if_not_exists for idempotency.

-- ============================================================
-- Table: recommendation_events  (hypertable, 7-day chunks)
-- ============================================================
CREATE TABLE IF NOT EXISTS recommendation_events (
    -- Identity
    event_id        UUID            NOT NULL DEFAULT gen_random_uuid(),
    user_id         TEXT            NOT NULL,  -- trusted recommendation subject ID from app/auth boundary

    -- Content reference
    content_id      TEXT            NOT NULL,  -- SurrealDB record ID (e.g., "post:ulid123")
    content_type    TEXT            NOT NULL,  -- 'atom', 'triple', 'post', 'stack'
    author_id       TEXT,                      -- content author's account ID

    -- Event details
    event_type      TEXT            NOT NULL,  -- 'impression', 'click', 'dwell', 'bookmark', 'comment', 'deposit', 'share', 'dismiss', 'feed_request'
    event_value     JSONB,                     -- event-specific metadata (dwell_ms, deposit_amount, etc.)

    -- Recommendation context
    surface         TEXT            NOT NULL,  -- 'feed', 'discovery', 'explore', 'ad', 'related_items'
    position        INTEGER,                   -- position in the feed (0-indexed)
    combined_score  DOUBLE PRECISION,          -- pipeline score at time of serving
    scorer_breakdown JSONB,                    -- per-scorer scores at time of serving

    -- Ad tracking (nullable, for future ad-grade requirements)
    ad_id           UUID,                      -- future: links to promoted_posts table
    creative_id     TEXT,                      -- future: creative variant identifier

    -- Session context
    session_id      TEXT,                      -- client-generated session ID

    -- Timestamp (hypertable partition key)
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Primary key includes time for hypertable partitioning
    CONSTRAINT pk_recommendation_events PRIMARY KEY (event_id, created_at),

    -- CHECK constraints: restrict allowed values to prevent silent data corruption
    CONSTRAINT chk_event_type CHECK (event_type IN ('impression', 'click', 'dwell', 'bookmark', 'comment', 'deposit', 'share', 'dismiss', 'feed_request')),
    CONSTRAINT chk_content_type CHECK (content_type IN ('atom', 'triple', 'post', 'stack')),
    CONSTRAINT chk_surface CHECK (surface IN ('feed', 'discovery', 'explore', 'ad', 'related_items'))
);

SELECT create_hypertable(
    'recommendation_events', 'created_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists => TRUE
);

-- ============================================================
-- Indexes: primary read paths
-- ============================================================

-- 1. User's recent events (for seen-by-user filter, interest vector computation)
CREATE INDEX IF NOT EXISTS idx_rec_events_user_time
    ON recommendation_events (user_id, created_at DESC);

-- 2. Content engagement lookup (for engagement scorer)
CREATE INDEX IF NOT EXISTS idx_rec_events_content_type
    ON recommendation_events (content_id, event_type, created_at DESC);

-- 3. Surface-level analytics (dashboard queries, A/B test analysis)
CREATE INDEX IF NOT EXISTS idx_rec_events_surface_time
    ON recommendation_events (surface, event_type, created_at DESC);

-- 4. Session reconstruction (debug, funnel analysis)
CREATE INDEX IF NOT EXISTS idx_rec_events_session
    ON recommendation_events (session_id, created_at ASC)
    WHERE session_id IS NOT NULL;

-- ============================================================
-- Retention: 90 days (sufficient for LightGBM v2 training window)
-- ============================================================
SELECT add_retention_policy(
    'recommendation_events',
    INTERVAL '90 days',
    if_not_exists => TRUE
);

-- ============================================================
-- Autovacuum tuning: high-churn table needs aggressive vacuuming
-- (mirrors 035_create_user_behavior_analytics pattern)
-- ============================================================
ALTER TABLE recommendation_events SET (
    fillfactor = 80,
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_cost_delay = 2
);

-- ============================================================
-- Compression: compress chunks older than 7 days, segment by surface
-- surface has 5 distinct values (low cardinality) which produces
-- efficient compressed segments. user_id is too high-cardinality
-- for an unconstrained event log table. The user-timeline hot path
-- reads recent uncompressed chunks anyway.
-- ============================================================
ALTER TABLE recommendation_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'surface',
    timescaledb.compress_orderby = 'created_at DESC'
);

SELECT add_compression_policy(
    'recommendation_events',
    INTERVAL '7 days',
    if_not_exists => TRUE
);

-- ============================================================
-- Continuous aggregate: hourly engagement counts per content item
-- Used by EngagementScorer to avoid counting raw events per request
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS mv_content_engagement_hourly
WITH (timescaledb.continuous) AS
SELECT
    time_bucket('1 hour', created_at) AS bucket,
    content_id,
    content_type,
    COUNT(*) FILTER (WHERE event_type = 'impression') AS impression_count,
    COUNT(*) FILTER (WHERE event_type = 'click') AS click_count,
    COUNT(*) FILTER (WHERE event_type = 'bookmark') AS bookmark_count,
    COUNT(*) FILTER (WHERE event_type = 'comment') AS comment_count,
    COUNT(*) FILTER (WHERE event_type = 'deposit') AS deposit_count,
    COUNT(*) FILTER (WHERE event_type = 'share') AS share_count,
    COUNT(*) FILTER (WHERE event_type = 'dismiss') AS dismiss_count,
    COUNT(*) FILTER (WHERE event_type = 'dwell') AS dwell_count,
    AVG(
        CASE
            WHEN event_type = 'dwell'
                 AND event_value->>'dwell_ms' IS NOT NULL
                 AND event_value->>'dwell_ms' ~ '^\d+(\.\d+)?$'
            THEN (event_value->>'dwell_ms')::NUMERIC
            ELSE NULL
        END
    ) FILTER (WHERE event_type = 'dwell') AS avg_dwell_ms
FROM recommendation_events
GROUP BY bucket, content_id, content_type
WITH NO DATA;

-- Refresh every 15 minutes, looking back 3 hours for late-arriving events.
-- TimescaleDB requires start_offset - end_offset >= 2 * bucket_width (2h).
-- 3h - 15m = 2h45m covers 2.75 buckets, satisfying the constraint.
SELECT add_continuous_aggregate_policy('mv_content_engagement_hourly',
    start_offset => INTERVAL '3 hours',
    end_offset => INTERVAL '15 minutes',
    schedule_interval => INTERVAL '15 minutes',
    if_not_exists => TRUE
);

-- Retention: keep hourly aggregates for 180 days (2x base table retention).
-- Base data drops at 90 days; hourly rollups retained longer for trend analysis.
SELECT add_retention_policy(
    'mv_content_engagement_hourly',
    INTERVAL '180 days',
    if_not_exists => TRUE
);
