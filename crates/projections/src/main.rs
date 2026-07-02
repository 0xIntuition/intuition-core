mod config;
mod coordinator;
mod error;
mod event;
mod metrics;
mod projection;
mod repo;
mod resilience;
mod shard;
mod sink;
mod util;
mod worker;

use std::future::Future;
use std::sync::Arc;

use futures::FutureExt;
use sqlx::PgPool;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing::info;

use config::ProjectionsConfig;
use coordinator::Coordinator;
use projection::pg::{BatchProjection, PgProjection};
use resilience::connection_manager::{ConnectionTier, PoolPartitioner};
use resilience::retry::WorkerConfig;
use resilience::CircuitBreaker;
use sink::surreal::SurrealSink;
use sink::ProjectionSink;

fn install_rustls_crypto_provider() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
}

/// Initialise the tracing subscriber from the `RUST_LOG` env var, falling
/// back to `info` level when the variable is absent or unparseable.
fn init_tracing() {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info")),
        )
        .init();
}

/// Build a [`PoolPartitioner`] that controls how PostgreSQL connections are
/// distributed across projection workers.
///
/// ## Why this exists
///
/// Without partitioning, all workers share a single flat connection pool.
/// Heavy writers (e.g. `vault_state` doing wide upserts) can starve
/// lightweight projections (e.g. `event_log` doing point inserts). The
/// partitioner solves this by:
///
/// 1. **Auto-sizing the pool** — `3 × num_active_projections + 5 overhead`
///    instead of a hardcoded `max_connections(20)`.  Override with
///    `PG_POOL_MAX_CONNECTIONS` env var if needed.
///
/// 2. **Giving each projection a semaphore budget** — a cap on how many
///    concurrent connections it can hold.  Workers call
///    `partitioner.acquire("vault_state")` before every DB operation and
///    hold the permit for the duration of the query.
///
/// Tier budgets:
/// - Critical (vault_state, position_tracking, core_entities): 4 permits
/// - Standard (event_log, account_registry, etc.): 2 permits
/// - Batch (leaderboard_refresh): 2 permits
fn build_pool_partitioner(config: &ProjectionsConfig) -> Arc<PoolPartitioner> {
    let specs: &[(&str, ConnectionTier)] = &[
        ("vault_state", ConnectionTier::Critical),
        ("position_tracking", ConnectionTier::Critical),
        ("core_entities", ConnectionTier::Critical),
        ("event_log", ConnectionTier::Standard),
        ("account_registry", ConnectionTier::Standard),
        ("vault_holders_index", ConnectionTier::Standard),
        ("vault_state:dual", ConnectionTier::Critical),
        ("vault_holders_index:dual", ConnectionTier::Standard),
        ("signals_analytics", ConnectionTier::Standard),
        ("term_aggregates", ConnectionTier::Standard),
        ("protocol_stats", ConnectionTier::Standard),
        ("activity_marker", ConnectionTier::Standard),
        ("leaderboard_marker", ConnectionTier::Standard),
        ("leaderboard_refresh", ConnectionTier::Batch),
        ("funnel_tracker", ConnectionTier::Batch),
        ("user_activity_batch", ConnectionTier::Batch),
    ];

    let active: Vec<(String, ConnectionTier)> = specs
        .iter()
        .filter(|(name, _)| config.is_projection_enabled(name))
        .map(|(name, tier)| ((*name).to_owned(), *tier))
        .collect();

    Arc::new(PoolPartitioner::new(
        &active,
        config.pg_pool_max_connections,
        config.pg_pool_acquire_timeout_secs,
    ))
}

/// Create and connect the shared PostgreSQL connection pool.
///
/// The pool ceiling is derived from `partitioner.total_pool_size()` so the
/// pool is sized to exactly match the sum of all per-projection semaphore
/// budgets plus overhead.
async fn connect_postgres(
    config: &ProjectionsConfig,
    partitioner: &PoolPartitioner,
) -> anyhow::Result<PgPool> {
    let pool_size = partitioner.total_pool_size();
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(pool_size)
        .connect(&config.database_url)
        .await?;
    info!(max_connections = pool_size, "Connected to PostgreSQL");
    Ok(pool)
}

/// Connect to SurrealDB if any SurrealDB-dependent projection is enabled.
///
/// Returns `Some(sink)` when connected, `None` when no SurrealDB projections
/// are active.  Retries up to 10 times with a 3-second delay between attempts
/// so that a briefly unavailable SurrealDB does not prevent startup.
async fn connect_surreal_if_needed(
    config: &ProjectionsConfig,
) -> anyhow::Result<Option<Arc<dyn ProjectionSink>>> {
    const SURREAL_PROJECTIONS: &[&str] = &[
        "atom",
        "triple",
        "deposit",
        "redeem",
        "price",
        "fee",
        "core_entities",
    ];

    let needs_surreal = SURREAL_PROJECTIONS
        .iter()
        .any(|name| config.is_projection_enabled(name));

    if !needs_surreal {
        info!("No SurrealDB projections enabled — skipping SurrealDB connection");
        return Ok(None);
    }

    // SurrealDB has been retired in greenfield environments (staging, prod).
    // When SURREAL_DB_URL is empty, return a no-op sink so Surreal-dependent
    // projections (atom/triple/deposit/redeem/price/fee/core_entities) keep
    // running their canonical PostgreSQL writes (`kg.nodes`, `intuition.*`)
    // without panicking on the `expect("SurrealDB must be connected")` path
    // in `spawn_core_entities_worker`. Dev still has SURREAL_DB_URL populated
    // and continues to write to its existing SurrealDB instance unchanged.
    // Full retirement tracked as an internal follow-up.
    if config.surreal_url.trim().is_empty() {
        info!(
            sink = "noop",
            surreal_url_configured = false,
            "SurrealDB sink replaced with NoopSink — \
             Surreal-dependent projections will write only to PostgreSQL"
        );
        return Ok(Some(Arc::new(sink::NoopSink)));
    }

    let max_attempts = 10;
    let mut attempt = 0;
    let sink = loop {
        attempt += 1;
        match SurrealSink::new(
            &config.surreal_url,
            &config.surreal_user,
            &config.surreal_pass,
            &config.surreal_namespace,
            &config.surreal_database,
        )
        .await
        {
            Ok(s) => break s,
            Err(e) => {
                if attempt >= max_attempts {
                    return Err(anyhow::anyhow!(
                        "Failed to connect to SurrealDB after {max_attempts} attempts: {e}"
                    ));
                }
                tracing::warn!(
                    attempt,
                    max_attempts,
                    error = %e,
                    "SurrealDB not ready, retrying in 3s..."
                );
                tokio::time::sleep(tokio::time::Duration::from_secs(3)).await;
            }
        }
    };

    info!("Connected to SurrealDB");
    Ok(Some(Arc::new(sink) as Arc<dyn ProjectionSink>))
}

/// Log which projection filter (if any) is active.
fn log_projection_filter(config: &ProjectionsConfig) {
    if !config.enabled_projections.is_empty() {
        info!(
            projections = ?config.enabled_projections,
            "ENABLED_PROJECTIONS set — only these projections will run"
        );
    } else if !config.disabled_projections.is_empty() {
        info!(
            projections = ?config.disabled_projections,
            "DISABLED_PROJECTIONS set — these projections will be skipped"
        );
    }
}

/// Instantiate all enabled PG-direct projections (Phases 1, 3, 4, 5, 6 marker).
fn build_pg_projections(
    config: &ProjectionsConfig,
    kg_pool: Option<&PgPool>,
) -> Vec<Box<dyn PgProjection>> {
    let mut pg_projections: Vec<Box<dyn PgProjection>> = vec![];

    // Phase 1
    if config.is_projection_enabled("event_log") {
        pg_projections.push(Box::new(projection::event_log::EventLogProjection));
    }
    if config.is_projection_enabled("account_registry") {
        pg_projections.push(Box::new(
            projection::account_registry::AccountRegistryProjection,
        ));
    }
    // Phase 4
    if config.is_projection_enabled("vault_holders_index") {
        pg_projections.push(Box::new(
            projection::vault_holders_index::VaultHoldersIndexProjection,
        ));
    }
    if config.is_projection_enabled("signals_analytics") {
        pg_projections.push(Box::new(
            projection::signals_analytics::SignalsAnalyticsProjection,
        ));
    }
    // Phase 5
    if config.is_projection_enabled("term_aggregates") {
        pg_projections.push(Box::new(
            projection::term_aggregates::TermAggregatesProjection,
        ));
    }
    if config.is_projection_enabled("protocol_stats") {
        pg_projections.push(Box::new(
            projection::protocol_stats::ProtocolStatsProjection,
        ));
    }
    // Phase 6 (event-driven markers)
    if config.is_projection_enabled("activity_marker") {
        pg_projections.push(Box::new(
            projection::activity_marker::ActivityMarkerProjection,
        ));
    }
    if config.is_projection_enabled("leaderboard_marker") {
        pg_projections.push(Box::new(
            projection::leaderboard_marker::LeaderboardMarkerProjection,
        ));
    }

    // Phase 3 — sharded vault_state + position_tracking workers.
    // Both use the same shard count and hash(term_id, curve_id) key so each
    // vault row is owned by exactly one shard, eliminating cross-worker deadlocks.
    let vault_shards = config.position_tracking_shards;
    if config.is_projection_enabled("vault_state")
        || config.is_projection_enabled("position_tracking")
    {
        info!(
            shards = vault_shards,
            "Spawning sharded vault_state + position_tracking workers"
        );
    }
    for shard_id in 0..vault_shards {
        if config.is_projection_enabled("vault_state") {
            pg_projections.push(Box::new(
                projection::vault_state::VaultStateProjection::new(shard_id, vault_shards),
            ));
        }
        if config.is_projection_enabled("position_tracking") {
            pg_projections.push(Box::new(
                projection::position_tracking::PositionTrackingProjection::new(
                    shard_id,
                    vault_shards,
                ),
            ));
        }
    }

    // Dual projectors — vault_state:dual and vault_holders_index:dual.
    // Each dual projector manages its own kg_pool internally via with_kg_pool().
    // The PgWorker passes the legacy pool; kg writes happen inside process_parsed_batch.
    // Sharding for vault_state:dual mirrors vault_state (same shard count, same hash key).
    if config.is_projection_enabled("vault_state:dual") {
        if let Some(kp) = kg_pool {
            info!(
                shards = vault_shards,
                "Spawning sharded vault_state:dual workers"
            );
            for shard_id in 0..vault_shards {
                pg_projections.push(Box::new(
                    projection::dual::vault_state::VaultStateDualProjection::new(
                        shard_id,
                        vault_shards,
                    )
                    .with_kg_pool(kp.clone()),
                ));
            }
        } else {
            info!(
                "vault_state:dual enabled but DATABASE_KG_URL not set — spawning without kg writes"
            );
            for shard_id in 0..vault_shards {
                pg_projections.push(Box::new(
                    projection::dual::vault_state::VaultStateDualProjection::new(
                        shard_id,
                        vault_shards,
                    ),
                ));
            }
        }
    }

    if config.is_projection_enabled("vault_holders_index:dual") {
        let mut proj =
            projection::dual::vault_holders_index::VaultHoldersIndexDualProjection::new();
        if let Some(kp) = kg_pool {
            proj = proj.with_kg_pool(kp.clone());
        } else {
            info!("vault_holders_index:dual enabled but DATABASE_KG_URL not set — spawning without kg writes");
        }
        pg_projections.push(Box::new(proj));
    }

    pg_projections
}

/// Instantiate all enabled batch projections (Phase 6 refresh + funnel tracker + user activity).
fn build_batch_projections(config: &ProjectionsConfig) -> Vec<Box<dyn BatchProjection>> {
    let mut batch_projections: Vec<Box<dyn BatchProjection>> = vec![];
    if config.is_projection_enabled("leaderboard_refresh") {
        batch_projections.push(Box::new(
            projection::leaderboard_refresh::LeaderboardRefreshProjection,
        ));
    }
    if config.is_projection_enabled("funnel_tracker") {
        batch_projections.push(Box::new(
            projection::funnel_tracker::FunnelTrackerProjection,
        ));
    }
    if config.is_projection_enabled("user_activity_batch") {
        batch_projections.push(Box::new(
            projection::user_activity_batch::UserActivityBatchProjection,
        ));
    }
    batch_projections
}

/// Read the `USE_TYPED_READER` environment variable once at startup.
///
/// When `true` (or `1`), workers use [`event::TypedEventReader`] (per-type
/// typed tables); otherwise they use the monolithic [`event::EventReader`].
/// Computed once here so both the `Coordinator` and the standalone
/// `CoreEntitiesWorker` use the identical value.
fn is_typed_reader_enabled() -> bool {
    matches!(
        std::env::var("USE_TYPED_READER").as_deref(),
        Ok("true") | Ok("1")
    )
}

/// Spawn a non-critical background task with panic detection.
///
/// Unlike a bare `tokio::spawn`, this wrapper catches any panic that occurs
/// inside `fut` and logs it as an error rather than silently discarding the
/// task or crashing the process. Use this for best-effort background work
/// (metrics, polling) where a panic should be observable in logs but must
/// not bring down the service.
///
/// # Arguments
///
/// * `name` - A static label used in the error log to identify the task.
/// * `fut`  - The future to run. Must be `Send + 'static`.
///
/// # Returns
///
/// The `JoinHandle` for the spawned task. Callers may drop it if they do
/// not need to observe completion.
fn spawn_non_critical<F>(name: &'static str, fut: F) -> JoinHandle<()>
where
    F: Future<Output = ()> + Send + 'static,
{
    tokio::spawn(async move {
        // `AssertUnwindSafe` is required because `catch_unwind` demands that
        // the future implement `UnwindSafe`, which most async futures do not
        // satisfy automatically (they may hold non-unwind-safe state across
        // await points). This is safe here because we only log the panic
        // payload and never inspect or reuse the potentially-broken state.
        let result = std::panic::AssertUnwindSafe(fut).catch_unwind().await;
        if let Err(payload) = result {
            tracing::error!(task = name, panic_payload = ?payload, "Non-critical task panicked");
        }
    })
}

/// Spawn the Prometheus metrics HTTP server as a non-critical background task.
fn spawn_metrics_server(metrics_port: u16) {
    spawn_non_critical("metrics_server", async move {
        if let Err(e) = metrics::start_metrics_server(metrics_port).await {
            tracing::error!("Metrics server failed: {e}");
        }
    });
}

/// Spawn a background task that keeps the global `head_sequence` gauge current.
///
/// Polls `MAX(sequence_number)` from the canonical event store every 10 s so
/// that per-projection lag and `sync_progress_percent` stay accurate.
fn spawn_head_sequence_poller(pool: PgPool) {
    spawn_non_critical("head_sequence_poller", async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(10));
        // The first tick fires immediately; subsequent ones wait the full period.
        loop {
            interval.tick().await;
            // Use the non-macro form so no live DATABASE_URL is needed at
            // compile time.  The query returns a single nullable i64.
            let result: Result<Option<i64>, _> = sqlx::query_scalar(
                "SELECT COALESCE(MAX(sequence_number), 0) \
                 FROM event_store WHERE is_canonical = true",
            )
            .fetch_optional(&pool)
            .await
            // fetch_optional returns Option<Option<i64>> — flatten to Option<i64>.
            .map(|opt| opt.flatten());

            match result {
                Ok(Some(max_seq)) => metrics::set_head_sequence(max_seq),
                Ok(None) => {}
                Err(e) => tracing::error!("head_sequence poll failed: {e}"),
            }
        }
    });
}

/// Spawn a background task that listens for SIGTERM / SIGINT and cancels `token`.
fn spawn_shutdown_handler(token: CancellationToken) {
    tokio::spawn(async move {
        let ctrl_c = tokio::signal::ctrl_c();
        #[cfg(unix)]
        {
            let mut sigterm =
                tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
                    .expect("failed to register SIGTERM handler");
            tokio::select! {
                _ = ctrl_c => {}
                _ = sigterm.recv() => {}
            }
        }
        #[cfg(not(unix))]
        {
            ctrl_c.await.ok();
        }
        info!("Shutdown signal received, cancelling workers...");
        token.cancel();
    });
}

/// Connect to the KG database when `DATABASE_KG_URL` is configured.
///
/// Returns `Some(pool)` when the URL is present and the connection succeeds,
/// `None` when `DATABASE_KG_URL` is absent.  On connection failure the error
/// is logged and propagated — misconfigured URLs should fail fast at startup.
async fn connect_kg_if_configured(config: &ProjectionsConfig) -> anyhow::Result<Option<PgPool>> {
    let Some(kg_url) = config.database_kg_url.as_deref() else {
        info!("DATABASE_KG_URL not set — kg.nodes writes are disabled");
        return Ok(None);
    };

    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(5)
        .connect(kg_url)
        .await
        .map_err(|e| anyhow::anyhow!("Failed to connect to DATABASE_KG_URL: {e}"))?;

    info!("Connected to KG database (kg.nodes writes enabled)");
    Ok(Some(pool))
}

/// Spawn the core_entities triple-write supervisor (if enabled).
///
/// Returns the join handle of the spawned supervisor task, or `None` when
/// `core_entities` is disabled.  The caller races this handle in `main`'s
/// `tokio::select!` loop so a panic here forces a clean process exit.
#[allow(clippy::too_many_arguments)]
fn spawn_core_entities_worker(
    config: &ProjectionsConfig,
    pool: &PgPool,
    kg_pool: Option<PgPool>,
    surreal_sink: &Option<Arc<dyn ProjectionSink>>,
    token: &CancellationToken,
    surreal_cb: &Arc<CircuitBreaker>,
    pg_cb: &Arc<CircuitBreaker>,
    partitioner: &Arc<PoolPartitioner>,
    use_typed_reader: bool,
) -> Option<JoinHandle<()>> {
    if !config.is_projection_enabled("core_entities") {
        info!("CoreEntitiesWorker disabled by projection filter");
        return None;
    }

    let surreal_sink = surreal_sink
        .as_ref()
        .expect("SurrealDB must be connected when core_entities is enabled");

    // Snapshot all constructor arguments so the factory closure can
    // re-create a fresh CoreEntitiesWorker on every supervisor restart.
    let ce_surreal_sink = Arc::clone(surreal_sink);
    let ce_pool = pool.clone();
    let ce_kg_pool = kg_pool;
    let ce_checkpoint = Arc::new(resilience::CheckpointStore::new(pool.clone()));

    // Reuse the single use_typed_reader flag so both the Coordinator and
    // this standalone worker read from the same source.
    let ce_reader: Arc<dyn event::EventSource> = if use_typed_reader {
        info!("CoreEntitiesWorker event reader: TypedEventReader");
        Arc::new(event::TypedEventReader::new(pool.clone()))
    } else {
        info!("CoreEntitiesWorker event reader: EventReader");
        Arc::new(event::EventReader::new(pool.clone()))
    };

    let ce_config = WorkerConfig::new(config.batch_size, config.poll_interval_ms);
    let ce_surreal_cb = Arc::clone(surreal_cb);
    let ce_pg_cb = Arc::clone(pg_cb);
    let ce_partitioner = Arc::clone(partitioner);
    let ce_sup = resilience::Supervisor::new("core_entities:dual", token.clone());

    Some(tokio::spawn(async move {
        ce_sup
            .run(move || {
                // Reconstruct a fresh CoreEntitiesProjection + worker on every
                // supervisor restart.  All captured values are either `Clone`
                // (`Arc`, `PgPool`) or cheaply re-creatable.
                let mut core_entities = projection::core_entities::CoreEntitiesProjection::new(
                    Arc::clone(&ce_surreal_sink),
                    ce_pool.clone(),
                );
                // Attach the KG pool when configured.  Cloning PgPool is cheap
                // (it is an Arc-wrapped connection pool handle).
                if let Some(ref kp) = ce_kg_pool {
                    core_entities = core_entities.with_kg_pool(kp.clone());
                }
                // Attach a heartbeat so the watchdog can observe liveness.
                let ce_heartbeat = resilience::Heartbeat::new();
                let worker = worker::CoreEntitiesWorker::new(
                    core_entities,
                    Arc::clone(&ce_checkpoint),
                    Arc::clone(&ce_reader),
                    Arc::clone(&ce_surreal_cb),
                    Arc::clone(&ce_pg_cb),
                    Arc::clone(&ce_partitioner),
                    ce_config,
                )
                .with_heartbeat(ce_heartbeat);
                resilience::supervised_adapters::SupervisedCoreEntitiesWorker::new(worker)
            })
            .await;
    }))
}

/// Entry point for the projections service.
///
/// # Architecture
///
/// The service transforms raw blockchain events into queryable read models.
/// It is built from these layers:
///
/// **Workers** — poll loops that read events from PostgreSQL, transform them
/// through a projection, and write derived state to a database.  Four types:
///   - `Worker` (SurrealDB) — writes graph operations via SinkOperation
///   - `PgWorker` — writes directly to PostgreSQL via sqlx
///   - `BatchWorker` — timer-driven (e.g. leaderboard refresh every 30s)
///   - `CoreEntitiesWorker` — dual-writes to both SurrealDB and PostgreSQL
///
/// **Supervisor** — wraps each worker spawn with automatic restart.  If a
/// worker panics or exits unexpectedly, the supervisor re-creates it from a
/// factory closure and restarts with exponential backoff (1s → 30s cap).
/// After 5 minutes of healthy operation, backoff resets to minimum.
///
/// **Watchdog** — a background task that checks worker heartbeats every 10s.
/// Each worker updates an atomic timestamp after every successful batch.
/// If a worker hasn't beaten in 120s (e.g. stuck on a hung DB query), the
/// watchdog cancels its token, the supervisor detects the exit, and restarts.
///
/// **Circuit Breaker** — protects databases from being hammered during
/// outages.  Two shared instances (one for PG, one for SurrealDB).  After
/// 5 consecutive failures the circuit opens and workers skip DB calls until
/// a probe succeeds.  State: CLOSED → OPEN → HALF-OPEN → CLOSED.
///
/// **Pool Partitioner** — distributes PG connections fairly across workers
/// using per-projection semaphores, preventing heavy writers from starving
/// lightweight projections.
///
/// **Coordinator** — the top-level orchestrator that wires everything together:
/// creates the watchdog, spawns each worker inside a supervisor, and waits
/// for shutdown.
#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let _ = dotenvy::dotenv();

    install_rustls_crypto_provider();
    init_tracing();

    info!("Projections service starting");

    // ── Configuration ────────────────────────────────────────────────────

    let config = ProjectionsConfig::from_env()?;

    // ── Database connections ─────────────────────────────────────────────

    // The partitioner controls how PG connections are distributed across
    // workers.  It must be created BEFORE the pool because the pool's
    // max_connections ceiling is derived from the number of active projections.
    // See `build_pool_partitioner` for the sizing formula and tier budgets.
    let partitioner = build_pool_partitioner(&config);
    let pool = connect_postgres(&config, &partitioner).await?;
    let kg_pool = connect_kg_if_configured(&config).await?;
    let surreal_sink = connect_surreal_if_needed(&config).await?;
    let sinks: Vec<Arc<dyn ProjectionSink>> = surreal_sink.iter().cloned().collect();

    // ── Projection registration ──────────────────────────────────────────

    log_projection_filter(&config);

    let pg_projections = build_pg_projections(&config, kg_pool.as_ref());
    let batch_projections = build_batch_projections(&config);
    let use_typed_reader = is_typed_reader_enabled();

    // ── Shutdown & background infrastructure ─────────────────────────────

    // Global shutdown signal.  Cloned into every worker, supervisor, and the
    // watchdog.  When SIGTERM/SIGINT fires, the shutdown handler cancels this
    // token, which propagates to all child tokens and causes every worker's
    // `sleep_or_cancel` / `tokio::select!` to wake and exit cleanly.
    let token = CancellationToken::new();

    // Non-critical background tasks: panics are logged but do not crash the
    // process (see `spawn_non_critical`).
    spawn_metrics_server(config.metrics_port);
    spawn_head_sequence_poller(pool.clone());

    // The shutdown handler must NOT use spawn_non_critical — it is the
    // mechanism that cancels `token` on SIGTERM/SIGINT. A panic here would
    // prevent graceful shutdown, so we let it propagate naturally.
    spawn_shutdown_handler(token.clone());

    // ── Resilience layer ─────────────────────────────────────────────────

    // Two shared circuit breakers — one per database family.  All workers
    // targeting the same database share the same breaker so a single outage
    // trips all of them simultaneously rather than each discovering it
    // independently after 5 failures.
    let surreal_cb = Arc::new(CircuitBreaker::with_defaults("surrealdb"));
    let pg_cb = Arc::new(CircuitBreaker::with_defaults("postgres"));

    // ── Worker spawning ──────────────────────────────────────────────────

    // CoreEntitiesWorker is spawned separately (not through the coordinator)
    // because it dual-writes to both databases and needs both circuit breakers.
    // Clone kg_pool before moving it into the core-entities worker so the
    // coordinator can also carry a reference for dual PG projections.
    let coordinator_kg_pool = kg_pool.clone();
    let ce_handle = spawn_core_entities_worker(
        &config,
        &pool,
        kg_pool,
        &surreal_sink,
        &token,
        &surreal_cb,
        &pg_cb,
        &partitioner,
        use_typed_reader,
    );

    // The coordinator spawns all other workers (SurrealDB, PG, batch), each
    // wrapped in a supervisor for automatic restart.  It also starts the
    // watchdog and blocks until all workers exit (i.e. until shutdown).
    //
    // We spawn it as a task rather than awaiting directly so we can race it
    // against the cancellation token and the core-entities handle below.
    // `token` is moved into the coordinator; `shutdown_watch` is a sibling
    // clone that lets the select! branch observe cancellation independently.
    let coordinator = Coordinator::new(
        config,
        pool,
        coordinator_kg_pool,
        sinks,
        pg_projections,
        batch_projections,
        partitioner,
    );
    let shutdown_watch = token.clone();
    let coordinator_handle = tokio::spawn(async move {
        coordinator
            .run(token, surreal_cb, pg_cb, use_typed_reader)
            .await;
    });

    // ── Critical-task monitor ─────────────────────────────────────────────
    //
    // The process lifetime is determined by the critical tasks:
    //
    //   1. `coordinator_handle`          — coordinator (always present).
    //   2. `ce_handle` (if present)      — core-entities worker.
    //
    // Both are critical: the process must wait for *every* task to finish
    // before exiting. Using `tokio::select!` here would race the futures
    // and short-circuit on the first to complete, which causes the process
    // to exit as soon as one task finishes — even if the other is still
    // healthy. That bug surfaced when `ENABLED_PROJECTIONS=["core_entities"]`:
    // the coordinator owns zero workers in that mode and exits immediately,
    // taking down the still-starting core-entities worker with it.
    //
    // Instead we `join` both handles. Shutdown still works because both
    // tasks observe `token.cancelled()` independently (the shutdown handler
    // cancels `token` on SIGTERM/SIGINT) and drain on their own. We spawn
    // a tiny logger task purely to emit the "shutdown received" line; it
    // is detached and not gated on.
    //
    // A `JoinError` from either handle means the Tokio task *panicked* — the
    // only way a spawned task produces `Err`. We log it and call
    // `std::process::exit(1)` so the outer process supervisor (systemd, k8s)
    // can restart the service rather than leaving a zombie that stopped
    // indexing silently.

    let shutdown_logger_task = tokio::spawn(async move {
        shutdown_watch.cancelled().await;
        info!("Shutdown signal received — workers are draining");
    });

    if let Some(ce) = ce_handle {
        let (coord_result, ce_result) = tokio::join!(coordinator_handle, ce);

        match coord_result {
            Ok(()) => info!("Coordinator exited cleanly"),
            Err(e) => {
                tracing::error!(error = %e, "Coordinator task panicked — forcing shutdown");
                std::process::exit(1);
            }
        }
        match ce_result {
            Ok(()) => info!("CoreEntitiesWorker supervisor exited cleanly"),
            Err(e) => {
                tracing::error!(
                    error = %e,
                    "CoreEntitiesWorker task panicked — forcing shutdown"
                );
                std::process::exit(1);
            }
        }
    } else {
        // core_entities is disabled — only the coordinator gates lifetime.
        match coordinator_handle.await {
            Ok(()) => info!("Coordinator exited cleanly"),
            Err(e) => {
                tracing::error!(error = %e, "Coordinator task panicked — forcing shutdown");
                std::process::exit(1);
            }
        }
    }

    // Shutdown logger may still be waiting for cancellation if the process
    // is exiting on its own (no signal).  Abort it so the runtime can drop.
    shutdown_logger_task.abort();

    info!("Projections service stopped");
    Ok(())
}
