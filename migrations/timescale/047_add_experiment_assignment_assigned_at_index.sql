-- Add index on assigned_at for experiment_assignment.
-- GrowthBook analysis queries filter on assigned_at via the assignment query
-- date-range template ({{startDate}} / {{endDate}}). Without this index every
-- GrowthBook analysis run performs a full sequential scan of the table.
-- CONCURRENTLY avoids an ACCESS EXCLUSIVE lock so the write path is not blocked
-- during deployment. Run outside a transaction block (sqlx migrate run handles
-- this automatically for CONCURRENTLY statements when not wrapped in BEGIN).

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_experiment_assignment_assigned_at
  ON experiment_assignment (assigned_at);
