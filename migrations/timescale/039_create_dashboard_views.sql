-- Dashboard views for user behavior analytics
-- Depends on: 035_create_user_behavior_analytics.sql, 038_create_admin_analytics_access_log.sql

-- ============================================================
-- View 1: DAU/WAU/MAU time series
-- Uses weekly/monthly rollup views from migration 035.
-- ============================================================
CREATE OR REPLACE VIEW v_dau_wau_mau AS
SELECT
  day,
  dau,
  -- Rolling 7-day distinct active users (approximated via SUM of daily actives
  -- within the window; exact COUNT DISTINCT requires a lateral join but this
  -- matches the dashboard precision requirement).
  SUM(dau) OVER (ORDER BY day ROWS BETWEEN 6 PRECEDING AND CURRENT ROW) AS wau,
  SUM(dau) OVER (ORDER BY day ROWS BETWEEN 29 PRECEDING AND CURRENT ROW) AS mau
FROM (
  SELECT
    day,
    COUNT(DISTINCT account_id) AS dau
  FROM user_activity_daily
  WHERE atoms_created + triples_created + deposits_count + redemptions_count > 0
  GROUP BY day
) daily_counts;

-- ============================================================
-- View 2: Segment distribution
-- ============================================================
CREATE OR REPLACE VIEW v_segment_distribution AS
SELECT
  user_segment,
  COUNT(*) AS user_count,
  ROUND(COUNT(*)::NUMERIC / NULLIF(SUM(COUNT(*)) OVER (), 0) * 100, 2) AS percentage
FROM user_activity_profile
GROUP BY user_segment;

-- ============================================================
-- View 3: Retention matrix (cohort x period -> retention rate)
-- ============================================================
CREATE OR REPLACE VIEW v_retention_matrix AS
WITH cohort_sizes AS (
  SELECT cohort_week, COUNT(DISTINCT account_id) AS cohort_size
  FROM user_retention_cohort
  WHERE period_offset = 0
  GROUP BY cohort_week
)
SELECT
  rc.cohort_week,
  rc.period_offset,
  cs.cohort_size,
  COUNT(DISTINCT CASE WHEN rc.was_active THEN rc.account_id END) AS active_count,
  ROUND(
    COUNT(DISTINCT CASE WHEN rc.was_active THEN rc.account_id END)::NUMERIC /
    NULLIF(cs.cohort_size, 0) * 100, 2
  ) AS retention_rate
FROM user_retention_cohort rc
JOIN cohort_sizes cs ON cs.cohort_week = rc.cohort_week
GROUP BY rc.cohort_week, rc.period_offset, cs.cohort_size;

-- ============================================================
-- View 4: Top creators by 30d atom creation with segment
-- ============================================================
CREATE OR REPLACE VIEW v_top_creators AS
SELECT
  account_id,
  atoms_created_30d,
  triples_created_30d,
  user_segment,
  last_recomputed_at
FROM user_activity_profile
WHERE atoms_created_30d > 0;

-- ============================================================
-- View 5: Whale tracker
-- ============================================================
CREATE OR REPLACE VIEW v_whale_tracker AS
SELECT
  account_id,
  deposit_volume_30d,
  redemption_volume_30d,
  deposit_volume_30d - redemption_volume_30d AS net_flow_30d,
  deposits_30d,
  redemptions_30d,
  rfm_recency_score,
  rfm_frequency_score,
  rfm_monetary_score,
  last_recomputed_at
FROM user_activity_profile
WHERE user_segment = 'whale';

-- ============================================================
-- View 6: RFM distribution histogram
-- ============================================================
CREATE OR REPLACE VIEW v_rfm_distribution AS
SELECT
  rfm_recency_score AS score,
  'recency' AS dimension,
  COUNT(*) AS user_count
FROM user_activity_profile
WHERE rfm_recency_score IS NOT NULL
GROUP BY rfm_recency_score
UNION ALL
SELECT
  rfm_frequency_score,
  'frequency',
  COUNT(*)
FROM user_activity_profile
WHERE rfm_frequency_score IS NOT NULL
GROUP BY rfm_frequency_score
UNION ALL
SELECT
  rfm_monetary_score,
  'monetary',
  COUNT(*)
FROM user_activity_profile
WHERE rfm_monetary_score IS NOT NULL
GROUP BY rfm_monetary_score;

-- ============================================================
-- Scheduled refresh for v_trending_topics materialized view
-- v_trending_topics was created in migration 035.
-- Uses a wrapper function matching the TimescaleDB add_job
-- signature: (job_id INTEGER, config JSONB).
-- Refresh every 15 minutes, offset by 7 minutes from other jobs.
-- ============================================================
-- NOTE: the job_id parameter MUST be INTEGER — TimescaleDB invokes custom job
-- actions as (integer, jsonb); a BIGINT overload is "not found" at run time
-- and the job errors on every tick.
CREATE OR REPLACE FUNCTION refresh_trending_topics(job_id INTEGER, config JSONB)
RETURNS VOID AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY v_trending_topics;
END;
$$ LANGUAGE plpgsql;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM timescaledb_information.jobs
    WHERE proc_name = 'refresh_trending_topics'
  ) THEN
    PERFORM add_job('refresh_trending_topics',
        schedule_interval => INTERVAL '15 minutes',
        initial_start     => NOW() + INTERVAL '7 minutes'
    );
  END IF;
END $$;
