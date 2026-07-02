-- Admin access audit log for behavior analytics endpoints
-- Compliance requirement: logs every query to behaviorAnalyticsRouter

CREATE TABLE IF NOT EXISTS admin_analytics_access_log (
  id BIGSERIAL PRIMARY KEY,
  admin_user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  query_params JSONB,
  accessed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_address INET
);

-- Restrict to append-only: revoke mutating operations on the audit log.
REVOKE DELETE, UPDATE, TRUNCATE ON admin_analytics_access_log FROM PUBLIC;

CREATE INDEX IF NOT EXISTS idx_admin_analytics_access_log_user
  ON admin_analytics_access_log (admin_user_id, accessed_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_analytics_access_log_endpoint
  ON admin_analytics_access_log (endpoint, accessed_at DESC);
