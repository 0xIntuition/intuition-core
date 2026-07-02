-- 049_create_posthog_export_checkpoint.sql
-- Persistent checkpoint for the api PostHog → recommendation_events export
-- loop. The loop reads the last exported PostHog event timestamp
-- on startup so a pod restart does not re-replay the full window or skip
-- events. Single-row table keyed by a stable text id (default 'singleton')
-- so future deployments can run multiple independent loops by passing a
-- different key.
-- All statements use IF NOT EXISTS for full idempotency.

CREATE TABLE IF NOT EXISTS posthog_export_checkpoint (
    id                 TEXT          PRIMARY KEY DEFAULT 'singleton',
    last_exported_at   TIMESTAMPTZ   NOT NULL,
    updated_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
