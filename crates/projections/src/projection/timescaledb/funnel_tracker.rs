//! Funnel tracker batch projection.
//!
//! Timer-driven projection that recomputes funnel step completions across all
//! seeded funnels and upserts results into `funnel_event`.
//!
//! ## Design
//!
//! Each cycle runs four dedicated SQL queries — one per seeded funnel — rather
//! than a generic funnel engine. This keeps the queries simple, auditable, and
//! correctly typed against the real event-table schemas.
//!
//! All writes use `ON CONFLICT … DO NOTHING` so cycles are fully idempotent.
//! If the process crashes mid-cycle, the next cycle will reprocess from scratch
//! and produce the same result.
//!
//! ## Metrics
//!
//! - `funnel_tracker_duration_seconds` — histogram of full-cycle wall time
//! - `funnel_tracker_cycles_total` — counter of completed cycles

use std::time::Instant;

use async_trait::async_trait;
use sqlx::PgPool;
use tracing::info;

use crate::error::ProjectionError;
use crate::metrics as proj_metrics;
use crate::projection::pg::BatchProjection;
use crate::repo::funnel_repo::{
    compute_activation_funnel, compute_creator_funnel, compute_cross_feature_funnel,
    compute_onboarding_funnel, fetch_funnel_ids,
};

// ---------------------------------------------------------------------------
// Projection struct
// ---------------------------------------------------------------------------

/// Timer-driven projection that recomputes all funnel step completions.
pub struct FunnelTrackerProjection;

// ---------------------------------------------------------------------------
// BatchProjection impl
// ---------------------------------------------------------------------------

#[async_trait]
impl BatchProjection for FunnelTrackerProjection {
    fn name(&self) -> &str {
        "funnel_tracker"
    }

    /// Execute one full funnel recomputation cycle.
    ///
    /// M13: Pre-fetches all four funnel UUIDs at cycle start and returns a
    /// clear error if any are missing, preventing silent NULL inserts.
    ///
    /// M12: Each funnel's two-step computation runs inside its own transaction
    /// so that a failure in one funnel does not roll back another's work.
    ///
    /// H10: Removed the `load_funnel_definitions` call that was only used for
    /// a debug log, avoiding an unnecessary DB round-trip every cycle.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::Database` on any SQL error. The `BatchWorker`
    /// will retry transient failures with exponential back-off.
    async fn run_cycle(&self, pool: &PgPool) -> Result<(), ProjectionError> {
        let cycle_start = Instant::now();

        // M13: fetch all four funnel UUIDs up front and fail fast if any are
        // missing — a NULL funnel_id would silently corrupt funnel_event rows.
        let ids = fetch_funnel_ids(pool).await?;

        info!(funnel_count = 4, "Funnel tracker cycle starting");

        // M12: each funnel runs in its own transaction so a failure in one
        // does not roll back another's committed work.
        {
            let mut tx = pool.begin().await?;
            compute_onboarding_funnel(&mut tx, ids.onboarding).await?;
            tx.commit().await?;
        }
        {
            let mut tx = pool.begin().await?;
            compute_activation_funnel(&mut tx, ids.activation).await?;
            tx.commit().await?;
        }
        {
            let mut tx = pool.begin().await?;
            compute_creator_funnel(&mut tx, ids.creator).await?;
            tx.commit().await?;
        }
        {
            let mut tx = pool.begin().await?;
            compute_cross_feature_funnel(&mut tx, ids.cross_feature).await?;
            tx.commit().await?;
        }

        let elapsed = cycle_start.elapsed().as_secs_f64();

        // Use the centralized Metrics singleton rather than a private OnceLock.
        let m = proj_metrics::metrics();
        m.funnel_tracker_duration_seconds.observe(elapsed);
        // H9: increment cycles counter (renamed from events_processed_total).
        m.funnel_tracker_cycles_total.inc();

        info!(duration_secs = elapsed, "Funnel tracker cycle completed");

        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_is_funnel_tracker() {
        assert_eq!(FunnelTrackerProjection.name(), "funnel_tracker");
    }
}
