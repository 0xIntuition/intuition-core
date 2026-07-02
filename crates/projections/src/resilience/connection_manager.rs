//! Connection pool partitioning and SurrealDB reconnection management.
//!
//! # Overview
//!
//! This module solves two distinct resource-contention problems:
//!
//! ## PostgreSQL: Connection Stampedes
//!
//! All workers previously shared a single `PgPool` with a global 20-connection
//! ceiling. Under load every worker races for the same pool, causing latency
//! spikes and connection starvation for high-priority projections.
//!
//! [`PoolPartitioner`] assigns each projection a [`tokio::sync::Semaphore`]
//! whose permit count reflects the projection's [`ConnectionTier`]. Workers
//! must hold a permit for the lifetime of each DB operation, capping
//! concurrency per projection independently of the others.
//!
//! ## SurrealDB: Thundering-Herd Reconnection
//!
//! Six workers shared a single `Arc<SurrealSink>` WebSocket. When the socket
//! drops all six simultaneously detect the failure and attempt to reconnect,
//! hammering the server. [`ReconnectingSurreal`] serialises reconnection
//! attempts behind a [`tokio::sync::RwLock`]: only one task reconnects at a
//! time while the rest wait, then proceed on the restored connection.

use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Duration;

use surrealdb::engine::remote::ws::{Client, Ws, Wss};
use surrealdb::opt::auth::Root;
use surrealdb::Surreal;
use tokio::sync::{RwLock, RwLockReadGuard, Semaphore, SemaphorePermit};
use tracing::{error, info, warn};

// ---------------------------------------------------------------------------
// ConnectionTier
// ---------------------------------------------------------------------------

/// Categorises a projection by its PostgreSQL connection requirements.
///
/// The tier determines how many concurrent semaphore permits a projection
/// receives and therefore how many simultaneous DB operations it may execute.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ConnectionTier {
    /// Heavy-write projections such as `vault_state`, `position_tracking`,
    /// and `core_entities` that issue many wide upserts per batch.
    Critical,
    /// Standard projections such as `event_log` and `account_registry` that
    /// perform moderate amounts of point-writes.
    Standard,
    /// Timer-driven projections such as `leaderboard_refresh` that batch-read
    /// and write infrequently.
    Batch,
}

impl ConnectionTier {
    /// Number of semaphore permits allocated to projections in this tier.
    ///
    /// Raising these values without increasing the pool ceiling wastes
    /// permits; lower values reduce contention at the cost of throughput.
    const fn permits(self) -> usize {
        match self {
            Self::Critical => 4,
            Self::Standard => 2,
            Self::Batch => 2,
        }
    }
}

// ---------------------------------------------------------------------------
// ConnectionError
// ---------------------------------------------------------------------------

/// Errors returned by [`PoolPartitioner::acquire`].
///
/// Both variants are considered transient failures — callers should propagate
/// them to the circuit breaker rather than panicking.
#[derive(Debug)]
pub enum ConnectionError {
    /// A semaphore permit was not available within the configured timeout.
    AcquireTimeout {
        /// Name of the projection that timed out.
        projection: String,
        /// The timeout that elapsed.
        timeout: Duration,
    },
    /// No semaphore exists for the requested projection name.
    UnknownProjection(String),
}

impl std::fmt::Display for ConnectionError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::AcquireTimeout {
                projection,
                timeout,
            } => write!(
                f,
                "semaphore acquire timed out for projection '{}' after {:.1}s",
                projection,
                timeout.as_secs_f64()
            ),
            Self::UnknownProjection(name) => {
                write!(f, "no semaphore registered for projection '{name}'")
            }
        }
    }
}

impl std::error::Error for ConnectionError {}

// ---------------------------------------------------------------------------
// PoolPartitioner
// ---------------------------------------------------------------------------

/// Default base number of permits allocated per projection when no override is
/// given. The actual per-projection permit count comes from [`ConnectionTier`];
/// this constant only drives the *total pool size* calculation.
const DEFAULT_BASE_PER_PROJECTION: u32 = 3;

/// Extra connections reserved for migrations, health checks, and ad-hoc
/// queries that run outside the projection workers.
const DEFAULT_OVERHEAD: u32 = 5;

/// Default acquire timeout in seconds.
const DEFAULT_ACQUIRE_TIMEOUT_SECS: u64 = 5;

/// Partitions a `PgPool` among projections using per-projection semaphores.
///
/// # Construction
///
/// Call [`PoolPartitioner::new`] with the list of projection names and their
/// tiers. The returned instance owns one [`Semaphore`] per projection and
/// exposes the total pool size to pass to `PgPoolOptions::max_connections`.
///
/// # Usage
///
/// ```ignore
/// let permit = partitioner.acquire("vault_state").await?;
/// // hold `permit` for the duration of the database operation
/// pool.execute(query).await?;
/// drop(permit); // releases the semaphore slot
/// ```
///
/// # Environment overrides
///
/// | Variable                       | Effect                                           |
/// |-------------------------------|--------------------------------------------------|
/// | `PG_POOL_MAX_CONNECTIONS`     | Override the calculated total pool size          |
/// | `PG_POOL_ACQUIRE_TIMEOUT_SECS`| Override acquire timeout (default: 5 s)          |
pub struct PoolPartitioner {
    /// One semaphore per projection name, keyed by the projection's registered
    /// name (e.g. `"vault_state"`, `"event_log"`).
    semaphores: HashMap<String, Arc<Semaphore>>,

    /// Calculated (or overridden) total pool ceiling to pass to
    /// `PgPoolOptions::max_connections`.
    pool_size: u32,

    /// How long [`acquire`](PoolPartitioner::acquire) waits for a permit
    /// before returning [`ConnectionError::AcquireTimeout`].
    acquire_timeout: Duration,
}

impl PoolPartitioner {
    /// Build semaphores for all projections and calculate the pool ceiling.
    ///
    /// Pool size formula (unless `pool_override` is `Some`):
    /// ```text
    /// pool_size = DEFAULT_BASE_PER_PROJECTION * num_projections + DEFAULT_OVERHEAD
    /// ```
    ///
    /// Per-projection permit counts are determined by the tier:
    /// - [`ConnectionTier::Critical`] → 4 permits
    /// - [`ConnectionTier::Standard`] → 2 permits
    /// - [`ConnectionTier::Batch`]    → 2 permits
    ///
    /// # Environment overrides
    ///
    /// - `PG_POOL_MAX_CONNECTIONS` — override `pool_override`
    /// - `PG_POOL_ACQUIRE_TIMEOUT_SECS` — override `acquire_timeout_secs`
    ///
    /// # Arguments
    ///
    /// * `projections` — slice of `(name, tier)` pairs for every projection
    ///   that will use the pool
    /// * `pool_override` — explicit pool ceiling; `None` uses the formula
    /// * `acquire_timeout_secs` — permit wait limit; `None` uses 5 s
    pub fn new(
        projections: &[(String, ConnectionTier)],
        pool_override: Option<u32>,
        acquire_timeout_secs: Option<u64>,
    ) -> Self {
        // Environment variables take precedence over code-level arguments.
        let pool_override = read_env_u32("PG_POOL_MAX_CONNECTIONS").or(pool_override);
        let acquire_timeout_secs =
            read_env_u64("PG_POOL_ACQUIRE_TIMEOUT_SECS").or(acquire_timeout_secs);

        let acquire_timeout =
            Duration::from_secs(acquire_timeout_secs.unwrap_or(DEFAULT_ACQUIRE_TIMEOUT_SECS));

        let pool_size = pool_override.unwrap_or_else(|| {
            (DEFAULT_BASE_PER_PROJECTION * projections.len() as u32) + DEFAULT_OVERHEAD
        });

        let semaphores = projections
            .iter()
            .map(|(name, tier)| {
                let permits = tier.permits();
                (name.clone(), Arc::new(Semaphore::new(permits)))
            })
            .collect();

        info!(
            pool_size,
            acquire_timeout_secs = acquire_timeout.as_secs(),
            num_projections = projections.len(),
            "PoolPartitioner initialised"
        );

        Self {
            semaphores,
            pool_size,
            acquire_timeout,
        }
    }

    /// The total PostgreSQL connection pool ceiling.
    ///
    /// Pass this value to `PgPoolOptions::max_connections` when constructing
    /// the shared pool so the pool ceiling matches the partitioner's budget.
    pub fn total_pool_size(&self) -> u32 {
        self.pool_size
    }

    /// Acquire one connection permit for `projection_name`.
    ///
    /// The returned [`SemaphorePermit`] must be held for the entire duration
    /// of the database operation and released (dropped) immediately after.
    /// Holding the permit longer than necessary starves other tasks.
    ///
    /// # Errors
    ///
    /// - [`ConnectionError::UnknownProjection`] if `projection_name` was not
    ///   registered at construction time.
    /// - [`ConnectionError::AcquireTimeout`] if no permit becomes available
    ///   within the configured timeout — treat this as a transient failure and
    ///   route to the circuit breaker.
    pub async fn acquire(
        &self,
        projection_name: &str,
    ) -> Result<SemaphorePermit<'_>, ConnectionError> {
        let semaphore = self
            .semaphores
            .get(projection_name)
            .ok_or_else(|| ConnectionError::UnknownProjection(projection_name.to_string()))?;

        tokio::time::timeout(self.acquire_timeout, semaphore.acquire())
            .await
            // `timeout` returns `Err` when the deadline expires.
            .map_err(|_| ConnectionError::AcquireTimeout {
                projection: projection_name.to_string(),
                timeout: self.acquire_timeout,
            })
            // `semaphore.acquire()` returns `Err` only when the semaphore is
            // closed, which only happens during shutdown — treat as timeout.
            .and_then(|res| {
                res.map_err(|_| ConnectionError::AcquireTimeout {
                    projection: projection_name.to_string(),
                    timeout: self.acquire_timeout,
                })
            })
    }

    /// Number of permits currently available for `projection_name`.
    ///
    /// Useful for Prometheus gauges. Returns `None` if the projection is not
    /// registered.
    pub fn available_permits(&self, projection_name: &str) -> Option<usize> {
        self.semaphores
            .get(projection_name)
            .map(|s| s.available_permits())
    }
}

// ---------------------------------------------------------------------------
// Helpers for reading environment variables
// ---------------------------------------------------------------------------

fn read_env_u32(key: &str) -> Option<u32> {
    std::env::var(key).ok().and_then(|v| {
        v.parse::<u32>()
            .map_err(|e| {
                tracing::warn!(
                    key,
                    value = %v,
                    error = %e,
                    "Ignoring unparseable environment variable"
                );
            })
            .ok()
    })
}

fn read_env_u64(key: &str) -> Option<u64> {
    std::env::var(key).ok().and_then(|v| {
        v.parse::<u64>()
            .map_err(|e| {
                tracing::warn!(
                    key,
                    value = %v,
                    error = %e,
                    "Ignoring unparseable environment variable"
                );
            })
            .ok()
    })
}

// ---------------------------------------------------------------------------
// SurrealConfig
// ---------------------------------------------------------------------------

/// Parameters required to open (or reopen) a SurrealDB connection.
#[derive(Clone)]
pub struct SurrealConfig {
    /// WebSocket URL, e.g. `ws://localhost:8000` or `wss://db.example.com`.
    pub url: String,
    /// Root username for authentication.
    pub user: String,
    /// Root password for authentication.  Never logged — see the `Debug` impl.
    pub pass: String,
    /// SurrealDB namespace to select after connecting.
    pub namespace: String,
    /// SurrealDB database to select within the namespace.
    pub database: String,
}

impl std::fmt::Debug for SurrealConfig {
    /// Redacts `pass` so that credentials are never emitted in log output.
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("SurrealConfig")
            .field("url", &self.url)
            .field("user", &self.user)
            .field("pass", &"[REDACTED]")
            .field("namespace", &self.namespace)
            .field("database", &self.database)
            .finish()
    }
}

// ---------------------------------------------------------------------------
// ReconnectingSurreal
// ---------------------------------------------------------------------------

/// Wraps a SurrealDB [`Surreal<Client>`] with automatic reconnection on
/// failure, serialising reconnection attempts to prevent thundering-herd
/// stampedes.
///
/// # Design
///
/// Internally the live connection is stored as
/// `RwLock<Option<Surreal<Client>>>`.  Readers acquire a read-lock to run
/// queries.  When a query fails the caller calls [`mark_disconnected`], which
/// clears the slot under a write-lock and sets an [`AtomicBool`] flag to
/// `false`.
///
/// The next call to [`get_connection`] detects the `false` flag, acquires the
/// write-lock exclusively, and attempts reconnection.  Any task that races to
/// the write-lock after the first task has already reconnected finds the slot
/// populated and skips the reconnect (double-checked locking pattern).
///
/// Only **one** task therefore attempts reconnection at a time; all others
/// block on the write-lock and then proceed with the restored connection.
///
/// # Reconnection timeout
///
/// Each reconnection attempt has up to a 7-second deadline (5 s connect +
/// 2 s health-check). If either deadline expires the error is returned to the
/// caller, which is expected to route it through the circuit breaker for
/// exponential back-off.
///
/// [`mark_disconnected`]: ReconnectingSurreal::mark_disconnected
pub struct ReconnectingSurreal {
    /// `None` while disconnected, `Some` while healthy.
    ///
    /// `RwLock` is chosen (over `Mutex`) because many tasks read concurrently
    /// but only one reconnects at a time.  `tokio::sync::RwLock` is required
    /// because the reconnection path is `async`.
    connection: RwLock<Option<Surreal<Client>>>,

    /// Immutable parameters used to (re)open the connection.
    config: SurrealConfig,

    /// Fast-path flag checked before attempting to acquire any lock.
    ///
    /// Set to `true` after a successful connection and back to `false` by
    /// [`mark_disconnected`].  Using `AtomicBool` avoids lock contention on
    /// the happy path where every health check just reads this flag.
    ///
    /// [`mark_disconnected`]: ReconnectingSurreal::mark_disconnected
    connected: AtomicBool,
}

/// Timeout applied to each individual SurrealDB connect+auth+select sequence.
const SURREAL_CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

/// Timeout applied to the post-connect health-check query (`RETURN true`).
///
/// Combined with [`SURREAL_CONNECT_TIMEOUT`], the total per-attempt budget is
/// up to 7 seconds (5 s connect + 2 s health-check).
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(2);

impl ReconnectingSurreal {
    /// Open the initial connection and return a ready-to-use wrapper.
    ///
    /// # Errors
    ///
    /// Returns a [`surrealdb::Error`] if the initial connection fails (e.g.
    /// the server is unreachable during startup). The caller typically retries
    /// in a startup loop.
    pub async fn new(config: SurrealConfig) -> Result<Arc<Self>, surrealdb::Error> {
        let db = connect_surreal(&config).await?;

        Ok(Arc::new(Self {
            connection: RwLock::new(Some(db)),
            config,
            connected: AtomicBool::new(true),
        }))
    }

    /// Obtain a read-lock guard containing the live connection.
    ///
    /// If the connection is currently healthy this is a cheap read-lock
    /// acquisition.  If it is disconnected this method serialises all callers
    /// through a write-lock, reconnects exactly once, then returns a
    /// read-lock on the restored connection.
    ///
    /// Callers should unwrap the `Option` inside the guard — it is always
    /// `Some` when this method returns `Ok`.
    ///
    /// # Errors
    ///
    /// Returns a [`surrealdb::Error`] if the reconnection attempt fails within
    /// the 7-second budget (5 s connect + 2 s health-check). Callers should
    /// treat this as a transient failure and propagate it to the circuit breaker.
    pub async fn get_connection(
        &self,
    ) -> Result<RwLockReadGuard<'_, Option<Surreal<Client>>>, surrealdb::Error> {
        // Fast path: connection is healthy, return a read-lock immediately.
        // `Relaxed` ordering is sufficient here because we will re-check the
        // `Option` under the lock before using it.
        if self.connected.load(Ordering::Relaxed) {
            return Ok(self.connection.read().await);
        }

        // Slow path: need to reconnect. Acquire the write-lock exclusively so
        // that only one task performs the reconnection sequence.
        {
            let mut guard = self.connection.write().await;

            // Double-check: another task may have already reconnected while we
            // were waiting for the write-lock. If the slot is populated we can
            // skip reconnection entirely.
            if guard.is_some() {
                // Restore the flag in case mark_disconnected raced here.
                self.connected.store(true, Ordering::Release);
                // Drop the write guard before re-acquiring the read guard to
                // avoid a deadlock (RwLock is not reentrant in tokio).
                drop(guard);
                return Ok(self.connection.read().await);
            }

            info!(
                url = %self.config.url,
                namespace = %self.config.namespace,
                database = %self.config.database,
                "SurrealDB disconnected — attempting reconnection"
            );

            match tokio::time::timeout(SURREAL_CONNECT_TIMEOUT, connect_surreal(&self.config)).await
            {
                Ok(Ok(db)) => {
                    // Verify the connection is query-ready, not just socket-open.
                    // SurrealDB may accept WebSocket connections before it can
                    // serve queries (e.g. during post-restart warmup).
                    match tokio::time::timeout(HEALTH_CHECK_TIMEOUT, db.query("RETURN true")).await
                    {
                        Ok(Ok(_)) => {
                            info!(
                                url = %self.config.url,
                                "SurrealDB reconnected and health-check passed"
                            );
                            *guard = Some(db);
                            self.connected.store(true, Ordering::Release);
                        }
                        Ok(Err(err)) => {
                            warn!(
                                url = %self.config.url,
                                error = %err,
                                "SurrealDB health-check failed after reconnect"
                            );
                            return Err(err);
                        }
                        Err(_elapsed) => {
                            warn!(
                                url = %self.config.url,
                                "SurrealDB health-check timed out after reconnect"
                            );
                            return Err(surrealdb::Error::connection(
                                format!("health-check timed out for {}", self.config.url),
                                None,
                            ));
                        }
                    }
                }
                Ok(Err(err)) => {
                    error!(
                        url = %self.config.url,
                        error = %err,
                        "SurrealDB reconnection failed"
                    );
                    // Leave `guard` as `None` so the next caller retries.
                    return Err(err);
                }
                Err(_elapsed) => {
                    error!(
                        url = %self.config.url,
                        timeout_secs = SURREAL_CONNECT_TIMEOUT.as_secs(),
                        "SurrealDB reconnection timed out"
                    );
                    // Synthesise a connection error. `surrealdb::Error` in v3
                    // is constructed via factory functions rather than enum
                    // variants; `connection` is the closest semantic match.
                    return Err(surrealdb::Error::connection(
                        format!(
                            "reconnection to {} timed out after {}s",
                            self.config.url,
                            SURREAL_CONNECT_TIMEOUT.as_secs()
                        ),
                        None,
                    ));
                }
            }
        }

        // Write-lock released — now acquire the read-lock for the caller.
        Ok(self.connection.read().await)
    }

    /// Signal that the current connection has failed.
    ///
    /// This clears the connection slot under a write-lock and sets the
    /// `connected` flag to `false` so the next call to
    /// [`get_connection`](Self::get_connection) triggers a reconnection
    /// attempt.
    ///
    /// Safe to call from any task or thread; concurrent calls are harmless
    /// because both will attempt the write-lock and both will set the same
    /// state.
    pub fn mark_disconnected(&self) {
        // Set the flag first so other tasks stop issuing new read-lock
        // acquisitions that would succeed but then fail at the DB layer.
        self.connected.store(false, Ordering::Release);

        // Clear the slot under a blocking write-lock. We use `try_write` so
        // this method stays synchronous — if another task already holds the
        // write-lock it is either doing the same thing (harmless) or
        // reconnecting (the reconnect path will set `guard` back to `Some`).
        match self.connection.try_write() {
            Ok(mut guard) => {
                *guard = None;
            }
            Err(_) => {
                // Another task has the write-lock. If it is reconnecting it
                // will detect `connected == false` and proceed; if it is also
                // disconnecting the slot will be cleared by them. Either way
                // the invariant holds.
                warn!("mark_disconnected: write-lock contended, disconnect will be handled by current writer");
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Internal: SurrealDB connection helper
// ---------------------------------------------------------------------------

/// Open a fresh SurrealDB connection using the given [`SurrealConfig`].
///
/// Handles `ws://` vs `wss://` scheme detection, authentication, and
/// namespace/database selection in one place so both the constructor and the
/// reconnection path share identical logic.
async fn connect_surreal(config: &SurrealConfig) -> Result<Surreal<Client>, surrealdb::Error> {
    let (addr, secure) = if let Some(stripped) = config.url.strip_prefix("wss://") {
        (stripped, true)
    } else if let Some(stripped) = config.url.strip_prefix("ws://") {
        (stripped, false)
    } else {
        // Reject unknown schemes rather than silently falling back to plain WS,
        // which would produce a confusing connection error instead of a clear
        // configuration error.
        return Err(surrealdb::Error::connection(
            format!("unsupported SurrealDB URL scheme: {}", config.url),
            None,
        ));
    };

    let db: Surreal<Client> = if secure {
        Surreal::new::<Wss>(addr).await?
    } else {
        Surreal::new::<Ws>(addr).await?
    };

    db.signin(Root {
        username: config.user.clone(),
        password: config.pass.clone(),
    })
    .await?;

    db.use_ns(&config.namespace)
        .use_db(&config.database)
        .await?;

    Ok(db)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn make_projections(specs: &[(&str, ConnectionTier)]) -> Vec<(String, ConnectionTier)> {
        specs
            .iter()
            .map(|(name, tier)| (name.to_string(), *tier))
            .collect()
    }

    // -----------------------------------------------------------------------
    // Pool size calculation
    // -----------------------------------------------------------------------

    #[test]
    fn pool_size_formula_matches_spec() {
        // 6 projections, no override.
        // Expected: 3 * 6 + 5 = 23
        let projections = make_projections(&[
            ("vault_state", ConnectionTier::Critical),
            ("position_tracking", ConnectionTier::Critical),
            ("core_entities", ConnectionTier::Critical),
            ("event_log", ConnectionTier::Standard),
            ("account_registry", ConnectionTier::Standard),
            ("leaderboard_refresh", ConnectionTier::Batch),
        ]);
        let p = PoolPartitioner::new(&projections, None, None);
        assert_eq!(p.total_pool_size(), 23);
    }

    #[test]
    fn pool_size_respects_override() {
        let projections = make_projections(&[("event_log", ConnectionTier::Standard)]);
        let p = PoolPartitioner::new(&projections, Some(50), None);
        assert_eq!(p.total_pool_size(), 50);
    }

    #[test]
    fn pool_size_zero_projections() {
        // Edge case: no projections → only overhead.
        let p = PoolPartitioner::new(&[], None, None);
        assert_eq!(p.total_pool_size(), DEFAULT_OVERHEAD);
    }

    // -----------------------------------------------------------------------
    // Tier permit counts
    // -----------------------------------------------------------------------

    #[test]
    fn critical_tier_gets_four_permits() {
        assert_eq!(ConnectionTier::Critical.permits(), 4);
    }

    #[test]
    fn standard_tier_gets_two_permits() {
        assert_eq!(ConnectionTier::Standard.permits(), 2);
    }

    #[test]
    fn batch_tier_gets_two_permits() {
        assert_eq!(ConnectionTier::Batch.permits(), 2);
    }

    // -----------------------------------------------------------------------
    // available_permits
    // -----------------------------------------------------------------------

    #[test]
    fn available_permits_reflects_tier_on_fresh_partitioner() {
        let projections = make_projections(&[
            ("vault_state", ConnectionTier::Critical),
            ("event_log", ConnectionTier::Standard),
            ("leaderboard_refresh", ConnectionTier::Batch),
        ]);
        let p = PoolPartitioner::new(&projections, None, None);

        assert_eq!(p.available_permits("vault_state"), Some(4));
        assert_eq!(p.available_permits("event_log"), Some(2));
        assert_eq!(p.available_permits("leaderboard_refresh"), Some(2));
    }

    #[test]
    fn available_permits_returns_none_for_unknown_projection() {
        let projections = make_projections(&[("event_log", ConnectionTier::Standard)]);
        let p = PoolPartitioner::new(&projections, None, None);
        assert_eq!(p.available_permits("does_not_exist"), None);
    }

    // -----------------------------------------------------------------------
    // Semaphore behaviour
    // -----------------------------------------------------------------------

    #[tokio::test]
    async fn acquire_returns_err_for_unknown_projection() {
        let projections = make_projections(&[("event_log", ConnectionTier::Standard)]);
        let p = PoolPartitioner::new(&projections, None, None);

        let result = p.acquire("no_such_projection").await;
        assert!(
            matches!(result, Err(ConnectionError::UnknownProjection(_))),
            "expected UnknownProjection, got {result:?}"
        );
    }

    #[tokio::test]
    async fn acquire_reduces_available_permits() {
        let projections = make_projections(&[("vault_state", ConnectionTier::Critical)]);
        let p = PoolPartitioner::new(&projections, None, None);

        assert_eq!(p.available_permits("vault_state"), Some(4));
        let _permit = p
            .acquire("vault_state")
            .await
            .expect("should acquire successfully");
        assert_eq!(p.available_permits("vault_state"), Some(3));
    }

    #[tokio::test]
    async fn permit_released_on_drop() {
        let projections = make_projections(&[("event_log", ConnectionTier::Standard)]);
        let p = PoolPartitioner::new(&projections, None, None);

        {
            let _p1 = p.acquire("event_log").await.unwrap();
            let _p2 = p.acquire("event_log").await.unwrap();
            assert_eq!(p.available_permits("event_log"), Some(0));
        } // both permits dropped here

        assert_eq!(p.available_permits("event_log"), Some(2));
    }

    #[tokio::test]
    async fn acquire_times_out_when_all_permits_exhausted() {
        // Use a very short timeout so the test completes quickly.
        let projections = make_projections(&[("event_log", ConnectionTier::Standard)]);
        // 1-second acquire timeout.
        let p = PoolPartitioner::new(&projections, None, Some(1));

        // Hold all 2 Standard permits indefinitely within the test.
        let _p1 = p.acquire("event_log").await.unwrap();
        let _p2 = p.acquire("event_log").await.unwrap();

        // The third acquire should time out.
        let result = p.acquire("event_log").await;
        assert!(
            matches!(result, Err(ConnectionError::AcquireTimeout { .. })),
            "expected AcquireTimeout, got {result:?}"
        );
    }
}
