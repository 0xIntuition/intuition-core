-- A/B Experiment Assignment Table
-- Tracks which experiment variant each account is assigned to.
-- Schema-only: no projections, no endpoints. Ready for when experiments ship.

CREATE TABLE IF NOT EXISTS experiment_assignment (
  id BIGSERIAL PRIMARY KEY,
  account_id TEXT NOT NULL,
  experiment_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source TEXT,
  metadata JSONB,
  CONSTRAINT uq_experiment_assignment UNIQUE (account_id, experiment_id)
);

CREATE INDEX IF NOT EXISTS idx_experiment_assignment_experiment
  ON experiment_assignment (experiment_id, variant);

CREATE INDEX IF NOT EXISTS idx_experiment_assignment_account
  ON experiment_assignment (account_id);
