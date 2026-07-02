-- Funnel Analytics
--
-- Tracks multi-step user funnel progression. Two tables:
--   funnel_definition — static config (one row per funnel)
--   funnel_event      — per-user step completions (hypertable for time-based partitioning)
--
-- A materialised view (v_funnel_conversion) aggregates step-level user counts
-- for the conversion dashboard.

-- ---------------------------------------------------------------------------
-- Funnel definitions (low-volume config table)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS funnel_definition (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    name       TEXT        NOT NULL UNIQUE,
    -- JSON array of step descriptors: [{event_type, label, filters?}]
    steps      JSONB       NOT NULL,
    -- Maximum elapsed time between step 0 and the final step.
    max_window INTERVAL    NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------------------
-- Per-user funnel step completions (hypertable)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS funnel_event (
    account_id   TEXT        NOT NULL,
    funnel_id    UUID        NOT NULL,
    step_index   SMALLINT    NOT NULL,
    -- Timestamp of the underlying blockchain event that satisfied this step.
    completed_at TIMESTAMPTZ NOT NULL,
    -- sequence_number from the source typed-event table (nullable for steps
    -- computed without a single backing event, e.g. count-threshold steps).
    event_id     BIGINT
);

-- Partition funnel_event by completed_at in 7-day chunks. Hypertables give us
-- automatic partition pruning and efficient range scans over time windows.
SELECT create_hypertable(
    'funnel_event',
    'completed_at',
    chunk_time_interval => INTERVAL '7 days',
    if_not_exists       => TRUE
);

-- Unique index includes the partition column (completed_at), required by TimescaleDB.
CREATE UNIQUE INDEX IF NOT EXISTS idx_uq_funnel_event
    ON funnel_event (account_id, funnel_id, step_index, completed_at);

-- Supports the conversion view's GROUP BY (funnel_id, step_index).
CREATE INDEX IF NOT EXISTS idx_funnel_event_funnel
    ON funnel_event (funnel_id, step_index);

-- Supports per-account funnel status lookups.
CREATE INDEX IF NOT EXISTS idx_funnel_event_account
    ON funnel_event (account_id, funnel_id);

-- ---------------------------------------------------------------------------
-- Conversion view — users at each step across all funnels
-- ---------------------------------------------------------------------------

CREATE OR REPLACE VIEW v_funnel_conversion AS
SELECT
    fd.name        AS funnel_name,
    fd.id          AS funnel_id,
    fe.step_index,
    COUNT(DISTINCT fe.account_id) AS users_at_step
FROM funnel_event  fe
JOIN funnel_definition fd ON fd.id = fe.funnel_id
GROUP BY fd.name, fd.id, fe.step_index;

-- ---------------------------------------------------------------------------
-- Seed the 4 core funnel definitions
-- ---------------------------------------------------------------------------

INSERT INTO funnel_definition (name, steps, max_window) VALUES
(
    'onboarding',
    '[{"event_type": "atom_created", "label": "First atom created"}, {"event_type": "deposited", "label": "First deposit"}]'::JSONB,
    INTERVAL '30 days'
),
(
    'activation',
    '[{"event_type": "deposited", "label": "First deposit"}, {"event_type": "deposited", "label": "Second deposit"}]'::JSONB,
    INTERVAL '7 days'
),
(
    'creator',
    '[{"event_type": "atom_created", "label": "First atom"}, {"event_type": "triple_created", "label": "First triple"}, {"event_type": "atom_created", "label": "5th atom", "filters": {"min_count": 5}}]'::JSONB,
    INTERVAL '90 days'
),
(
    'cross_feature',
    '[{"event_type": "atom_created", "label": "Atom created"}, {"event_type": "deposited", "label": "Deposit on atom vault"}]'::JSONB,
    INTERVAL '24 hours'
)
ON CONFLICT (name) DO UPDATE SET steps = EXCLUDED.steps, max_window = EXCLUDED.max_window, updated_at = NOW();
