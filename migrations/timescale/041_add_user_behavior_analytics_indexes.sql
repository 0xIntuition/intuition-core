-- Performance indexes for user behavior analytics batch projections.
-- These support the heavy GROUP BY and correlated subquery patterns in
-- user_activity_repo.rs and funnel_repo.rs.
--
-- All statements use IF NOT EXISTS for idempotency.
-- Regular tables use CONCURRENTLY to avoid blocking writes.
-- The position_change hypertable uses a standard CREATE INDEX because
-- TimescaleDB does not support CONCURRENTLY on hypertables.

-- Supports compute_topic_affinity GROUP BY (account_id, term_id) over
-- the position_change hypertable. Without this, every batch cycle does
-- a full sequential scan across all chunks.
-- NOTE: No CONCURRENTLY — TimescaleDB hypertables do not support it.
CREATE INDEX IF NOT EXISTS idx_position_change_account_term
    ON position_change (account_id, term_id);

-- Supports the EXISTS subquery in classify_segments that checks
-- recently joined accounts (first_seen_at > NOW() - 14 days).
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_account_first_seen
    ON account (first_seen_at DESC);

-- Supports compute_rfm_scores and classify_segments filters on
-- last_recomputed_at > NOW() - 30 days without requiring a leading
-- user_segment column match.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_user_activity_profile_recomputed
    ON user_activity_profile (last_recomputed_at DESC);
