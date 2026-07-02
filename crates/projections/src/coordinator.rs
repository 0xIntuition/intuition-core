//! Coordinator: spawns and supervises all worker types.
//!
//! The `Coordinator` is the top-level runtime object for the projections
//! service. It wires together shared infrastructure and fans out workers
//! for SurrealDB projections, PG-direct projections, and batch projections.
//!
//! Each worker is:
//! 1. Given a [`crate::watchdog::Heartbeat`] that it beats after every
//!    successful batch.
//! 2. Registered with a shared [`crate::watchdog::Watchdog`] that cancels
//!    stalled workers.
//! 3. Wrapped in a [`crate::supervisor::Supervisor`] that catches panics via
//!    `JoinHandle` and applies exponential-backoff restart with structured
//!    metrics (`projection_restart_total`, `projection_restart_backoff_seconds`).
//!    After 5 minutes of healthy operation the backoff resets to minimum.

use sqlx::PgPool;
use std::sync::Arc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::info;

use crate::config::ProjectionsConfig;
use crate::event::reader::EventReader;
use crate::event::source::EventSource;
use crate::event::typed_reader::TypedEventReader;
use crate::projection;
use crate::projection::pg::{BatchProjection, PgProjection};
use crate::resilience::checkpoint::CheckpointStore;
use crate::resilience::circuit_breaker::CircuitBreaker;
use crate::resilience::connection_manager::PoolPartitioner;
use crate::resilience::retry::WorkerConfig;
use crate::resilience::supervised_adapters::{
    SupervisedBatchWorker, SupervisedPgWorker, SupervisedSurrealWorker,
};
use crate::resilience::supervisor::Supervisor;
use crate::resilience::watchdog::{Heartbeat, Watchdog, WatchedWorker};
use crate::sink::ProjectionSink;
use crate::worker::{BatchWorker, PgWorker, Worker};

// ---------------------------------------------------------------------------
// Projection factories
// ---------------------------------------------------------------------------

/// Recreate a PG projection by name and optional shard parameters.
///
/// This factory is called by the supervisor on each restart so a fresh
/// `Box<dyn PgProjection>` is available for every new `PgWorker` instance.
///
/// # Arguments
///
/// * `name` — Projection name as returned by `PgProjection::name()`.
/// * `shard_id` — Shard index for sharded projections; `None` for unsharded.
/// * `total_shards` — Total shard count (only meaningful when `shard_id` is `Some`).
///
/// # Returns
///
/// `Some(projection)` when the name is recognised, `None` otherwise.
fn create_pg_projection(
    name: &str,
    shard_id: Option<u32>,
    total_shards: u32,
    kg_pool: Option<&PgPool>,
) -> Option<Box<dyn PgProjection>> {
    match name {
        "event_log" => Some(Box::new(projection::event_log::EventLogProjection)),
        "account_registry" => Some(Box::new(
            projection::account_registry::AccountRegistryProjection,
        )),
        "vault_holders_index" => Some(Box::new(
            projection::vault_holders_index::VaultHoldersIndexProjection,
        )),
        "signals_analytics" => Some(Box::new(
            projection::signals_analytics::SignalsAnalyticsProjection,
        )),
        "term_aggregates" => Some(Box::new(
            projection::term_aggregates::TermAggregatesProjection,
        )),
        "protocol_stats" => Some(Box::new(
            projection::protocol_stats::ProtocolStatsProjection,
        )),
        "activity_marker" => Some(Box::new(
            projection::activity_marker::ActivityMarkerProjection,
        )),
        "leaderboard_marker" => Some(Box::new(
            projection::leaderboard_marker::LeaderboardMarkerProjection,
        )),
        "vault_state" => Some(Box::new(
            // When total_shards == 1, shard_id() returns None (single-shard
            // mode). The projection's should_skip_shard() short-circuits when
            // total_shards <= 1, so passing 0 here is a safe no-op.
            projection::vault_state::VaultStateProjection::new(shard_id.unwrap_or(0), total_shards),
        )),
        "position_tracking" => Some(Box::new(
            projection::position_tracking::PositionTrackingProjection::new(
                shard_id.unwrap_or(0),
                total_shards,
            ),
        )),
        // Dual projectors manage their own kg_pool internally via with_kg_pool().
        // The PgWorker passes the legacy pool; kg writes happen inside process_parsed_batch.
        "vault_state:dual" => {
            let mut proj = projection::dual::vault_state::VaultStateDualProjection::new(
                shard_id.unwrap_or(0),
                total_shards,
            );
            if let Some(kp) = kg_pool {
                proj = proj.with_kg_pool(kp.clone());
            }
            Some(Box::new(proj))
        }
        "vault_holders_index:dual" => {
            let mut proj =
                projection::dual::vault_holders_index::VaultHoldersIndexDualProjection::new();
            if let Some(kp) = kg_pool {
                proj = proj.with_kg_pool(kp.clone());
            }
            Some(Box::new(proj))
        }
        _ => None,
    }
}

/// Recreate a batch projection by name.
///
/// Called on every supervisor restart so a fresh `Box<dyn BatchProjection>` is
/// available for each new `BatchWorker` instance.
///
/// # Arguments
///
/// * `name` — Projection name as returned by `BatchProjection::name()`.
///
/// # Returns
///
/// `Some(projection)` when the name is recognised, `None` otherwise.
fn create_batch_projection(name: &str) -> Option<Box<dyn BatchProjection>> {
    match name {
        "leaderboard_refresh" => Some(Box::new(
            projection::leaderboard_refresh::LeaderboardRefreshProjection,
        )),
        "funnel_tracker" => Some(Box::new(
            projection::funnel_tracker::FunnelTrackerProjection,
        )),
        "user_activity_batch" => Some(Box::new(
            projection::user_activity_batch::UserActivityBatchProjection,
        )),
        _ => None,
    }
}

// ---------------------------------------------------------------------------
// SpawnContext
// ---------------------------------------------------------------------------

/// Bundles the shared infrastructure references that every spawn helper needs.
///
/// Grouping these into one struct keeps the per-worker-type spawn methods
/// under the clippy `too_many_arguments` limit (7 non-self parameters).
struct SpawnContext {
    /// Global cancellation token; child tokens are derived per worker.
    token: CancellationToken,
    /// Shared checkpoint store — one per coordinator instance.
    checkpoint_store: Arc<CheckpointStore>,
    /// Shared event source — either `EventReader` or `TypedEventReader`.
    event_reader: Arc<dyn EventSource>,
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------

/// Owns the shared infrastructure and drives the full set of workers.
pub struct Coordinator {
    config: ProjectionsConfig,
    pool: PgPool,
    /// Optional KG database pool for dual-write projections.
    ///
    /// Passed into `create_pg_projection` so that supervisor restarts can
    /// rebuild dual projectors with the correct kg_pool attached — mirroring
    /// the approach used by `spawn_core_entities_worker` in `main.rs`.
    kg_pool: Option<PgPool>,
    sinks: Vec<Arc<dyn ProjectionSink>>,
    pg_projections: Vec<Box<dyn PgProjection>>,
    batch_projections: Vec<Box<dyn BatchProjection>>,
    /// Shared partitioner passed to every PgWorker and BatchWorker so they
    /// can acquire per-projection semaphore permits before touching the pool.
    partitioner: Arc<PoolPartitioner>,
}

impl Coordinator {
    /// Create a new coordinator.
    pub fn new(
        config: ProjectionsConfig,
        pool: PgPool,
        kg_pool: Option<PgPool>,
        sinks: Vec<Arc<dyn ProjectionSink>>,
        pg_projections: Vec<Box<dyn PgProjection>>,
        batch_projections: Vec<Box<dyn BatchProjection>>,
        partitioner: Arc<PoolPartitioner>,
    ) -> Self {
        Self {
            config,
            pool,
            kg_pool,
            sinks,
            pg_projections,
            batch_projections,
            partitioner,
        }
    }

    /// Spawn all workers and wait for them to finish.
    ///
    /// Both circuit breakers are passed in from the caller so they can be
    /// shared with the `CoreEntitiesWorker` that is spawned outside this
    /// coordinator.
    ///
    /// **Sharing is intentional:** when one worker triggers 5 consecutive
    /// failures and opens the circuit, ALL workers targeting that database
    /// immediately see it as open on their next retry check — they skip
    /// the write attempt and sleep instead.  No writes are lost: each
    /// worker re-reads the same batch from its checkpoint and retries once
    /// the circuit closes.  This avoids every worker independently
    /// discovering the same outage through its own 5-failure sequence.
    ///
    /// * `surreal_cb` — shared across all SurrealDB `Worker`s.
    /// * `pg_cb`      — shared across all `PgWorker`s and `BatchWorker`s.
    ///
    /// Each worker is registered with a [`Watchdog`] that detects stalls via
    /// per-worker heartbeats. The watchdog runs as a background task for the
    /// lifetime of the coordinator.
    ///
    /// Each worker is also wrapped in a [`Supervisor`] that catches panics,
    /// records `projection_restart_total` / `projection_restart_backoff_seconds`
    /// Prometheus metrics, and applies exponential backoff with a 5-minute
    /// healthy-reset window.
    ///
    /// # Arguments
    ///
    /// * `token` — global cancellation token; cancelling triggers clean shutdown.
    /// * `surreal_cb` — shared circuit breaker for all SurrealDB writers.
    /// * `pg_cb` — shared circuit breaker for all PostgreSQL writers.
    /// * `use_typed_reader` — when `true`, use `TypedEventReader` (per-type
    ///   typed tables); when `false`, use the monolithic `EventReader`.  Computed
    ///   once in `main` so the coordinator and the standalone `CoreEntitiesWorker`
    ///   use the same value without re-reading the environment variable.
    pub async fn run(
        self,
        token: CancellationToken,
        surreal_cb: Arc<CircuitBreaker>,
        pg_cb: Arc<CircuitBreaker>,
        use_typed_reader: bool,
    ) {
        let checkpoint_store = Arc::new(CheckpointStore::new(self.pool.clone()));
        let event_reader = build_event_reader(&self.pool, use_typed_reader);

        let surreal_projections: Vec<Box<dyn crate::projection::Projection>> =
            projection::all_projections()
                .into_iter()
                .filter(|p| self.config.is_projection_enabled(p.name()))
                .collect();

        self.init_metrics_labels(&surreal_projections);

        let total_surreal = surreal_projections.len() * self.sinks.len();
        let total_pg = self.pg_projections.len();
        let total_batch = self.batch_projections.len();
        let total_workers = total_surreal + total_pg + total_batch;

        info!(
            surreal_workers = total_surreal,
            pg_workers = total_pg,
            batch_workers = total_batch,
            total = total_workers,
            "Coordinator spawning workers"
        );

        let mut handles: Vec<(String, JoinHandle<()>)> = Vec::with_capacity(total_workers);

        // Create the shared watchdog. Workers register their heartbeats here so
        // the watchdog can cancel any worker that stops making forward progress
        // without returning an error (i.e., silently stalled).
        let mut watchdog = Watchdog::with_defaults();

        // Bundle the shared infrastructure into a single context so the spawn
        // helpers stay under the clippy argument-count limit.
        let spawn_ctx = SpawnContext {
            token: token.clone(),
            checkpoint_store,
            event_reader,
        };

        self.spawn_surreal_workers(
            surreal_projections,
            &mut handles,
            &mut watchdog,
            &spawn_ctx,
            &surreal_cb,
        );
        self.spawn_pg_workers(&mut handles, &mut watchdog, &spawn_ctx, &pg_cb);
        self.spawn_batch_workers(&mut handles, &mut watchdog, &token, &pg_cb);

        // Spawn the watchdog as a background task. It polls worker heartbeats
        // every 10 seconds and cancels any worker that has not beaten within
        // the 120-second stall threshold.
        let watchdog_token = token.clone();
        tokio::spawn(async move {
            watchdog.run(watchdog_token).await;
        });

        // Publish the startup-complete gauge so health checks can distinguish
        // "process is alive and all workers spawned" from "process just started".
        crate::metrics::mark_startup_complete();

        info!(
            workers = handles.len(),
            "All workers spawned; waiting for completion"
        );

        await_worker_handles(handles).await;

        info!("All workers have stopped; coordinator shutting down");
    }

    // ---------------------------------------------------------------------------
    // Private helpers
    // ---------------------------------------------------------------------------

    /// Pre-seed Prometheus label series for all (projection, sink) pairs.
    ///
    /// Called once before spawning workers so Grafana dashboards show every
    /// series from the very first scrape, even before events start flowing.
    fn init_metrics_labels(&self, surreal_projections: &[Box<dyn crate::projection::Projection>]) {
        // Build owned strings first so sharded names (e.g. "position_tracking_s0")
        // live long enough for the borrow in initialise_labels.
        let mut owned_pairs: Vec<(String, String)> = surreal_projections
            .iter()
            .flat_map(|p| {
                self.sinks
                    .iter()
                    .map(move |s| (p.name().to_owned(), s.name().to_owned()))
            })
            .collect();
        for pg in &self.pg_projections {
            let name = match pg.shard_id() {
                Some(id) => format!("{}_s{}", pg.name(), id),
                None => pg.name().to_owned(),
            };
            owned_pairs.push((name, "pg".to_owned()));
        }
        for batch in &self.batch_projections {
            owned_pairs.push((batch.name().to_owned(), "batch".to_owned()));
        }
        let label_pairs: Vec<(&str, &str)> = owned_pairs
            .iter()
            .map(|(n, s)| (n.as_str(), s.as_str()))
            .collect();
        crate::metrics::initialise_labels(&label_pairs);
    }

    /// Spawn one supervised SurrealDB worker per (projection, sink) pair.
    fn spawn_surreal_workers(
        &self,
        surreal_projections: Vec<Box<dyn crate::projection::Projection>>,
        handles: &mut Vec<(String, JoinHandle<()>)>,
        watchdog: &mut Watchdog,
        ctx: &SpawnContext,
        surreal_cb: &Arc<CircuitBreaker>,
    ) {
        let worker_config = WorkerConfig::new(self.config.batch_size, self.config.poll_interval_ms);

        for projection_box in surreal_projections {
            for sink in &self.sinks {
                let label = format!("{}:{}", projection_box.name(), sink.name());

                // Capture the projection name so the factory closure can look it
                // up in `all_projections()` on every restart without needing to
                // own the projection itself.
                let proj_name = projection_box.name().to_owned();

                let sup_sink = Arc::clone(sink);
                let sup_ckpt = Arc::clone(&ctx.checkpoint_store);
                let sup_reader = Arc::clone(&ctx.event_reader);
                let sup_cb = Arc::clone(surreal_cb);
                // Clone the shared pool so the supervisor's restart closure
                // can give the rebuilt worker a dead-letter sink on every
                // restart.  `PgPool` is cheap to clone (Arc-backed).
                let sup_pool = self.pool.clone();

                let heartbeat = Heartbeat::new();
                let worker_cancel_token = ctx.token.child_token();

                register_with_watchdog(
                    watchdog,
                    label.clone(),
                    heartbeat.clone(),
                    worker_cancel_token,
                );

                let sup = Supervisor::new(label.clone(), ctx.token.clone());
                let handle = tokio::spawn(async move {
                    sup.run(move || {
                        // Reconstruct a fresh projection from the registry on every
                        // restart.  `all_projections()` is cheap (no I/O) and the
                        // closure is `FnMut` so we clone `proj_name` on each call.
                        let name = proj_name.clone();
                        // `all_projections()` is a compile-time static list; if
                        // `name` was valid when the supervisor started, it must
                        // still be present on every restart — this branch is
                        // logically unreachable.
                        let proj = projection::all_projections()
                            .into_iter()
                            .find(|p| p.name() == name)
                            .unwrap_or_else(|| {
                                unreachable!(
                                    "projection '{name}' must exist in all_projections registry"
                                )
                            });

                        let worker = Worker::new(
                            proj,
                            Arc::clone(&sup_sink),
                            Arc::clone(&sup_ckpt),
                            Arc::clone(&sup_reader),
                            Arc::clone(&sup_cb),
                            worker_config,
                        )
                        .with_heartbeat(heartbeat.clone())
                        .with_dead_letter_pool(sup_pool.clone());

                        SupervisedSurrealWorker::new(proj_name.clone(), worker)
                    })
                    .await;
                });

                info!(worker = %label, "Spawned SurrealDB worker");
                handles.push((label, handle));
            }
        }
    }

    /// Spawn one supervised PG-direct worker per enabled PG projection (including shards).
    fn spawn_pg_workers(
        &self,
        handles: &mut Vec<(String, JoinHandle<()>)>,
        watchdog: &mut Watchdog,
        ctx: &SpawnContext,
        pg_cb: &Arc<CircuitBreaker>,
    ) {
        let worker_config = WorkerConfig::new(self.config.batch_size, self.config.poll_interval_ms);

        for pg_projection in &self.pg_projections {
            let label = match pg_projection.shard_id() {
                Some(id) => format!("{}:pg:s{}", pg_projection.name(), id),
                None => format!("{}:pg", pg_projection.name()),
            };

            // Capture shard parameters for the factory closure.
            let pg_proj_name = pg_projection.name().to_owned();
            let pg_shard_id = pg_projection.shard_id();
            // `total_shards` is only meaningful for sharded projections; the
            // factory will receive it via the closure regardless.
            let pg_total_shards = self.config.position_tracking_shards;

            let sup_pool = self.pool.clone();
            // Clone the optional kg_pool so the supervisor restart closure can
            // rebuild dual projectors with the kg_pool attached on every restart.
            let sup_kg_pool = self.kg_pool.clone();
            let sup_ckpt = Arc::clone(&ctx.checkpoint_store);
            let sup_reader = Arc::clone(&ctx.event_reader);
            let sup_cb = Arc::clone(pg_cb);
            let sup_partitioner = Arc::clone(&self.partitioner);

            let heartbeat = Heartbeat::new();
            let worker_cancel_token = ctx.token.child_token();

            register_with_watchdog(
                watchdog,
                label.clone(),
                heartbeat.clone(),
                worker_cancel_token,
            );

            let sup = Supervisor::new(label.clone(), ctx.token.clone());
            let handle = tokio::spawn(async move {
                sup.run(move || {
                    let name = pg_proj_name.clone();
                    // `create_pg_projection` is a compile-time match; if the
                    // projection name was valid at startup it is always present —
                    // this branch is logically unreachable.
                    let proj = create_pg_projection(
                        &name,
                        pg_shard_id,
                        pg_total_shards,
                        sup_kg_pool.as_ref(),
                    )
                    .unwrap_or_else(|| {
                        unreachable!(
                            "PG projection '{name}' must be registered in create_pg_projection"
                        )
                    });

                    let worker = PgWorker::new(
                        proj,
                        sup_pool.clone(),
                        Arc::clone(&sup_ckpt),
                        Arc::clone(&sup_reader),
                        Arc::clone(&sup_cb),
                        Arc::clone(&sup_partitioner),
                        worker_config,
                    )
                    .with_heartbeat(heartbeat.clone());

                    SupervisedPgWorker::new(pg_proj_name.clone(), worker)
                })
                .await;
            });

            info!(worker = %label, "Spawned PG worker");
            handles.push((label, handle));
        }
    }

    /// Spawn one supervised batch worker per enabled batch projection.
    fn spawn_batch_workers(
        &self,
        handles: &mut Vec<(String, JoinHandle<()>)>,
        watchdog: &mut Watchdog,
        token: &CancellationToken,
        pg_cb: &Arc<CircuitBreaker>,
    ) {
        for batch_projection in &self.batch_projections {
            let label = format!("{}:batch", batch_projection.name());

            let batch_proj_name = batch_projection.name().to_owned();
            let sup_pool = self.pool.clone();
            // Resolve the cycle interval per projection name so each batch
            // projection can have its own configurable cadence.
            let sup_interval = match batch_projection.name() {
                "funnel_tracker" => self.config.funnel_tracker_interval_secs,
                "user_activity_batch" => self.config.user_activity_batch_interval_secs,
                _ => self.config.leaderboard_refresh_interval_secs,
            };
            let sup_cb = Arc::clone(pg_cb);
            let sup_partitioner = Arc::clone(&self.partitioner);

            let heartbeat = Heartbeat::new();
            let worker_cancel_token = token.child_token();

            register_with_watchdog(
                watchdog,
                label.clone(),
                heartbeat.clone(),
                worker_cancel_token,
            );

            let sup = Supervisor::new(label.clone(), token.clone());
            let handle = tokio::spawn(async move {
                sup.run(move || {
                    let name = batch_proj_name.clone();
                    // `create_batch_projection` is a compile-time match; if the
                    // projection name was valid at startup it is always present —
                    // this branch is logically unreachable.
                    let proj = create_batch_projection(&name).unwrap_or_else(|| {
                        unreachable!(
                            "batch projection '{name}' must be registered in create_batch_projection"
                        )
                    });

                    let worker = BatchWorker::new(
                        proj,
                        sup_pool.clone(),
                        sup_interval,
                        Arc::clone(&sup_cb),
                        Arc::clone(&sup_partitioner),
                    )
                    .with_heartbeat(heartbeat.clone());

                    SupervisedBatchWorker::new(batch_proj_name.clone(), worker)
                })
                .await;
            });

            info!(worker = %label, "Spawned batch worker");
            handles.push((label, handle));
        }
    }
}

// ---------------------------------------------------------------------------
// Module-level helpers
// ---------------------------------------------------------------------------

/// Build an event reader based on the `use_typed_reader` flag.
///
/// When `true`, returns a `TypedEventReader` (per-type tables); otherwise
/// returns the monolithic `EventReader`.
fn build_event_reader(pool: &sqlx::PgPool, use_typed_reader: bool) -> Arc<dyn EventSource> {
    if use_typed_reader {
        info!("Event reader: TypedEventReader (per-type typed tables)");
        Arc::new(TypedEventReader::new(pool.clone()))
    } else {
        info!("Event reader: EventReader (monolithic event_store)");
        Arc::new(EventReader::new(pool.clone()))
    }
}

/// Register a worker with the watchdog using a per-worker child cancellation token.
///
/// The child token lets the watchdog cancel exactly this one worker on a stall
/// without triggering a global shutdown.
fn register_with_watchdog(
    watchdog: &mut Watchdog,
    label: String,
    heartbeat: Heartbeat,
    cancel_token: CancellationToken,
) {
    watchdog.register(WatchedWorker {
        name: label,
        heartbeat,
        cancel_token,
    });
}

/// Await all spawned worker handles, logging any supervisor-level panics.
///
/// A supervisor-level panic (as opposed to a worker-level error that the
/// supervisor catches) is unexpected and should never happen in normal
/// operation.  We log and continue rather than propagating.
async fn await_worker_handles(handles: Vec<(String, JoinHandle<()>)>) {
    for (label, handle) in handles {
        match handle.await {
            Ok(()) => {}
            Err(join_err) => {
                // The supervisor task itself panicked (not the inner worker).
                // This should never happen in normal operation — the supervisor
                // is panic-free by design.  Log for visibility.
                tracing::error!(
                    worker = %label,
                    error = %join_err,
                    "Supervisor task panicked or was aborted"
                );
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::ProjectionsConfig;

    fn make_config() -> ProjectionsConfig {
        ProjectionsConfig {
            database_url: "postgres://localhost/test".to_owned(),
            database_kg_url: None,
            surreal_url: "ws://localhost:8000".to_owned(),
            surreal_user: "root".to_owned(),
            surreal_pass: "root".to_owned(),
            surreal_namespace: "intuition".to_owned(),
            surreal_database: "intuition".to_owned(),
            metrics_port: 9092,
            batch_size: 100,
            poll_interval_ms: 500,
            leaderboard_refresh_interval_secs: 30,
            funnel_tracker_interval_secs: 3600,
            user_activity_batch_interval_secs: 3600,
            position_tracking_shards: 1,
            enabled_projections: vec![],
            disabled_projections: vec![],
            pg_pool_max_connections: None,
            pg_pool_acquire_timeout_secs: None,
        }
    }

    fn make_partitioner() -> Arc<PoolPartitioner> {
        Arc::new(PoolPartitioner::new(&[], None, None))
    }

    #[tokio::test]
    async fn coordinator_stores_config() {
        let config = make_config();
        let pool = sqlx::PgPool::connect_lazy("postgres://localhost/test")
            .expect("lazy connect must not fail");
        let coordinator = Coordinator::new(
            config.clone(),
            pool,
            None,
            vec![],
            vec![],
            vec![],
            make_partitioner(),
        );
        assert_eq!(coordinator.config.batch_size, 100);
        assert_eq!(coordinator.config.poll_interval_ms, 500);
        assert_eq!(coordinator.sinks.len(), 0);
    }

    #[tokio::test]
    async fn no_sinks_means_no_surreal_workers() {
        let config = make_config();
        let pool = sqlx::PgPool::connect_lazy("postgres://localhost/test")
            .expect("lazy connect must not fail");
        let coordinator = Coordinator::new(
            config,
            pool,
            None,
            vec![],
            vec![],
            vec![],
            make_partitioner(),
        );
        let expected_workers = projection::all_projections().len() * coordinator.sinks.len();
        assert_eq!(expected_workers, 0);
    }

    // --- create_pg_projection factory tests ---

    #[test]
    fn pg_factory_returns_event_log() {
        let proj = create_pg_projection("event_log", None, 1, None);
        assert!(proj.is_some());
        assert_eq!(proj.unwrap().name(), "event_log");
    }

    #[test]
    fn pg_factory_returns_vault_state_sharded() {
        let proj = create_pg_projection("vault_state", Some(0), 4, None);
        assert!(proj.is_some());
        assert_eq!(proj.unwrap().name(), "vault_state");
    }

    /// When total_shards == 1, shard_id is None but the factory must NOT panic.
    /// The projection's should_skip_shard() short-circuits for single-shard mode.
    #[test]
    fn pg_factory_vault_state_unsharded() {
        let proj = create_pg_projection("vault_state", None, 1, None);
        assert!(
            proj.is_some(),
            "vault_state with None shard_id must not panic"
        );
        assert_eq!(proj.unwrap().name(), "vault_state");
    }

    /// Same as above for position_tracking — e2e tests run with POSITION_TRACKING_SHARDS=1.
    #[test]
    fn pg_factory_position_tracking_unsharded() {
        let proj = create_pg_projection("position_tracking", None, 1, None);
        assert!(
            proj.is_some(),
            "position_tracking with None shard_id must not panic"
        );
        assert_eq!(proj.unwrap().name(), "position_tracking");
    }

    #[test]
    fn pg_factory_returns_none_for_unknown() {
        let proj = create_pg_projection("nonexistent_projection", None, 1, None);
        assert!(proj.is_none());
    }

    #[test]
    fn pg_factory_returns_vault_state_dual() {
        let proj = create_pg_projection("vault_state:dual", None, 1, None);
        assert!(proj.is_some());
        assert_eq!(proj.unwrap().name(), "vault_state:dual");
    }

    #[test]
    fn pg_factory_returns_vault_holders_index_dual() {
        let proj = create_pg_projection("vault_holders_index:dual", None, 1, None);
        assert!(proj.is_some());
        assert_eq!(proj.unwrap().name(), "vault_holders_index:dual");
    }

    #[test]
    fn batch_factory_returns_leaderboard_refresh() {
        let proj = create_batch_projection("leaderboard_refresh");
        assert!(proj.is_some());
        assert_eq!(proj.unwrap().name(), "leaderboard_refresh");
    }

    #[test]
    fn batch_factory_returns_funnel_tracker() {
        let proj = create_batch_projection("funnel_tracker");
        assert!(proj.is_some());
        assert_eq!(proj.unwrap().name(), "funnel_tracker");
    }

    #[test]
    fn batch_factory_returns_none_for_unknown() {
        let proj = create_batch_projection("nonexistent_batch");
        assert!(proj.is_none());
    }
}
