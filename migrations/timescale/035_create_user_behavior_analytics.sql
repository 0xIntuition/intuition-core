-- User behavior analytics: activity profiles, daily rollups, topic affinity,
-- retention cohorts, and dirty-set tracking.
-- All statements use IF NOT EXISTS / if_not_exists for idempotency.

-- ============================================================
-- Enum
-- ============================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'user_segment_type') THEN
    CREATE TYPE user_segment_type AS ENUM ('whale', 'power_user', 'active', 'casual', 'dormant', 'new');
  END IF;
END$$;

-- ============================================================
-- Table 1: user_activity_profile  (materialized per-account summary)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_activity_profile (
  account_id TEXT PRIMARY KEY,
  atoms_created BIGINT NOT NULL DEFAULT 0,
  triples_created BIGINT NOT NULL DEFAULT 0,
  atoms_created_7d BIGINT NOT NULL DEFAULT 0,
  atoms_created_30d BIGINT NOT NULL DEFAULT 0,
  atoms_created_90d BIGINT NOT NULL DEFAULT 0,
  triples_created_7d BIGINT NOT NULL DEFAULT 0,
  triples_created_30d BIGINT NOT NULL DEFAULT 0,
  triples_created_90d BIGINT NOT NULL DEFAULT 0,
  deposits_7d BIGINT NOT NULL DEFAULT 0,
  deposits_30d BIGINT NOT NULL DEFAULT 0,
  deposits_90d BIGINT NOT NULL DEFAULT 0,
  redemptions_7d BIGINT NOT NULL DEFAULT 0,
  redemptions_30d BIGINT NOT NULL DEFAULT 0,
  redemptions_90d BIGINT NOT NULL DEFAULT 0,
  deposit_volume_7d NUMERIC NOT NULL DEFAULT 0,
  deposit_volume_30d NUMERIC NOT NULL DEFAULT 0,
  deposit_volume_90d NUMERIC NOT NULL DEFAULT 0,
  redemption_volume_7d NUMERIC NOT NULL DEFAULT 0,
  redemption_volume_30d NUMERIC NOT NULL DEFAULT 0,
  redemption_volume_90d NUMERIC NOT NULL DEFAULT 0,
  unique_vaults_touched BIGINT NOT NULL DEFAULT 0,
  rfm_recency_score SMALLINT,
  rfm_frequency_score SMALLINT,
  rfm_monetary_score SMALLINT,
  user_segment user_segment_type NOT NULL DEFAULT 'new',
  previous_segment user_segment_type,
  creator_trader_ratio REAL,
  last_recomputed_at TIMESTAMPTZ
);

ALTER TABLE user_activity_profile SET (
  fillfactor = 80,
  autovacuum_vacuum_scale_factor = 0.01,
  autovacuum_analyze_scale_factor = 0.005,
  autovacuum_vacuum_cost_delay = 2
);

CREATE INDEX IF NOT EXISTS idx_user_activity_profile_segment
  ON user_activity_profile (user_segment, last_recomputed_at);

-- ============================================================
-- Table 2: user_activity_daily  (hypertable, 7-day chunks)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_activity_daily (
  account_id TEXT NOT NULL,
  day TIMESTAMPTZ NOT NULL,
  atoms_created BIGINT NOT NULL DEFAULT 0,
  triples_created BIGINT NOT NULL DEFAULT 0,
  deposits_count BIGINT NOT NULL DEFAULT 0,
  redemptions_count BIGINT NOT NULL DEFAULT 0,
  deposit_volume NUMERIC NOT NULL DEFAULT 0,
  redemption_volume NUMERIC NOT NULL DEFAULT 0,
  unique_vaults INTEGER NOT NULL DEFAULT 0,
  net_flow NUMERIC NOT NULL DEFAULT 0,
  CONSTRAINT uq_user_activity_daily UNIQUE (account_id, day)
);

SELECT create_hypertable('user_activity_daily', 'day', chunk_time_interval => INTERVAL '7 days', if_not_exists => TRUE);

-- TimescaleDB does NOT auto-create per-chunk indexes on non-time columns
CREATE INDEX IF NOT EXISTS idx_user_activity_daily_account
  ON user_activity_daily (account_id, day DESC);

-- Compression after 90 days
ALTER TABLE user_activity_daily SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'account_id',
  timescaledb.compress_orderby = 'day DESC'
);
SELECT add_compression_policy('user_activity_daily', INTERVAL '90 days', if_not_exists => TRUE);

-- 2-year retention
SELECT add_retention_policy('user_activity_daily', INTERVAL '2 years', if_not_exists => TRUE);

-- ============================================================
-- Table 3: user_topic_affinity
-- ============================================================
CREATE TABLE IF NOT EXISTS user_topic_affinity (
  account_id TEXT NOT NULL,
  term_id TEXT NOT NULL,
  interaction_count BIGINT NOT NULL DEFAULT 0,
  total_capital_deployed NUMERIC NOT NULL DEFAULT 0,
  affinity_score REAL NOT NULL DEFAULT 0,
  last_interaction_at TIMESTAMPTZ,
  PRIMARY KEY (account_id, term_id)
);

ALTER TABLE user_topic_affinity SET (
  fillfactor = 80,
  autovacuum_vacuum_scale_factor = 0.02,
  autovacuum_vacuum_cost_delay = 2
);

CREATE INDEX IF NOT EXISTS idx_user_topic_affinity_account
  ON user_topic_affinity (account_id, affinity_score DESC);

CREATE INDEX IF NOT EXISTS idx_user_topic_affinity_term
  ON user_topic_affinity (term_id, last_interaction_at DESC);

-- ============================================================
-- Table 4: user_retention_cohort
-- ============================================================
CREATE TABLE IF NOT EXISTS user_retention_cohort (
  account_id TEXT NOT NULL,
  cohort_week TIMESTAMPTZ NOT NULL,  -- ISO week (Monday), derived from account.first_seen_at
  period_offset INTEGER NOT NULL,     -- weeks since cohort
  was_active BOOLEAN NOT NULL DEFAULT FALSE,
  action_count INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT uq_user_retention_cohort UNIQUE (account_id, cohort_week, period_offset)
);

CREATE INDEX IF NOT EXISTS idx_user_retention_cohort_cohort
  ON user_retention_cohort (cohort_week, period_offset);

-- ============================================================
-- Table 5: dirty_account_activity  (dirty-set for batch recompute)
-- ============================================================
CREATE TABLE IF NOT EXISTS dirty_account_activity (
  account_id TEXT PRIMARY KEY,
  reason TEXT,
  first_marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_marked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE dirty_account_activity SET (
  autovacuum_vacuum_scale_factor = 0.0,
  autovacuum_vacuum_threshold = 20
);

-- ============================================================
-- Views: weekly and monthly rollups over user_activity_daily
-- ============================================================
CREATE OR REPLACE VIEW v_user_activity_weekly AS
SELECT
  account_id,
  date_trunc('week', day) AS week,
  SUM(atoms_created) AS atoms_created,
  SUM(triples_created) AS triples_created,
  SUM(deposits_count) AS deposits_count,
  SUM(redemptions_count) AS redemptions_count,
  SUM(deposit_volume) AS deposit_volume,
  SUM(redemption_volume) AS redemption_volume,
  SUM(net_flow) AS net_flow
FROM user_activity_daily
GROUP BY 1, 2;

CREATE OR REPLACE VIEW v_user_activity_monthly AS
SELECT
  account_id,
  date_trunc('month', day) AS month,
  SUM(atoms_created) AS atoms_created,
  SUM(triples_created) AS triples_created,
  SUM(deposits_count) AS deposits_count,
  SUM(redemptions_count) AS redemptions_count,
  SUM(deposit_volume) AS deposit_volume,
  SUM(redemption_volume) AS redemption_volume,
  SUM(net_flow) AS net_flow
FROM user_activity_daily
GROUP BY 1, 2;

-- ============================================================
-- Materialized view: trending topics (with unique index for REFRESH CONCURRENTLY)
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS v_trending_topics AS
SELECT
  uta.term_id,
  SUM(CASE WHEN uta.last_interaction_at > NOW() - INTERVAL '7 days' THEN uta.interaction_count ELSE 0 END) AS recent_interactions,
  SUM(CASE WHEN uta.last_interaction_at > NOW() - INTERVAL '14 days' AND uta.last_interaction_at <= NOW() - INTERVAL '7 days' THEN uta.interaction_count ELSE 0 END) AS prior_interactions,
  SUM(CASE WHEN uta.last_interaction_at > NOW() - INTERVAL '7 days' THEN uta.interaction_count ELSE 0 END) -
  SUM(CASE WHEN uta.last_interaction_at > NOW() - INTERVAL '14 days' AND uta.last_interaction_at <= NOW() - INTERVAL '7 days' THEN uta.interaction_count ELSE 0 END) AS trend_delta,
  COUNT(DISTINCT CASE WHEN uta.last_interaction_at > NOW() - INTERVAL '7 days' THEN uta.account_id END) AS recent_users
FROM user_topic_affinity uta
GROUP BY uta.term_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_v_trending_topics_term ON v_trending_topics (term_id);
