-- Per-table autovacuum and storage tuning for high-churn tables.
-- These settings override the global autovacuum_vacuum_scale_factor (0.05)
-- with table-specific thresholds based on each table's mutation pattern.
-- All ALTER TABLE SET statements are idempotent.

-- vault: heavy UPSERTs from vault_state projection, fillfactor enables HOT updates
ALTER TABLE vault SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_threshold = 100,
    fillfactor = 80
);

-- position: heavy UPSERTs from position_tracking projection
ALTER TABLE position SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_threshold = 100,
    fillfactor = 80
);

-- active_vault_position: UPSERTs + DELETEs from vault_holders_index
ALTER TABLE active_vault_position SET (
    autovacuum_vacuum_scale_factor = 0.01,
    autovacuum_analyze_scale_factor = 0.005,
    autovacuum_vacuum_threshold = 100,
    fillfactor = 80
);

-- dirty_vault: full DELETE+INSERT cycle, threshold-based only (scale_factor=0 disables percentage trigger)
ALTER TABLE dirty_vault SET (
    autovacuum_vacuum_scale_factor = 0.0,
    autovacuum_analyze_scale_factor = 0.0,
    autovacuum_vacuum_threshold = 20,
    autovacuum_analyze_threshold = 10
);

-- dirty_account: same DELETE+INSERT cycle as dirty_vault
ALTER TABLE dirty_account SET (
    autovacuum_vacuum_scale_factor = 0.0,
    autovacuum_analyze_scale_factor = 0.0,
    autovacuum_vacuum_threshold = 20,
    autovacuum_analyze_threshold = 10
);

-- stats: singleton row updated on every event batch, aggressive vacuum
ALTER TABLE stats SET (
    autovacuum_vacuum_scale_factor = 0.0,
    autovacuum_vacuum_threshold = 1,
    fillfactor = 50
);

-- projection_checkpoints: ~17 rows updated every 1-5 seconds per worker
ALTER TABLE projection_checkpoints SET (
    autovacuum_vacuum_scale_factor = 0.0,
    autovacuum_vacuum_threshold = 5,
    fillfactor = 70
);

-- account_pnl_state: UPSERTs from leaderboard_refresh
ALTER TABLE account_pnl_state SET (
    autovacuum_vacuum_scale_factor = 0.02,
    autovacuum_analyze_scale_factor = 0.01,
    autovacuum_vacuum_threshold = 50,
    fillfactor = 80
);
