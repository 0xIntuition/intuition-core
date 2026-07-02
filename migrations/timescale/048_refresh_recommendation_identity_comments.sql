-- Migration 048: Refresh COMMENT ON COLUMN drift from PR #422
--
-- PR #422 updated COMMENT ON COLUMN / COMMENT ON TABLE strings inside
-- migrations 043 and 045 to reflect the walletless cold-start identity
-- contract. Editing committed migration files does not re-apply
-- to databases where those migrations have already run — the live
-- pg_description text stays stale.
--
-- This migration re-issues the affected COMMENT statements so the live
-- schema's \d+ output matches the source of truth.
--
-- Idempotent: Postgres overwrites the existing comment on COMMENT ON ...;
-- safe on fresh installs and on already-applied databases.
-- No schema change, no data change — purely metadata sync.
--
-- Deferred from #422 because the 046 slot was contested at the time
-- (PR #415 / PR #417 / PR #423). Slot 046 is now resolved (openai_batch_state)
-- and 047 is resolved (assigned_at index); 048 is the next free slot.
--
-- Related: #422, #415, #417, #423.

-- ============================================================
-- Drift from migration 043 (recommendation_events):
-- The change in 043 was a SQL inline comment on the user_id column
-- definition, not a COMMENT ON statement. Inline SQL comments are
-- source-only and produce no pg_description entry. No DDL needed.
-- ============================================================

-- ============================================================
-- Drift from migration 045 (user_interest_vectors):
-- COMMENT ON COLUMN user_interest_vectors.user_id changed from
-- "Salted hash of wallet address..." to reflect walletless identity.
-- ============================================================

COMMENT ON COLUMN user_interest_vectors.user_id IS
    'Trusted recommendation subject ID. Matches recommendation_events.user_id and does not require wallet linkage.';
