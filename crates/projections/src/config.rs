use crate::error::{ProjectionError, Result};

#[derive(Debug, Clone)]
pub struct ProjectionsConfig {
    pub database_url: String,
    /// Optional KG database URL for writing to `kg.nodes` + `kg.events`.
    ///
    /// When absent the `CoreEntitiesProjection` skips KG writes gracefully.
    /// Set via `DATABASE_KG_URL`.
    pub database_kg_url: Option<String>,
    pub surreal_url: String,
    pub surreal_user: String,
    pub surreal_pass: String,
    pub surreal_namespace: String,
    pub surreal_database: String,
    pub metrics_port: u16,
    pub batch_size: usize,
    pub poll_interval_ms: u64,
    pub leaderboard_refresh_interval_secs: u64,
    /// Seconds between funnel tracker cycles. Defaults to 3600 (1 hour).
    ///
    /// Set via `FUNNEL_TRACKER_INTERVAL_SECS=<n>`.
    pub funnel_tracker_interval_secs: u64,
    /// Seconds between user_activity_batch cycles. Defaults to 3600 (1 hour).
    ///
    /// Set via `USER_ACTIVITY_BATCH_INTERVAL_SECS=<n>`.
    pub user_activity_batch_interval_secs: u64,
    /// Number of shards for vault-writing projections (vault_state +
    /// position_tracking). Both use the same shard count so each vault
    /// row is owned by exactly one shard, eliminating deadlocks.
    /// When > 1, N workers are spawned per projection, each processing
    /// a deterministic subset of vaults by `hash(term_id, curve_id) % N`.
    pub position_tracking_shards: u32,
    /// Whitelist of projection names to run.
    /// If non-empty, only projections whose name appears in this set are spawned.
    /// Names: atom, triple, deposit, redeem, price, fee, vault_state,
    /// position_tracking, account_registry, event_log, signals_analytics,
    /// term_aggregates, protocol_stats, leaderboard_marker,
    /// leaderboard_refresh, core_entities, vault_holders_index,
    /// activity_marker, user_activity_batch, funnel_tracker,
    /// vault_state:dual, vault_holders_index:dual.
    ///
    /// Set via `ENABLED_PROJECTIONS=vault_state,position_tracking,...`
    pub enabled_projections: Vec<String>,
    /// Blacklist of projection names to skip.
    /// Set via `DISABLED_PROJECTIONS=deposit,redeem,...`
    /// Ignored if `enabled_projections` is non-empty.
    pub disabled_projections: Vec<String>,
    /// Override the PostgreSQL connection pool ceiling passed to
    /// `PgPoolOptions::max_connections`.  `None` lets the `PoolPartitioner`
    /// calculate an appropriate value from the number of active projections.
    ///
    /// Set via `PG_POOL_MAX_CONNECTIONS=<n>`.
    pub pg_pool_max_connections: Option<u32>,
    /// Override the semaphore-acquire timeout used by `PoolPartitioner`.
    /// `None` uses the default of 5 seconds.
    ///
    /// Set via `PG_POOL_ACQUIRE_TIMEOUT_SECS=<n>`.
    pub pg_pool_acquire_timeout_secs: Option<u64>,
}

impl ProjectionsConfig {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            database_url: require_env("DATABASE_URL")?,
            database_kg_url: std::env::var("DATABASE_KG_URL").ok(),
            surreal_url: env_or("SURREAL_DB_URL", "ws://localhost:8000"),
            surreal_user: env_or("SURREAL_USER", "root"),
            surreal_pass: env_or("SURREAL_PASS", "root"),
            surreal_namespace: env_or("SURREAL_NAMESPACE", "intuition"),
            surreal_database: env_or("SURREAL_DATABASE", "intuition"),
            metrics_port: env_or("PROJECTIONS_METRICS_PORT", "9092")
                .parse()
                .map_err(|e| ProjectionError::Config(format!("Invalid metrics port: {e}")))?,
            batch_size: env_or("PROJECTIONS_BATCH_SIZE", "500")
                .parse()
                .map_err(|e| ProjectionError::Config(format!("Invalid batch size: {e}")))?,
            poll_interval_ms: env_or("PROJECTIONS_POLL_INTERVAL_MS", "1000")
                .parse()
                .map_err(|e| ProjectionError::Config(format!("Invalid poll interval: {e}")))?,
            leaderboard_refresh_interval_secs: env_or("LEADERBOARD_REFRESH_INTERVAL_SECS", "30")
                .parse()
                .map_err(|e| {
                    ProjectionError::Config(format!("Invalid leaderboard interval: {e}"))
                })?,
            funnel_tracker_interval_secs: env_or("FUNNEL_TRACKER_INTERVAL_SECS", "3600")
                .parse()
                .map_err(|e| {
                    ProjectionError::Config(format!("Invalid funnel tracker interval: {e}"))
                })?,
            user_activity_batch_interval_secs: env_or("USER_ACTIVITY_BATCH_INTERVAL_SECS", "3600")
                .parse()
                .map_err(|e| {
                    ProjectionError::Config(format!("Invalid user activity batch interval: {e}"))
                })?,
            position_tracking_shards: env_or("POSITION_TRACKING_SHARDS", "4").parse().map_err(
                |e| ProjectionError::Config(format!("Invalid position tracking shards: {e}")),
            )?,
            enabled_projections: parse_csv_env("ENABLED_PROJECTIONS"),
            disabled_projections: parse_csv_env("DISABLED_PROJECTIONS"),
            pg_pool_max_connections: parse_optional_env_u32("PG_POOL_MAX_CONNECTIONS"),
            pg_pool_acquire_timeout_secs: parse_optional_env_u64("PG_POOL_ACQUIRE_TIMEOUT_SECS"),
        })
    }

    /// Returns true if a projection with the given name should be spawned,
    /// based on the enabled/disabled lists.
    ///
    /// Rules:
    /// - If `enabled_projections` is non-empty → only those names run.
    /// - Else if `disabled_projections` is non-empty → everything except those.
    /// - Else → everything runs (default).
    pub fn is_projection_enabled(&self, name: &str) -> bool {
        if !self.enabled_projections.is_empty() {
            return self.enabled_projections.iter().any(|n| n == name);
        }
        if !self.disabled_projections.is_empty() {
            return !self.disabled_projections.iter().any(|n| n == name);
        }
        true
    }
}

fn require_env(key: &str) -> Result<String> {
    std::env::var(key).map_err(|_| ProjectionError::Config(format!("{key} must be set")))
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// Parse a comma-separated env var into a Vec of trimmed, non-empty strings.
fn parse_csv_env(key: &str) -> Vec<String> {
    std::env::var(key)
        .unwrap_or_default()
        .split(',')
        .map(|s| s.trim().to_owned())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Parse an optional `u32` from an environment variable.
/// Returns `None` if the variable is unset or cannot be parsed.
fn parse_optional_env_u32(key: &str) -> Option<u32> {
    std::env::var(key).ok()?.parse::<u32>().ok()
}

/// Parse an optional `u64` from an environment variable.
/// Returns `None` if the variable is unset or cannot be parsed.
fn parse_optional_env_u64(key: &str) -> Option<u64> {
    std::env::var(key).ok()?.parse::<u64>().ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config_with(enabled: Vec<&str>, disabled: Vec<&str>) -> ProjectionsConfig {
        ProjectionsConfig {
            database_url: String::new(),
            database_kg_url: None,
            surreal_url: String::new(),
            surreal_user: String::new(),
            surreal_pass: String::new(),
            surreal_namespace: String::new(),
            surreal_database: String::new(),
            metrics_port: 9092,
            batch_size: 500,
            poll_interval_ms: 1000,
            leaderboard_refresh_interval_secs: 30,
            funnel_tracker_interval_secs: 3600,
            user_activity_batch_interval_secs: 3600,
            position_tracking_shards: 1,
            enabled_projections: enabled.into_iter().map(String::from).collect(),
            disabled_projections: disabled.into_iter().map(String::from).collect(),
            pg_pool_max_connections: None,
            pg_pool_acquire_timeout_secs: None,
        }
    }

    #[test]
    fn default_enables_everything() {
        let c = config_with(vec![], vec![]);
        assert!(c.is_projection_enabled("vault_state"));
        assert!(c.is_projection_enabled("deposit"));
        assert!(c.is_projection_enabled("anything"));
    }

    #[test]
    fn enabled_whitelist() {
        let c = config_with(vec!["vault_state", "deposit"], vec![]);
        assert!(c.is_projection_enabled("vault_state"));
        assert!(c.is_projection_enabled("deposit"));
        assert!(!c.is_projection_enabled("redeem"));
        assert!(!c.is_projection_enabled("core_entities"));
    }

    #[test]
    fn disabled_blacklist() {
        let c = config_with(vec![], vec!["deposit", "redeem"]);
        assert!(c.is_projection_enabled("vault_state"));
        assert!(!c.is_projection_enabled("deposit"));
        assert!(!c.is_projection_enabled("redeem"));
    }

    #[test]
    fn enabled_takes_precedence_over_disabled() {
        let c = config_with(vec!["vault_state"], vec!["vault_state"]);
        // enabled is non-empty, so disabled is ignored
        assert!(c.is_projection_enabled("vault_state"));
        assert!(!c.is_projection_enabled("deposit"));
    }
}
