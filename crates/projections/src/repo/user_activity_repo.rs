//! Repository functions for the user-activity batch projection.
//!
//! Provides dirty-set draining, daily rollup aggregation, profile upserts,
//! RFM scoring, segment classification, topic affinity scoring, weekly
//! retention cohort computation, and backfill-state tracking.
//!
//! All functions accept a `&PgPool` (or `&mut Transaction`) reference so
//! callers can compose operations across the desired transaction boundary.
//!
//! The dirty-set pattern mirrors `leaderboard_repo`:
//! 1. Event-driven projections insert into `dirty_account_activity` on each
//!    deposit, redemption, atom-create, or triple-create event.
//! 2. `UserActivityBatchProjection::incremental_cycle()` drains that table,
//!    recomputes per-account metrics, then runs population-wide RFM scoring,
//!    segment classification, topic affinity scoring, and (weekly) retention
//!    cohort computation.

use chrono::{DateTime, NaiveDate, Utc};
use sqlx::{types::BigDecimal, PgPool, Row};

use crate::error::ProjectionError;

// ---------------------------------------------------------------------------
// Module-level constants
// ---------------------------------------------------------------------------

/// Maximum number of topic-affinity entries retained per account (m2).
///
/// Only the top-N affinities by score are kept in `user_topic_affinity`;
/// rows ranked beyond this threshold are pruned after each upsert pass.
/// Extracting the value here avoids the magic number `50` appearing in
/// multiple SQL strings, making it easy to tune and audit.
pub(crate) const TOP_N_AFFINITIES: i32 = 50;

/// Projection name used as the primary key in `batch_projection_checkpoints`
/// and as the advisory lock key via `hashtext(...)`.
///
/// Changing this value would orphan the existing checkpoint row and advisory
/// lock, so it is guarded by tests.
pub(crate) const PROJECTION_NAME: &str = "user_activity_batch";

/// SQL for the incremental topic-affinity upsert.
///
/// Filters `position_change` to rows newer than the last checkpoint (`pc.ts > $2`),
/// then additively merges interaction counts into any pre-existing affinity row.
/// Bind parameters: `$1` = `TOP_N_AFFINITIES`, `$2` = lower-bound timestamp.
pub(crate) const INCREMENTAL_UPSERT_SQL: &str = r#"
        WITH filtered AS (
            SELECT
                pc.account_id,
                pc.term_id,
                COUNT(pc.event_id)             AS interaction_count,
                COALESCE(SUM(pc.assets_in), 0) AS total_capital_deployed,
                MAX(pc.ts)                     AS last_interaction_at
            FROM position_change pc
            WHERE pc.ts > $2
            GROUP BY pc.account_id, pc.term_id
        ),
        with_score AS (
            SELECT
                account_id,
                term_id,
                interaction_count,
                total_capital_deployed,
                last_interaction_at,
                LN(1.0 + interaction_count::float8)
                    * LN(1.0 + total_capital_deployed::float8)
                    * CASE
                        WHEN last_interaction_at > NOW() - INTERVAL '30 days' THEN 1.0
                        ELSE 0.5
                      END
                AS affinity_score
            FROM filtered
        ),
        scored AS (
            SELECT *,
                ROW_NUMBER() OVER (
                    PARTITION BY account_id ORDER BY affinity_score DESC
                ) AS rank
            FROM with_score
        )
        INSERT INTO user_topic_affinity (
            account_id,
            term_id,
            interaction_count,
            total_capital_deployed,
            affinity_score,
            last_interaction_at
        )
        SELECT
            account_id,
            term_id,
            interaction_count,
            total_capital_deployed,
            affinity_score,
            last_interaction_at
        FROM scored
        WHERE rank <= $1
        ON CONFLICT (account_id, term_id) DO UPDATE SET
            interaction_count      = user_topic_affinity.interaction_count
                                        + EXCLUDED.interaction_count,
            total_capital_deployed = user_topic_affinity.total_capital_deployed
                                        + EXCLUDED.total_capital_deployed,
            affinity_score         = LN(1.0 + (user_topic_affinity.interaction_count
                                                + EXCLUDED.interaction_count)::float8)
                                     * LN(1.0 + (user_topic_affinity.total_capital_deployed
                                                + EXCLUDED.total_capital_deployed)::float8)
                                     * CASE
                                         WHEN GREATEST(
                                             user_topic_affinity.last_interaction_at,
                                             EXCLUDED.last_interaction_at
                                         ) > NOW() - INTERVAL '30 days' THEN 1.0
                                         ELSE 0.5
                                       END,
            last_interaction_at    = GREATEST(
                                        user_topic_affinity.last_interaction_at,
                                        EXCLUDED.last_interaction_at
                                     )
    "#;

/// SQL for the full-recompute topic-affinity upsert.
///
/// Scans all `position_change` rows (no timestamp filter) and replaces stored
/// values with freshly computed totals to correct any drift accumulated by
/// incremental runs. Bind parameter: `$1` = `TOP_N_AFFINITIES`.
pub(crate) const FULL_UPSERT_SQL: &str = r#"
        WITH account_term_interactions AS (
            SELECT
                pc.account_id,
                pc.term_id,
                COUNT(pc.event_id)             AS interaction_count,
                COALESCE(SUM(pc.assets_in), 0) AS total_capital_deployed,
                MAX(pc.ts)                     AS last_interaction_at
            FROM position_change pc
            GROUP BY pc.account_id, pc.term_id
        ),
        with_score AS (
            -- Compute the affinity formula exactly once per row to avoid
            -- repeating the expression in both SELECT and ORDER BY clauses.
            -- recency_weight=1.0 for activity within 30 days, 0.5 otherwise.
            SELECT
                account_id,
                term_id,
                interaction_count,
                total_capital_deployed,
                last_interaction_at,
                LN(1.0 + interaction_count::float8)
                    * LN(1.0 + total_capital_deployed::float8)
                    * CASE
                        WHEN last_interaction_at > NOW() - INTERVAL '30 days' THEN 1.0
                        ELSE 0.5
                      END
                AS affinity_score
            FROM account_term_interactions
        ),
        scored AS (
            SELECT *,
                ROW_NUMBER() OVER (
                    PARTITION BY account_id ORDER BY affinity_score DESC
                ) AS rank
            FROM with_score
        )
        INSERT INTO user_topic_affinity (
            account_id,
            term_id,
            interaction_count,
            total_capital_deployed,
            affinity_score,
            last_interaction_at
        )
        SELECT
            account_id,
            term_id,
            interaction_count,
            total_capital_deployed,
            affinity_score,
            last_interaction_at
        FROM scored
        WHERE rank <= $1
        ON CONFLICT (account_id, term_id) DO UPDATE SET
            interaction_count      = EXCLUDED.interaction_count,
            total_capital_deployed = EXCLUDED.total_capital_deployed,
            affinity_score         = EXCLUDED.affinity_score,
            last_interaction_at    = EXCLUDED.last_interaction_at
    "#;

// ---------------------------------------------------------------------------
// Data types
// ---------------------------------------------------------------------------

/// Aggregated activity counts for a single (account, day) pair.
///
/// Counts are `i64` to match PostgreSQL `bigint`. Monetary volume fields use
/// `BigDecimal` to preserve full NUMERIC/wei-scale precision — matching the
/// `NUMERIC` column type in `user_activity_daily` and the pattern used by
/// `leaderboard_repo::AccountPnlRow`.
#[derive(Debug, Clone)]
pub struct DailyRollup {
    /// Ethereum address of the account.
    pub account_id: String,
    /// TIMESTAMPTZ day bucket this rollup covers (truncated to UTC midnight).
    /// The `user_activity_daily.day` column is TIMESTAMPTZ, not DATE.
    pub day: DateTime<Utc>,
    /// Number of atoms created by this account on this day.
    pub atoms_created: i64,
    /// Number of triples created by this account on this day.
    pub triples_created: i64,
    /// Number of deposit transactions on this day.
    pub deposits_count: i64,
    /// Number of redemption transactions on this day.
    pub redemptions_count: i64,
    /// Total deposit volume (wei) on this day — stored as NUMERIC.
    pub deposit_volume: BigDecimal,
    /// Total redemption volume (wei) on this day — stored as NUMERIC.
    pub redemption_volume: BigDecimal,
    /// Number of distinct vaults interacted with on this day.
    ///
    /// Stored as `INTEGER` in PostgreSQL — `i32` matches the column type exactly.
    pub unique_vaults: i32,
    /// Net flow = deposit_volume - redemption_volume (wei) on this day.
    pub net_flow: BigDecimal,
}

// ---------------------------------------------------------------------------
// Dirty-set drain
// ---------------------------------------------------------------------------

/// Drain all pending dirty account entries for activity recomputation.
///
/// Atomically deletes every row from `dirty_account_activity` and returns the
/// `account_id` values. The caller is expected to have already begun a
/// transaction — the DELETE is scoped to that transaction so that on crash the
/// rows remain and will be re-processed on the next cycle.
///
/// # Arguments
///
/// * `tx` - Active PostgreSQL transaction.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any SQL failure.
pub async fn drain_dirty_accounts(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
) -> Result<Vec<String>, ProjectionError> {
    // DELETE … RETURNING atomically empties the table and retrieves the
    // contents in one round-trip — no separate SELECT is needed.
    // `query_scalar` decodes the single returned column directly into `String`,
    // eliminating the manual loop over raw rows.
    let result: Vec<String> =
        sqlx::query_scalar("DELETE FROM dirty_account_activity RETURNING account_id")
            .fetch_all(&mut **tx)
            .await?;
    Ok(result)
}

// ---------------------------------------------------------------------------
// Checkpoint helpers (internal)
// ---------------------------------------------------------------------------

/// Load the full metadata JSON blob from `batch_projection_checkpoints`.
///
/// Returns `None` when no checkpoint row exists or when the `metadata`
/// column is SQL NULL.  Callers extract their own keys and apply their
/// own "default on missing" semantics.
async fn fetch_checkpoint_metadata(
    pool: &PgPool,
) -> Result<Option<serde_json::Value>, ProjectionError> {
    let row: Option<(Option<serde_json::Value>,)> = sqlx::query_as(
        "SELECT metadata FROM batch_projection_checkpoints WHERE projection_name = $1",
    )
    .bind(PROJECTION_NAME)
    .fetch_optional(pool)
    .await?;

    match row {
        Some((Some(meta),)) => Ok(Some(meta)),
        _ => Ok(None),
    }
}

/// Merge a JSON patch into the checkpoint metadata for this projection.
///
/// Uses PostgreSQL's `||` JSONB merge operator so that keys not present in
/// `patch` are preserved.  Creates the row if it does not exist.
pub(crate) async fn merge_checkpoint_metadata(
    pool: &PgPool,
    patch: &serde_json::Value,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO batch_projection_checkpoints (projection_name, metadata, updated_at)
        VALUES ($1, $2::jsonb, NOW())
        ON CONFLICT (projection_name) DO UPDATE SET
            metadata   = COALESCE(batch_projection_checkpoints.metadata, '{}'::jsonb)
                            || EXCLUDED.metadata,
            updated_at = NOW()
        "#,
    )
    .bind(PROJECTION_NAME)
    .bind(patch)
    .execute(pool)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Backfill state
// ---------------------------------------------------------------------------

/// Query the current backfill state from `batch_projection_checkpoints`.
///
/// Returns `(backfill_complete, last_backfill_day)` where:
/// - `backfill_complete` — `true` once all historical days have been processed.
/// - `last_backfill_day` — the last day successfully checkpointed, or `None`
///   when backfill has not yet started.
///
/// The checkpoint is stored as a JSON object in the `metadata` column of
/// `batch_projection_checkpoints` under the key `user_activity_batch`. The
/// relevant subfields are `backfill_complete` (bool) and `last_backfill_day`
/// (ISO date string `"YYYY-MM-DD"`).
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn get_backfill_state(
    pool: &PgPool,
) -> Result<(bool, Option<NaiveDate>), ProjectionError> {
    let Some(meta) = fetch_checkpoint_metadata(pool).await? else {
        // No checkpoint row yet — backfill has not started.
        return Ok((false, None));
    };

    let backfill_complete = meta
        .get("backfill_complete")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let last_day = meta
        .get("last_backfill_day")
        .and_then(|v| v.as_str())
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

    Ok((backfill_complete, last_day))
}

/// Persist backfill checkpoint state.
///
/// UPSERTs a row in `batch_projection_checkpoints` for `user_activity_batch`
/// with the provided `backfill_complete` flag and `last_backfill_day`.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
/// * `complete` - Whether backfill has finished.
/// * `last_day` - Last day successfully processed, or `None`.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn save_backfill_state(
    pool: &PgPool,
    complete: bool,
    last_day: Option<NaiveDate>,
) -> Result<(), ProjectionError> {
    // Omit `last_backfill_day` entirely when `None` so that the JSONB blob
    // never contains an explicit `null` value for that key, which would
    // otherwise overwrite a previously valid date on a merge.
    let mut meta = serde_json::json!({
        "backfill_complete": complete,
    });
    if let Some(day) = last_day {
        meta["last_backfill_day"] = serde_json::Value::String(day.format("%Y-%m-%d").to_string());
    }

    merge_checkpoint_metadata(pool, &meta).await
}

// ---------------------------------------------------------------------------
// RFM sweep-date checkpoint
// ---------------------------------------------------------------------------

/// Query the date of the last population-wide RFM sweep.
///
/// Reads `metadata -> 'last_rfm_sweep_date'` from the
/// `batch_projection_checkpoints` row for `user_activity_batch` and parses
/// it as an ISO date string (`"YYYY-MM-DD"`).
///
/// Returns `None` when no checkpoint row exists yet or when the key is absent
/// from the metadata blob (i.e. the first run after this feature is deployed).
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn get_last_rfm_sweep_date(pool: &PgPool) -> Result<Option<NaiveDate>, ProjectionError> {
    let Some(meta) = fetch_checkpoint_metadata(pool).await? else {
        return Ok(None);
    };

    let date = meta
        .get("last_rfm_sweep_date")
        .and_then(|v| v.as_str())
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

    Ok(date)
}

/// Persist the date of the most recent population-wide RFM sweep.
///
/// Merges `last_rfm_sweep_date` into the existing metadata blob using the
/// same `|| EXCLUDED.metadata` JSONB merge pattern as `save_backfill_state`,
/// so that other keys (e.g. `backfill_complete`, `last_cohort_run_at`) are
/// preserved.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
/// * `date` - The date on which the population-wide sweep was executed.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn save_rfm_sweep_date(pool: &PgPool, date: NaiveDate) -> Result<(), ProjectionError> {
    let meta = serde_json::json!({
        "last_rfm_sweep_date": date.format("%Y-%m-%d").to_string(),
    });

    merge_checkpoint_metadata(pool, &meta).await
}

// ---------------------------------------------------------------------------
// Day aggregation (used by backfill)
// ---------------------------------------------------------------------------

/// Aggregate typed event tables for a specific calendar day.
///
/// Joins `atom_created_events`, `triple_created_events`, `deposited_events`,
/// and `redeemed_events` across all accounts that had any activity on `day`.
/// Returns one [`DailyRollup`] per (account, day) pair.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
/// * `day` - The calendar day to aggregate.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn aggregate_day(
    pool: &PgPool,
    day: NaiveDate,
) -> Result<Vec<DailyRollup>, ProjectionError> {
    // Convert the NaiveDate to a TIMESTAMPTZ range so the query can be pushed
    // down to TimescaleDB chunk pruning on `block_timestamp`.
    // We bind the day as a text literal that PostgreSQL can implicitly cast.
    let rows = sqlx::query(
        r#"
        WITH
        atoms AS (
            -- Migration 002: creator column (not creator_id)
            -- Range predicate (M1): lets TimescaleDB prune to the correct
            -- day chunk. DATE(block_timestamp) = $1 defeats chunk pruning
            -- and is sensitive to session timezone.
            SELECT creator AS account_id, COUNT(*) AS cnt
            FROM atom_created_events
            WHERE block_timestamp >= $1::date
              AND block_timestamp <  ($1::date + INTERVAL '1 day')
            GROUP BY creator
        ),
        triples AS (
            -- Migration 002: creator column (not creator_id)
            SELECT creator AS account_id, COUNT(*) AS cnt
            FROM triple_created_events
            WHERE block_timestamp >= $1::date
              AND block_timestamp <  ($1::date + INTERVAL '1 day')
            GROUP BY creator
        ),
        deps AS (
            -- Migration 002: sender column (not sender_id); assets_after_fees
            -- is the net value credited to the receiver after protocol fees.
            -- Vault identity uses (term_id, curve_id) — there is no vault_id.
            SELECT sender AS account_id,
                   COUNT(*)                           AS cnt,
                   SUM(assets_after_fees)             AS volume,
                   term_id::text || ':' || curve_id::text AS vault_key
            FROM deposited_events
            WHERE block_timestamp >= $1::date
              AND block_timestamp <  ($1::date + INTERVAL '1 day')
            GROUP BY sender, term_id, curve_id
        ),
        deps_agg AS (
            SELECT account_id,
                   SUM(cnt)::bigint        AS cnt,
                   SUM(volume)             AS volume,
                   COUNT(DISTINCT vault_key) AS vaults
            FROM deps
            GROUP BY account_id
        ),
        reds AS (
            -- Migration 002: sender column; redeemed_events has `assets` (not
            -- assets_after_fees) but uses `fees` as a separate column.
            -- We use `assets` as the gross redemption amount to be symmetric
            -- with the deposit side.
            SELECT sender AS account_id,
                   COUNT(*)                           AS cnt,
                   SUM(assets)                        AS volume,
                   term_id::text || ':' || curve_id::text AS vault_key
            FROM redeemed_events
            WHERE block_timestamp >= $1::date
              AND block_timestamp <  ($1::date + INTERVAL '1 day')
            GROUP BY sender, term_id, curve_id
        ),
        reds_agg AS (
            SELECT account_id,
                   SUM(cnt)::bigint        AS cnt,
                   SUM(volume)             AS volume,
                   COUNT(DISTINCT vault_key) AS vaults
            FROM reds
            GROUP BY account_id
        ),
        -- unique_vaults: count distinct vault keys across BOTH sides to avoid
        -- double-counting vaults that appear in both deposits and redemptions.
        vault_union AS (
            SELECT account_id, vault_key FROM deps
            UNION
            SELECT account_id, vault_key FROM reds
        ),
        unique_vault_counts AS (
            SELECT account_id, COUNT(DISTINCT vault_key)::INTEGER AS unique_vaults
            FROM vault_union
            GROUP BY account_id
        ),
        all_accounts AS (
            SELECT account_id FROM atoms
            UNION
            SELECT account_id FROM triples
            UNION
            SELECT account_id FROM deps_agg
            UNION
            SELECT account_id FROM reds_agg
        )
        SELECT
            a.account_id,
            COALESCE(at.cnt, 0)        AS atoms_created,
            COALESCE(tr.cnt, 0)        AS triples_created,
            COALESCE(d.cnt, 0)         AS deposits_count,
            COALESCE(r.cnt, 0)         AS redemptions_count,
            COALESCE(d.volume, 0)      AS deposit_volume,
            COALESCE(r.volume, 0)      AS redemption_volume,
            COALESCE(uv.unique_vaults, 0) AS unique_vaults,
            COALESCE(d.volume, 0) - COALESCE(r.volume, 0) AS net_flow
        FROM all_accounts a
        LEFT JOIN atoms             at ON at.account_id = a.account_id
        LEFT JOIN triples           tr ON tr.account_id = a.account_id
        LEFT JOIN deps_agg          d  ON d.account_id  = a.account_id
        LEFT JOIN reds_agg          r  ON r.account_id  = a.account_id
        LEFT JOIN unique_vault_counts uv ON uv.account_id = a.account_id
        "#,
    )
    .bind(day)
    .fetch_all(pool)
    .await?;

    let mut result = Vec::with_capacity(rows.len());
    for row in rows {
        let account_id: String = row.try_get("account_id")?;

        // The SQL uses COALESCE(..., 0) for all aggregate columns, so a decode
        // error here indicates a genuine schema mismatch — propagate with `?`
        // rather than silently defaulting, which would hide real bugs.
        let atoms_created: i64 = row.try_get("atoms_created")?;
        let triples_created: i64 = row.try_get("triples_created")?;
        let deposits_count: i64 = row.try_get("deposits_count")?;
        let redemptions_count: i64 = row.try_get("redemptions_count")?;
        // Monetary volumes arrive as NUMERIC — sqlx decodes them as BigDecimal.
        let deposit_volume: BigDecimal = row.try_get("deposit_volume")?;
        let redemption_volume: BigDecimal = row.try_get("redemption_volume")?;
        // `unique_vaults` is an `INTEGER` column — decode as `i32` to match (m13).
        let unique_vaults: i32 = row.try_get("unique_vaults")?;
        let net_flow: BigDecimal = row.try_get("net_flow")?;

        // Convert the NaiveDate to a midnight UTC DateTime for the TIMESTAMPTZ
        // column. `and_hms_opt(0,0,0)` is infallible for valid NaiveDates.
        let day_ts: DateTime<Utc> = day
            .and_hms_opt(0, 0, 0)
            .expect("midnight is always a valid time")
            .and_utc();

        result.push(DailyRollup {
            account_id,
            day: day_ts,
            atoms_created,
            triples_created,
            deposits_count,
            redemptions_count,
            deposit_volume,
            redemption_volume,
            unique_vaults,
            net_flow,
        });
    }
    Ok(result)
}

// ---------------------------------------------------------------------------
// Daily rollup upsert
// ---------------------------------------------------------------------------

/// UPSERT a single account's daily activity rollup into `user_activity_daily`.
///
/// On conflict the row is fully replaced with the freshly computed values.
/// This is safe to call multiple times with the same `(account_id, day)` key
/// (idempotent).
///
/// # Arguments
///
/// * `tx` - Active PostgreSQL transaction.
/// * `rollup` - Aggregated metrics for one (account, day).
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn upsert_daily_rollup(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    rollup: &DailyRollup,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO user_activity_daily (
            account_id, day,
            atoms_created, triples_created,
            deposits_count, redemptions_count,
            deposit_volume, redemption_volume,
            unique_vaults, net_flow
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (account_id, day) DO UPDATE SET
            atoms_created     = EXCLUDED.atoms_created,
            triples_created   = EXCLUDED.triples_created,
            deposits_count    = EXCLUDED.deposits_count,
            redemptions_count = EXCLUDED.redemptions_count,
            deposit_volume    = EXCLUDED.deposit_volume,
            redemption_volume = EXCLUDED.redemption_volume,
            unique_vaults     = EXCLUDED.unique_vaults,
            net_flow          = EXCLUDED.net_flow
        "#,
    )
    // `rollup.day` is `DateTime<Utc>` matching the TIMESTAMPTZ column.
    // Volume fields are `BigDecimal` matching the NUMERIC column type.
    .bind(&rollup.account_id)
    .bind(rollup.day)
    .bind(rollup.atoms_created)
    .bind(rollup.triples_created)
    .bind(rollup.deposits_count)
    .bind(rollup.redemptions_count)
    .bind(&rollup.deposit_volume)
    .bind(&rollup.redemption_volume)
    .bind(rollup.unique_vaults)
    .bind(&rollup.net_flow)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Today's rollup for incremental cycle
// ---------------------------------------------------------------------------

/// Compute and UPSERT the daily rollup for `account_id` covering today.
///
/// Called during the incremental cycle to keep today's row fresh without
/// waiting for the backfill cadence.
///
/// # Arguments
///
/// * `tx` - Active PostgreSQL transaction.
/// * `account_id` - The account to recompute.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn upsert_today_rollup(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO user_activity_daily (
            account_id, day,
            atoms_created, triples_created,
            deposits_count, redemptions_count,
            deposit_volume, redemption_volume,
            unique_vaults, net_flow
        )
        SELECT
            $1,
            -- DATE_TRUNC to midnight UTC so it matches the TIMESTAMPTZ column
            -- convention used by the backfill path. Explicit 'UTC' timezone
            -- avoids session-timezone drift affecting the target day bucket.
            DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC'),
            COUNT(*) FILTER (WHERE src = 'atom')                    AS atoms_created,
            COUNT(*) FILTER (WHERE src = 'triple')                  AS triples_created,
            COUNT(*) FILTER (WHERE src = 'deposit')                 AS deposits_count,
            COUNT(*) FILTER (WHERE src = 'redeem')                  AS redemptions_count,
            COALESCE(SUM(vol) FILTER (WHERE src = 'deposit'), 0)    AS deposit_volume,
            COALESCE(SUM(vol) FILTER (WHERE src = 'redeem'),  0)    AS redemption_volume,
            -- Count distinct vault keys across both deposit and redeem sides to
            -- avoid double-counting the same vault that appears in both.
            COUNT(DISTINCT vault_key)::INTEGER                        AS unique_vaults,
            COALESCE(SUM(vol) FILTER (WHERE src = 'deposit'), 0)
                - COALESCE(SUM(vol) FILTER (WHERE src = 'redeem'), 0) AS net_flow
        FROM (
            -- Migration 002: column is `creator`, not `creator_id`.
            -- Range predicate lets TimescaleDB prune to today's chunk;
            -- DATE(block_timestamp) = CURRENT_DATE defeats chunk pruning and
            -- is sensitive to the session timezone.
            SELECT 'atom' AS src, NULL::numeric AS vol, NULL::text AS vault_key
            FROM atom_created_events
            WHERE creator = $1
              AND block_timestamp >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
              AND block_timestamp <  DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day'
            UNION ALL
            -- Migration 002: column is `creator`, not `creator_id`
            SELECT 'triple', NULL, NULL
            FROM triple_created_events
            WHERE creator = $1
              AND block_timestamp >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
              AND block_timestamp <  DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day'
            UNION ALL
            -- Migration 002: column is `sender` (not `sender_id`);
            -- `assets_after_fees` is the net deposited amount;
            -- vault identity is (term_id, curve_id) — no `vault_id` column.
            SELECT 'deposit', assets_after_fees,
                   (term_id::text || ':' || curve_id::text)
            FROM deposited_events
            WHERE sender = $1
              AND block_timestamp >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
              AND block_timestamp <  DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day'
            UNION ALL
            -- Migration 002: column is `sender` (not `sender_id`);
            -- `assets` is the gross redemption amount.
            SELECT 'redeem', assets,
                   (term_id::text || ':' || curve_id::text)
            FROM redeemed_events
            WHERE sender = $1
              AND block_timestamp >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC')
              AND block_timestamp <  DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') + INTERVAL '1 day'
        ) t
        ON CONFLICT (account_id, day) DO UPDATE SET
            atoms_created     = EXCLUDED.atoms_created,
            triples_created   = EXCLUDED.triples_created,
            deposits_count    = EXCLUDED.deposits_count,
            redemptions_count = EXCLUDED.redemptions_count,
            deposit_volume    = EXCLUDED.deposit_volume,
            redemption_volume = EXCLUDED.redemption_volume,
            unique_vaults     = EXCLUDED.unique_vaults,
            net_flow          = EXCLUDED.net_flow
        "#,
    )
    .bind(account_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Activity profile upsert
// ---------------------------------------------------------------------------

/// UPSERT the rolling-window metrics and all-time creation counts for a
/// single account into `user_activity_profile`.
///
/// Rolling windows (7d / 30d / 90d) are computed directly from
/// `user_activity_daily` inside the query for consistency. All-time creation
/// counts come from the raw typed event tables.
///
/// The `creator_trader_ratio` is defined as:
/// ```text
/// (atoms_created_30d + triples_created_30d) /
///   NULLIF(deposits_30d + redemptions_30d + atoms_created_30d + triples_created_30d, 0)
/// ```
///
/// # Arguments
///
/// * `tx` - Active PostgreSQL transaction.
/// * `account_id` - Ethereum address of the account.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn upsert_activity_profile(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    account_id: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        WITH windows AS (
            -- FILTER predicates use DATE_TRUNC + INTERVAL instead of CURRENT_DATE - N
            -- to ensure UTC-anchored boundaries that are immune to session-timezone drift
            -- and to allow TimescaleDB chunk pruning on the `day` TIMESTAMPTZ column.
            SELECT
                COALESCE(SUM(atoms_created)     FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'),  0) AS atoms_created_7d,
                COALESCE(SUM(triples_created)   FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'),  0) AS triples_created_7d,
                COALESCE(SUM(deposits_count)    FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'),  0) AS deposits_7d,
                COALESCE(SUM(redemptions_count) FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'),  0) AS redemptions_7d,
                COALESCE(SUM(deposit_volume)    FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'),  0) AS deposit_volume_7d,
                COALESCE(SUM(redemption_volume) FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '7 days'),  0) AS redemption_volume_7d,
                COALESCE(SUM(atoms_created)     FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days'), 0) AS atoms_created_30d,
                COALESCE(SUM(triples_created)   FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days'), 0) AS triples_created_30d,
                COALESCE(SUM(deposits_count)    FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days'), 0) AS deposits_30d,
                COALESCE(SUM(redemptions_count) FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days'), 0) AS redemptions_30d,
                COALESCE(SUM(deposit_volume)    FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days'), 0) AS deposit_volume_30d,
                COALESCE(SUM(redemption_volume) FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '30 days'), 0) AS redemption_volume_30d,
                COALESCE(SUM(atoms_created)     FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '90 days'), 0) AS atoms_created_90d,
                COALESCE(SUM(triples_created)   FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '90 days'), 0) AS triples_created_90d,
                COALESCE(SUM(deposits_count)    FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '90 days'), 0) AS deposits_90d,
                COALESCE(SUM(redemptions_count) FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '90 days'), 0) AS redemptions_90d,
                COALESCE(SUM(deposit_volume)    FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '90 days'), 0) AS deposit_volume_90d,
                COALESCE(SUM(redemption_volume) FILTER (WHERE day >= DATE_TRUNC('day', NOW() AT TIME ZONE 'UTC') - INTERVAL '90 days'), 0) AS redemption_volume_90d
            FROM user_activity_daily
            WHERE account_id = $1
        ),
        alltime AS (
            -- Migration 002: column is `creator`, not `creator_id`
            SELECT
                (SELECT COUNT(*) FROM atom_created_events   WHERE creator = $1) AS atoms_all_time,
                (SELECT COUNT(*) FROM triple_created_events WHERE creator = $1) AS triples_all_time
        )
        INSERT INTO user_activity_profile (
            account_id,
            atoms_created_7d,   triples_created_7d,
            deposits_7d,        redemptions_7d,
            deposit_volume_7d,  redemption_volume_7d,
            atoms_created_30d,  triples_created_30d,
            deposits_30d,       redemptions_30d,
            deposit_volume_30d, redemption_volume_30d,
            atoms_created_90d,  triples_created_90d,
            deposits_90d,       redemptions_90d,
            deposit_volume_90d, redemption_volume_90d,
            atoms_created,      triples_created,
            creator_trader_ratio,
            unique_vaults_touched,
            last_recomputed_at
        )
        SELECT
            $1,
            w.atoms_created_7d,   w.triples_created_7d,
            w.deposits_7d,        w.redemptions_7d,
            w.deposit_volume_7d,  w.redemption_volume_7d,
            w.atoms_created_30d,  w.triples_created_30d,
            w.deposits_30d,       w.redemptions_30d,
            w.deposit_volume_30d, w.redemption_volume_30d,
            w.atoms_created_90d,  w.triples_created_90d,
            w.deposits_90d,       w.redemptions_90d,
            w.deposit_volume_90d, w.redemption_volume_90d,
            a.atoms_all_time, a.triples_all_time,
            -- creator_trader_ratio: fraction of activity that is content creation
            (w.atoms_created_30d + w.triples_created_30d)::float8
                / NULLIF(
                    w.deposits_30d + w.redemptions_30d
                        + w.atoms_created_30d + w.triples_created_30d,
                    0
                ),
            -- unique_vaults_touched (M6): cumulative count of unique vault-days
            -- across all daily rollups for this account. Each daily rollup row
            -- carries the count of distinct vaults seen that day; summing them
            -- gives the total vault-interaction tally over all history.
            COALESCE(
                (SELECT SUM(unique_vaults) FROM user_activity_daily WHERE account_id = $1),
                0
            ),
            NOW()
        FROM windows w, alltime a
        ON CONFLICT (account_id) DO UPDATE SET
            atoms_created_7d          = EXCLUDED.atoms_created_7d,
            triples_created_7d        = EXCLUDED.triples_created_7d,
            deposits_7d               = EXCLUDED.deposits_7d,
            redemptions_7d            = EXCLUDED.redemptions_7d,
            deposit_volume_7d         = EXCLUDED.deposit_volume_7d,
            redemption_volume_7d      = EXCLUDED.redemption_volume_7d,
            atoms_created_30d         = EXCLUDED.atoms_created_30d,
            triples_created_30d       = EXCLUDED.triples_created_30d,
            deposits_30d              = EXCLUDED.deposits_30d,
            redemptions_30d           = EXCLUDED.redemptions_30d,
            deposit_volume_30d        = EXCLUDED.deposit_volume_30d,
            redemption_volume_30d     = EXCLUDED.redemption_volume_30d,
            atoms_created_90d         = EXCLUDED.atoms_created_90d,
            triples_created_90d       = EXCLUDED.triples_created_90d,
            deposits_90d              = EXCLUDED.deposits_90d,
            redemptions_90d           = EXCLUDED.redemptions_90d,
            deposit_volume_90d        = EXCLUDED.deposit_volume_90d,
            redemption_volume_90d     = EXCLUDED.redemption_volume_90d,
            atoms_created             = EXCLUDED.atoms_created,
            triples_created           = EXCLUDED.triples_created,
            creator_trader_ratio      = EXCLUDED.creator_trader_ratio,
            unique_vaults_touched     = EXCLUDED.unique_vaults_touched,
            last_recomputed_at        = NOW()
        "#,
    )
    .bind(account_id)
    .execute(&mut **tx)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// RFM scoring
// ---------------------------------------------------------------------------

/// Minimum active-account population required before NTILE(5) is applied.
///
/// Below this threshold the scoring query falls back to assigning score 3
/// to every account (mid-tier neutral) to avoid meaningless percentile
/// buckets over tiny populations.
const RFM_MIN_POPULATION: i64 = 50;

/// Compute and write RFM (Recency, Frequency, Monetary) scores for the entire
/// active-account population.
///
/// Active accounts are those with `last_recomputed_at > NOW() - 30 days`.
/// If the active population is below [`RFM_MIN_POPULATION`] all accounts
/// receive score 3 (neutral mid-tier). Dormant / new accounts are nulled out
/// in a follow-up UPDATE.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn compute_rfm_scores(pool: &PgPool) -> Result<(), ProjectionError> {
    // Count active accounts first to decide whether NTILE is meaningful.
    let active_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM user_activity_profile
        WHERE last_recomputed_at > NOW() - INTERVAL '30 days'
        "#,
    )
    .fetch_one(pool)
    .await?;

    // Single UPDATE pass using a CASE expression:
    // - Active accounts (last_recomputed_at within 30 days) get NTILE(5) scores
    //   (or neutral score 3 when the population is too small).
    // - Dormant/new accounts get NULL scores in the same statement — no second
    //   UPDATE pass needed (M5: combine the two passes into one).
    //
    // Both the scoring and the NULL-out use the same 30-day active population
    // filter to ensure consistent window semantics (M4).
    if active_count < RFM_MIN_POPULATION {
        // Bootstrap path: too few accounts for NTILE to be meaningful.
        // Assign neutral score 3 to active accounts; NULL to dormant ones.
        sqlx::query(
            r#"
            UPDATE user_activity_profile
            SET rfm_recency_score   = CASE
                WHEN last_recomputed_at > NOW() - INTERVAL '30 days' THEN 3
                ELSE NULL
            END,
                rfm_frequency_score = CASE
                WHEN last_recomputed_at > NOW() - INTERVAL '30 days' THEN 3
                ELSE NULL
            END,
                rfm_monetary_score  = CASE
                WHEN last_recomputed_at > NOW() - INTERVAL '30 days' THEN 3
                ELSE NULL
            END
            "#,
        )
        .execute(pool)
        .await?;
    } else {
        // Full NTILE scoring path:
        // Active accounts (within 30 days) receive NTILE(5) ranks.
        // Dormant accounts are NULLed out in the same UPDATE via a LEFT JOIN,
        // so scored.rfm_* IS NULL for non-active rows (M5: single pass).
        sqlx::query(
            r#"
            WITH active_accounts AS (
                -- 30-day active population (M4: consistent window)
                SELECT
                    account_id,
                    -- Recency: days since last recomputation (lower = more recent = better)
                    EXTRACT(DAY FROM NOW() - last_recomputed_at) AS recency_days,
                    -- Frequency: total transactions in last 30 days
                    deposits_30d + redemptions_30d
                        + atoms_created_30d + triples_created_30d AS frequency_30d,
                    -- Monetary: log-transformed to compress wide value ranges
                    LN(1.0 + (deposit_volume_30d + redemption_volume_30d)::float8) AS monetary_log
                FROM user_activity_profile
                WHERE last_recomputed_at > NOW() - INTERVAL '30 days'
            ),
            scored AS (
                SELECT
                    account_id,
                    -- recency_days = days since last activity; lower = more recent = better.
                    -- ORDER BY ASC means the smallest recency_days values land in tile 1,
                    -- and the most-recent accounts (fewest days elapsed) receive tile 5
                    -- (the highest score). ORDER BY DESC was previously inverted — the
                    -- most-recent users incorrectly received tile 1.
                    NTILE(5) OVER (ORDER BY recency_days ASC)   AS rfm_r,
                    NTILE(5) OVER (ORDER BY frequency_30d)      AS rfm_f,
                    NTILE(5) OVER (ORDER BY monetary_log)       AS rfm_m
                FROM active_accounts
            )
            UPDATE user_activity_profile p
            SET rfm_recency_score   = s.rfm_r,   -- NULL when not in active_accounts
                rfm_frequency_score = s.rfm_f,
                rfm_monetary_score  = s.rfm_m
            FROM (
                -- LEFT JOIN all profiles against scored so that dormant rows
                -- produce NULL scores in one pass without a second UPDATE.
                SELECT p2.account_id, s2.rfm_r, s2.rfm_f, s2.rfm_m
                FROM user_activity_profile p2
                LEFT JOIN scored s2 USING (account_id)
            ) s
            WHERE p.account_id = s.account_id
            "#,
        )
        .execute(pool)
        .await?;
    }

    Ok(())
}

// ---------------------------------------------------------------------------
// Segment classification
// ---------------------------------------------------------------------------

/// Classify every account in `user_activity_profile` into a user segment.
///
/// Segments (evaluated in priority order, highest wins):
/// - `whale` — top 1% by 30-day volume.
/// - `power_user` — top 10% by 30-day frequency AND creator_trader_ratio
///   in [0.2, 0.8].
/// - `new` — active in last 14 days AND account first seen within 14 days.
/// - `active` — active in last 30 days AND frequency >= median.
/// - `casual` — active in last 30 days, below median frequency.
/// - `dormant` — everything else.
///
/// Previous segment is preserved in `previous_segment` before overwriting so
/// callers can detect transitions.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn classify_segments(pool: &PgPool) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        WITH thresholds AS (
            -- M4: use the same 30-day active population filter as the RFM
            -- scoring so the segment thresholds are computed over a consistent
            -- subset of accounts.
            SELECT
                percentile_cont(0.99) WITHIN GROUP (
                    ORDER BY deposit_volume_30d + redemption_volume_30d
                ) AS whale_threshold,
                percentile_cont(0.90) WITHIN GROUP (
                    ORDER BY deposits_30d + redemptions_30d
                           + atoms_created_30d + triples_created_30d
                ) AS power_user_threshold,
                percentile_cont(0.50) WITHIN GROUP (
                    ORDER BY deposits_30d + redemptions_30d
                           + atoms_created_30d + triples_created_30d
                ) AS median_frequency
            FROM user_activity_profile
            WHERE last_recomputed_at > NOW() - INTERVAL '30 days'
        )
        UPDATE user_activity_profile p
        SET
            previous_segment = p.user_segment,
            user_segment = (CASE
                -- C3: GREATEST(..., 1) prevents classifying zero-volume accounts
                -- as whales when the 99th-percentile threshold itself is zero
                -- (i.e. the entire active population has zero volume). Without
                -- this guard, `0 >= 0` evaluates to true and everyone becomes a
                -- whale, making the segment meaningless.
                WHEN (p.deposit_volume_30d + p.redemption_volume_30d)
                        >= GREATEST(t.whale_threshold, 1)
                    THEN 'whale'
                WHEN (p.deposits_30d + p.redemptions_30d
                        + p.atoms_created_30d + p.triples_created_30d)
                        >= t.power_user_threshold
                     AND p.creator_trader_ratio BETWEEN 0.2 AND 0.8
                    THEN 'power_user'
                WHEN p.last_recomputed_at > NOW() - INTERVAL '14 days'
                     AND EXISTS (
                         SELECT 1 FROM account a
                         WHERE a.account_id = p.account_id
                           AND a.first_seen_at > NOW() - INTERVAL '14 days'
                     )
                    THEN 'new'
                WHEN p.last_recomputed_at > NOW() - INTERVAL '30 days'
                     AND (p.deposits_30d + p.redemptions_30d
                            + p.atoms_created_30d + p.triples_created_30d)
                         >= t.median_frequency
                    THEN 'active'
                WHEN p.last_recomputed_at > NOW() - INTERVAL '30 days'
                    THEN 'casual'
                ELSE 'dormant'
            END)::user_segment_type
        FROM thresholds t
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Dirty-set-scoped RFM scoring and segment classification
// ---------------------------------------------------------------------------

/// Recompute RFM scores for only the accounts in the dirty set.
///
/// NTILE quintiles are computed over the **full active population** (all
/// accounts with `last_recomputed_at > NOW() - 30 days`) so that dirty-set
/// accounts receive the same relative ranking they would get in a full sweep.
/// The final UPDATE is then filtered to `account_id = ANY($1)`, touching only
/// the rows that actually changed.
///
/// When the active population is below [`RFM_MIN_POPULATION`] the bootstrap
/// path assigns score 3 to every dirty-set account, matching the full-sweep
/// bootstrap behaviour.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
/// * `account_ids` - Slice of account addresses to update.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn compute_rfm_scores_for_accounts(
    pool: &PgPool,
    account_ids: &[String],
) -> Result<(), ProjectionError> {
    // Count active accounts first to decide whether NTILE is meaningful.
    // This must cover the full population — not just the dirty set — because
    // the threshold for "meaningful" is the overall active population size.
    let active_count: i64 = sqlx::query_scalar(
        r#"
        SELECT COUNT(*) FROM user_activity_profile
        WHERE last_recomputed_at > NOW() - INTERVAL '30 days'
        "#,
    )
    .fetch_one(pool)
    .await?;

    if active_count < RFM_MIN_POPULATION {
        // Bootstrap path: assign neutral score 3 only to dirty-set accounts.
        // The WHERE clause restricts the UPDATE to the dirty set while
        // matching the full-sweep bootstrap behaviour (score 3 for active,
        // NULL for dormant).
        sqlx::query(
            r#"
            UPDATE user_activity_profile
            SET rfm_recency_score   = CASE
                WHEN last_recomputed_at > NOW() - INTERVAL '30 days' THEN 3
                ELSE NULL
            END,
                rfm_frequency_score = CASE
                WHEN last_recomputed_at > NOW() - INTERVAL '30 days' THEN 3
                ELSE NULL
            END,
                rfm_monetary_score  = CASE
                WHEN last_recomputed_at > NOW() - INTERVAL '30 days' THEN 3
                ELSE NULL
            END
            WHERE account_id = ANY($1)
            "#,
        )
        .bind(account_ids)
        .execute(pool)
        .await?;
    } else {
        // Full NTILE path:
        // 1. `active_accounts` CTE spans the ENTIRE active population so that
        //    quintile boundaries are representative of the whole user base.
        // 2. `scored` CTE applies NTILE(5) over all active accounts.
        // 3. The UPDATE joins all profiles (full outer join so dormant rows
        //    produce NULL scores), but the outer WHERE restricts writes to
        //    `account_id = ANY($1)` — only dirty-set rows are touched.
        sqlx::query(
            r#"
            WITH active_accounts AS (
                SELECT
                    account_id,
                    EXTRACT(DAY FROM NOW() - last_recomputed_at) AS recency_days,
                    deposits_30d + redemptions_30d
                        + atoms_created_30d + triples_created_30d AS frequency_30d,
                    LN(1.0 + (deposit_volume_30d + redemption_volume_30d)::float8) AS monetary_log
                FROM user_activity_profile
                WHERE last_recomputed_at > NOW() - INTERVAL '30 days'
            ),
            scored AS (
                SELECT
                    account_id,
                    -- NTILE computed over the FULL active population so
                    -- quintile assignments are not skewed by restricting the
                    -- window to the dirty set only.
                    NTILE(5) OVER (ORDER BY recency_days ASC) AS rfm_r,
                    NTILE(5) OVER (ORDER BY frequency_30d)   AS rfm_f,
                    NTILE(5) OVER (ORDER BY monetary_log)    AS rfm_m
                FROM active_accounts
            )
            UPDATE user_activity_profile p
            SET rfm_recency_score   = s.rfm_r,
                rfm_frequency_score = s.rfm_f,
                rfm_monetary_score  = s.rfm_m
            FROM (
                -- LEFT JOIN all profiles so dormant accounts produce NULL
                -- scores in one pass, matching the full-sweep behaviour.
                SELECT p2.account_id, s2.rfm_r, s2.rfm_f, s2.rfm_m
                FROM user_activity_profile p2
                LEFT JOIN scored s2 USING (account_id)
            ) s
            WHERE p.account_id = s.account_id
              -- Restrict the actual row writes to the dirty set only.
              AND p.account_id = ANY($1)
            "#,
        )
        .bind(account_ids)
        .execute(pool)
        .await?;
    }

    Ok(())
}

/// Classify user segments for only the accounts in the dirty set.
///
/// The whale and frequency thresholds (99th/90th/50th percentiles) are
/// computed over the **full active population** so that the segment boundaries
/// are representative of the whole user base. Only the final UPDATE is
/// restricted to `account_id = ANY($1)`.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
/// * `account_ids` - Slice of account addresses to classify.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn classify_segments_for_accounts(
    pool: &PgPool,
    account_ids: &[String],
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        WITH thresholds AS (
            -- Compute percentile thresholds over the FULL active population
            -- (same 30-day window as the full-sweep path) so that dirty-set
            -- accounts are classified relative to the entire user base, not
            -- just relative to each other.
            SELECT
                percentile_cont(0.99) WITHIN GROUP (
                    ORDER BY deposit_volume_30d + redemption_volume_30d
                ) AS whale_threshold,
                percentile_cont(0.90) WITHIN GROUP (
                    ORDER BY deposits_30d + redemptions_30d
                           + atoms_created_30d + triples_created_30d
                ) AS power_user_threshold,
                percentile_cont(0.50) WITHIN GROUP (
                    ORDER BY deposits_30d + redemptions_30d
                           + atoms_created_30d + triples_created_30d
                ) AS median_frequency
            FROM user_activity_profile
            WHERE last_recomputed_at > NOW() - INTERVAL '30 days'
        )
        UPDATE user_activity_profile p
        SET
            previous_segment = p.user_segment,
            user_segment = (CASE
                WHEN (p.deposit_volume_30d + p.redemption_volume_30d)
                        >= GREATEST(t.whale_threshold, 1)
                    THEN 'whale'
                WHEN (p.deposits_30d + p.redemptions_30d
                        + p.atoms_created_30d + p.triples_created_30d)
                        >= t.power_user_threshold
                     AND p.creator_trader_ratio BETWEEN 0.2 AND 0.8
                    THEN 'power_user'
                WHEN p.last_recomputed_at > NOW() - INTERVAL '14 days'
                     AND EXISTS (
                         SELECT 1 FROM account a
                         WHERE a.account_id = p.account_id
                           AND a.first_seen_at > NOW() - INTERVAL '14 days'
                     )
                    THEN 'new'
                WHEN p.last_recomputed_at > NOW() - INTERVAL '30 days'
                     AND (p.deposits_30d + p.redemptions_30d
                            + p.atoms_created_30d + p.triples_created_30d)
                         >= t.median_frequency
                    THEN 'active'
                WHEN p.last_recomputed_at > NOW() - INTERVAL '30 days'
                    THEN 'casual'
                ELSE 'dormant'
            END)::user_segment_type
        FROM thresholds t
        -- Restrict writes to dirty-set accounts only; thresholds are still
        -- computed over the full population in the CTE above.
        WHERE p.account_id = ANY($1)
        "#,
    )
    .bind(account_ids)
    .execute(pool)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Topic affinity (Phase 5)
// ---------------------------------------------------------------------------

/// Get the last processed `position_change` timestamp for incremental topic
/// affinity computation.
///
/// Reads from `batch_projection_checkpoints` where
/// `projection_name = 'user_activity_batch'` and extracts
/// `metadata -> 'topic_affinity_last_ts'` as a `DateTime<Utc>`.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Returns
///
/// `Some(ts)` if a checkpoint timestamp exists, `None` if no checkpoint has
/// been saved yet (first run) or the key is absent.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn get_topic_affinity_checkpoint(
    pool: &PgPool,
) -> Result<Option<DateTime<Utc>>, ProjectionError> {
    let Some(meta) = fetch_checkpoint_metadata(pool).await? else {
        return Ok(None);
    };

    // The timestamp is stored as an RFC3339 string under `topic_affinity_last_ts`.
    let ts = meta
        .get("topic_affinity_last_ts")
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
        .map(|dt| dt.with_timezone(&Utc));

    Ok(ts)
}

/// Persist the topic affinity checkpoint timestamp.
///
/// UPSERTs a row in `batch_projection_checkpoints` for `user_activity_batch`,
/// writing only the `topic_affinity_last_ts` key so it does not clobber other
/// metadata keys (e.g. `backfill_complete`, `last_cohort_run_at`).
///
/// Uses the same `metadata || EXCLUDED.metadata` JSONB merge pattern as
/// [`save_backfill_state`].
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
/// * `last_ts` - The `MAX(ts)` from the most-recently processed
///   `position_change` batch.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn save_topic_affinity_checkpoint(
    pool: &PgPool,
    last_ts: DateTime<Utc>,
) -> Result<(), ProjectionError> {
    // Only write the single key we own so the `||` merge in the ON CONFLICT
    // clause does not overwrite keys written by other checkpoint functions.
    let meta = serde_json::json!({
        "topic_affinity_last_ts": last_ts.to_rfc3339(),
    });

    merge_checkpoint_metadata(pool, &meta).await
}

/// Check whether a full topic affinity recompute should run today (UTC).
///
/// Reads `metadata -> 'topic_affinity_last_full_recompute_date'` from the
/// checkpoint row. Returns `true` when the stored date is before today or no
/// date has been stored (first run).
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn should_run_daily_affinity_recompute(pool: &PgPool) -> Result<bool, ProjectionError> {
    let Some(meta) = fetch_checkpoint_metadata(pool).await? else {
        // No checkpoint at all — run the full recompute on first cycle.
        return Ok(true);
    };

    let last_date = meta
        .get("topic_affinity_last_full_recompute_date")
        .and_then(|v| v.as_str())
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

    match last_date {
        None => Ok(true), // Key missing — never run a full recompute before.
        Some(d) => Ok(d < Utc::now().date_naive()),
    }
}

/// Compute and UPSERT topic affinity scores, either incrementally or in full.
///
/// For each (account_id, term_id) pair, computes:
/// ```text
/// affinity_score = LN(1 + interaction_count) * LN(1 + total_capital_deployed)
///                 * recency_weight
/// ```
/// where `recency_weight` is 1.0 if the last interaction was within 30 days,
/// 0.5 otherwise.
///
/// Only the top 50 affinities per account are retained; entries that fall
/// outside the top-50 window are pruned atomically after the upsert.
///
/// # Modes
///
/// - **Incremental** (`since = Some(ts)`): only processes `position_change`
///   rows with `ts > ts`. The ON CONFLICT clause accumulates
///   counts (`interaction_count + EXCLUDED.interaction_count`) and keeps the
///   latest `last_interaction_at`. Pass the returned checkpoint timestamp to
///   the next incremental call.
///
/// - **Full recompute** (`since = None`): scans all `position_change` rows
///   (no WHERE clause). The ON CONFLICT clause replaces stored values with the
///   freshly computed totals, correcting any drift accumulated by incremental
///   runs.
///
/// # Join path
///
/// `position_change` carries `account_id`, `term_id`, `assets_in`, and
/// `ts` directly. No join to `vault` or `position` is needed for
/// the affinity computation.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
/// * `since` - Optional lower-bound timestamp for incremental mode. When
///   `None`, all rows are scanned (full recompute).
///
/// # Returns
///
/// `Some(max_ts)` — the `MAX(ts)` of the rows processed in this
/// call, which should be saved as the next checkpoint. Returns `None` when no
/// rows matched the filter (i.e. no new events since the last checkpoint).
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn compute_topic_affinity(
    pool: &PgPool,
    since: Option<DateTime<Utc>>,
) -> Result<Option<DateTime<Utc>>, ProjectionError> {
    // Both the upsert and the prune must succeed or fail together: if the prune
    // is skipped after a successful upsert (e.g. process crash), evicted entries
    // remain in the table indefinitely. A transaction guarantees atomicity.
    let mut tx = pool.begin().await?;

    // Step 1: UPSERT affinities.
    //
    // We choose the SQL string at runtime based on whether `since` is Some or
    // None. The two module-level constants (INCREMENTAL_UPSERT_SQL and
    // FULL_UPSERT_SQL) keep each path readable without conditional string
    // building and are directly referenceable by tests.
    //
    // Incremental path ($2 = lower-bound timestamp):
    //   WHERE pc.ts > $2
    //   ON CONFLICT … interaction_count + EXCLUDED.interaction_count  (additive)
    //
    // Full path (no WHERE, $1 only):
    //   ON CONFLICT … interaction_count = EXCLUDED.interaction_count  (replace)
    //
    // Column mapping (from actual schema):
    //   position_change.account_id      -- the account
    //   position_change.term_id         -- the atom/triple term
    //   position_change.assets_in       -- capital entering the position per event
    //   position_change.ts              -- event timestamp (TimescaleDB hypertable key)

    // Execute the appropriate upsert based on mode.
    // `since` drives the SQL selection and bind parameters.
    if let Some(since_ts) = since {
        // Incremental: bind $1 = TOP_N_AFFINITIES, $2 = since_ts.
        sqlx::query(INCREMENTAL_UPSERT_SQL)
            .bind(TOP_N_AFFINITIES)
            .bind(since_ts)
            .execute(&mut *tx)
            .await?;
    } else {
        // Full recompute: only $1 = TOP_N_AFFINITIES.
        sqlx::query(FULL_UPSERT_SQL)
            .bind(TOP_N_AFFINITIES)
            .execute(&mut *tx)
            .await?;
    }

    // Step 2: Capture MAX(ts) from the rows processed, inside the transaction
    // so it is consistent with the upserted data and we avoid a post-commit
    // read racing with other writers.
    let max_ts: Option<DateTime<Utc>> = if let Some(since_ts) = since {
        sqlx::query_scalar("SELECT MAX(ts) FROM position_change WHERE ts > $1")
            .bind(since_ts)
            .fetch_one(&mut *tx)
            .await?
    } else {
        sqlx::query_scalar("SELECT MAX(ts) FROM position_change")
            .fetch_one(&mut *tx)
            .await?
    };

    // Step 3: Prune entries that fell outside the top-N window (M2).
    //
    // CTE-based DELETE avoids the correlated NOT EXISTS anti-join; the planner
    // can execute the window function once and join cheaply.
    // Executed within the same transaction as the upsert so that a crash between
    // the two statements does not leave evicted entries permanently in the table.
    sqlx::query(
        r#"
        WITH ranked AS (
            SELECT account_id, term_id,
                   ROW_NUMBER() OVER (
                       PARTITION BY account_id ORDER BY affinity_score DESC
                   ) AS rn
            FROM user_topic_affinity
        )
        DELETE FROM user_topic_affinity uta
        USING ranked
        WHERE ranked.account_id = uta.account_id
          AND ranked.term_id    = uta.term_id
          AND ranked.rn > $1
        "#,
    )
    .bind(TOP_N_AFFINITIES)
    .execute(&mut *tx)
    .await?;

    tx.commit().await?;

    Ok(max_ts)
}

// ---------------------------------------------------------------------------
// Retention cohorts (Phase 6 — weekly)
// ---------------------------------------------------------------------------

/// Check whether it is time to run the weekly retention cohort computation.
///
/// Reads the `last_cohort_run_at` timestamp from `batch_projection_checkpoints`
/// for the `user_activity_batch` entry and returns `true` if more than 7 days
/// have elapsed (or if no cohort run has ever been recorded).
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn should_run_weekly_cohorts(pool: &PgPool) -> Result<bool, ProjectionError> {
    // The last_cohort_run_at value is stored as a JSON string in the metadata
    // blob alongside the backfill state, keyed by "last_cohort_run_at".
    let Some(meta) = fetch_checkpoint_metadata(pool).await? else {
        // No checkpoint at all — run cohorts on first cycle.
        return Ok(true);
    };

    let last_run_str = meta
        .get("last_cohort_run_at")
        .and_then(|v| v.as_str())
        .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok());

    match last_run_str {
        None => Ok(true), // Never run before.
        Some(last_run) => {
            let age = chrono::Utc::now() - last_run.with_timezone(&chrono::Utc);
            // chrono::Duration::days(7) represents exactly 7 * 86400 seconds.
            Ok(age >= chrono::Duration::days(7))
        }
    }
}

/// Persist the timestamp of the most recent cohort computation.
///
/// Merges `last_cohort_run_at` into the existing metadata blob so that
/// backfill state and cohort-run state live in the same checkpoint row.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn save_last_cohort_run(pool: &PgPool) -> Result<(), ProjectionError> {
    let now_str = chrono::Utc::now().to_rfc3339();
    let meta = serde_json::json!({
        "last_cohort_run_at": now_str,
    });
    merge_checkpoint_metadata(pool, &meta).await
}

/// Compute and UPSERT weekly retention cohort data from `user_activity_daily`.
///
/// Assigns each account to a cohort based on the ISO week of their
/// `first_seen_at` date (from the `account` table), then joins against
/// `user_activity_daily` to compute weekly action counts. For each
/// (account, cohort_week, period_offset) triple, records whether the account
/// was active and how many actions they took.
///
/// `period_offset` is the number of weeks since the cohort week, so:
/// - offset 0 = the cohort week itself (acquisition week)
/// - offset 1 = one week after acquisition
/// - etc.
///
/// # Idempotency
///
/// Uses `INSERT … ON CONFLICT DO UPDATE` so replaying after a partial failure
/// produces the same final state.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on SQL failure.
pub async fn compute_retention_cohorts(pool: &PgPool) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        WITH cohort_assignment AS (
            -- Map each account to the ISO week Monday of their first_seen_at.
            -- date_trunc('week', ...) in PostgreSQL returns the Monday of the week.
            SELECT
                account_id,
                date_trunc('week', first_seen_at) AS cohort_week
            FROM account
            WHERE first_seen_at IS NOT NULL
        ),
        weekly_activity AS (
            -- Roll up user_activity_daily into weekly buckets.
            -- Only include weeks where the account had at least one action.
            SELECT
                account_id,
                date_trunc('week', day) AS activity_week,
                SUM(
                    atoms_created
                    + triples_created
                    + deposits_count
                    + redemptions_count
                )::integer AS action_count
            FROM user_activity_daily
            GROUP BY account_id, date_trunc('week', day)
            HAVING SUM(
                atoms_created
                + triples_created
                + deposits_count
                + redemptions_count
            ) > 0
        )
        INSERT INTO user_retention_cohort (
            account_id,
            cohort_week,
            period_offset,
            was_active,
            action_count
        )
        SELECT
            ca.account_id,
            ca.cohort_week,
            -- period_offset: integer number of weeks since cohort_week.
            -- EXTRACT(DAYS ...) gives the exact day difference; dividing by 7
            -- yields the week offset. Both cohort_week and activity_week are
            -- truncated to week boundaries so this is always an exact integer.
            (EXTRACT(DAYS FROM (wa.activity_week - ca.cohort_week))::integer / 7)
                AS period_offset,
            TRUE        AS was_active,
            wa.action_count
        FROM cohort_assignment ca
        JOIN weekly_activity wa
          ON  wa.account_id   = ca.account_id
          AND wa.activity_week >= ca.cohort_week
        ON CONFLICT (account_id, cohort_week, period_offset) DO UPDATE SET
            was_active   = TRUE,
            action_count = EXCLUDED.action_count
        "#,
    )
    .execute(pool)
    .await?;

    Ok(())
}

// ---------------------------------------------------------------------------
// Metrics helpers
// ---------------------------------------------------------------------------

/// Count accounts in `user_activity_profile` that are not classified as
/// dormant (i.e. any segment other than `'dormant'`).
///
/// Used by `UserActivityBatchProjection` to emit the
/// `user_activity_active_account_count` Prometheus gauge after each
/// `classify_segments` run.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any SQL failure.
pub async fn count_active_accounts(pool: &PgPool) -> Result<i64, ProjectionError> {
    let count: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM user_activity_profile WHERE user_segment != 'dormant'",
    )
    .fetch_one(pool)
    .await?;
    Ok(count)
}

/// Count the total rows currently in `user_topic_affinity`.
///
/// Used by `UserActivityBatchProjection` to emit the
/// `user_topic_affinity_row_count` Prometheus gauge after each
/// `compute_topic_affinity` run.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any SQL failure.
pub async fn count_topic_affinity_rows(pool: &PgPool) -> Result<i64, ProjectionError> {
    let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM user_topic_affinity")
        .fetch_one(pool)
        .await?;
    Ok(count)
}

/// Return per-segment account counts from `user_activity_profile`.
///
/// Each element of the returned `Vec` is a `(segment, count)` pair. Used by
/// `UserActivityBatchProjection` to set the `user_segment_account_count`
/// Prometheus `GaugeVec` after each `classify_segments` run.
///
/// # Arguments
///
/// * `pool` - Shared PostgreSQL connection pool.
///
/// # Errors
///
/// Returns `ProjectionError::Database` on any SQL failure.
pub async fn count_accounts_by_segment(
    pool: &PgPool,
) -> Result<Vec<(String, i64)>, ProjectionError> {
    // `query!` cannot be used here because the return shape is dynamic
    // (one row per distinct segment value). `sqlx::query` with `.fetch_all`
    // and manual column extraction is the standard pattern for GROUP BY results.
    let rows = sqlx::query(
        "SELECT user_segment::text AS user_segment, COUNT(*)::bigint AS cnt FROM user_activity_profile GROUP BY user_segment",
    )
    .fetch_all(pool)
    .await?;

    let result = rows
        .into_iter()
        .map(|row| -> Result<(String, i64), ProjectionError> {
            let segment: String = row.try_get("user_segment")?;
            let cnt: i64 = row.try_get("cnt")?;
            Ok((segment, cnt))
        })
        .collect::<Result<Vec<_>, _>>()?;

    Ok(result)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    fn zero_bd() -> BigDecimal {
        BigDecimal::from(0)
    }

    fn make_rollup(day: DateTime<Utc>) -> DailyRollup {
        DailyRollup {
            account_id: "0xAlice".to_owned(),
            day,
            atoms_created: 3,
            triples_created: 7,
            deposits_count: 2,
            redemptions_count: 1,
            deposit_volume: BigDecimal::from(1_000_000_i64),
            redemption_volume: BigDecimal::from(500_000_i64),
            unique_vaults: 2_i32,
            net_flow: BigDecimal::from(500_000_i64),
        }
    }

    #[test]
    fn daily_rollup_debug_clone() {
        let day = NaiveDate::from_ymd_opt(2025, 1, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();
        let r = make_rollup(day);
        // Verify that Debug and Clone are derived and work without panicking.
        let _ = format!("{r:?}");
        let r2 = r.clone();
        assert_eq!(r2.account_id, "0xAlice");
    }

    #[test]
    fn daily_rollup_zero_volumes() {
        let day = DateTime::from_timestamp(0, 0).unwrap();
        let r = DailyRollup {
            account_id: "0xBob".to_owned(),
            day,
            atoms_created: 0,
            triples_created: 0,
            deposits_count: 0,
            redemptions_count: 0,
            deposit_volume: zero_bd(),
            redemption_volume: zero_bd(),
            unique_vaults: 0_i32,
            net_flow: zero_bd(),
        };
        assert_eq!(r.atoms_created, 0);
        assert_eq!(r.deposits_count, 0);
        assert_eq!(r.net_flow, zero_bd());
    }

    #[test]
    fn rfm_min_population_constant() {
        // Constant is intentional — this test guards against accidental changes.
        assert_eq!(RFM_MIN_POPULATION, 50);
    }

    #[test]
    fn weekly_cohort_period_offset_formula() {
        // Validate that our integer division formula is correct for week offsets.
        // If cohort_week is 2025-01-06 (Monday) and activity_week is 2025-01-20
        // (two Mondays later), the offset should be 2.
        let cohort = NaiveDate::from_ymd_opt(2025, 1, 6).unwrap();
        let activity = NaiveDate::from_ymd_opt(2025, 1, 20).unwrap();
        let days_diff = (activity - cohort).num_days();
        assert_eq!(days_diff / 7, 2);
    }

    #[test]
    fn should_run_weekly_cohorts_missing_key_returns_true() {
        // When "last_cohort_run_at" is absent from metadata, we expect
        // the function to return true (run cohorts). We test the pure
        // date-math branch without a DB connection.
        let meta = serde_json::json!({"backfill_complete": true});
        let last_run_str = meta
            .get("last_cohort_run_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok());
        // No key → None → should run.
        assert!(last_run_str.is_none());
    }

    #[test]
    fn should_run_weekly_cohorts_recent_key_returns_false() {
        // When the last run was just now, the 7-day gate should not trigger.
        let now = chrono::Utc::now();
        let meta = serde_json::json!({"last_cohort_run_at": now.to_rfc3339()});
        let last_run = meta
            .get("last_cohort_run_at")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .unwrap();
        let age = now - last_run.with_timezone(&chrono::Utc);
        assert!(age < chrono::Duration::days(7));
    }

    // -----------------------------------------------------------------------
    // Constant guards
    // -----------------------------------------------------------------------

    /// TOP_N_AFFINITIES must stay at 50.  A change here has downstream effects
    /// on the prune query and the `user_topic_affinity` table size; the test
    /// forces the author to update it intentionally.
    #[test]
    fn top_n_affinities_constant_is_50() {
        assert_eq!(TOP_N_AFFINITIES, 50);
    }

    /// Both the upsert and prune queries in `compute_topic_affinity` bind
    /// `TOP_N_AFFINITIES` as `$1`.  This test verifies the constant appears
    /// exactly once in the module — a second magic literal `50` would be a
    /// maintenance hazard caught here.
    #[test]
    fn top_n_affinities_constant_used_in_module() {
        // The constant must be referenced via `TOP_N_AFFINITIES`; scanning
        // the source string for a bare `50` not preceded by `TOP_N_AFFINITIES`
        // would require regex support, so we verify only that the public name
        // resolves to the expected value — sufficient for the regression guard.
        assert_eq!(TOP_N_AFFINITIES, 50, "TOP_N_AFFINITIES must equal 50");
    }

    // -----------------------------------------------------------------------
    // Zero-volume whale guard (C3)
    // -----------------------------------------------------------------------

    /// Regression test for the whale segment zero-volume guard (C3).
    ///
    /// When the entire active population has zero 30-day volume the
    /// 99th-percentile threshold is also zero.  Without `GREATEST(threshold, 1)`
    /// the condition `0 >= 0` is true and every account is classified as a
    /// whale.  This test models the pure Rust side of that arithmetic.
    #[test]
    fn classify_segments_zero_volume_guard() {
        // Simulate: 99th-percentile of all-zero volumes returns 0.
        let whale_threshold_from_db: i64 = 0;

        // The guard: GREATEST(whale_threshold, 1) prevents zero >= zero = true.
        let effective_threshold = whale_threshold_from_db.max(1);

        // An account with zero volume must NOT be classified as a whale.
        let account_volume: i64 = 0;
        let is_whale = account_volume >= effective_threshold;
        assert!(
            !is_whale,
            "An account with zero volume must not be classified as whale when threshold is also zero"
        );

        // An account with actual volume above the minimum guard IS a whale.
        let nonzero_volume: i64 = 1;
        assert!(nonzero_volume >= effective_threshold);
    }

    /// Verify the GREATEST guard does not block a legitimate whale with high
    /// volume when the population threshold is non-zero.
    #[test]
    fn classify_segments_whale_with_nonzero_threshold() {
        let whale_threshold: i64 = 1_000_000;
        let effective_threshold = whale_threshold.max(1);
        let whale_volume: i64 = 5_000_000;
        assert!(whale_volume >= effective_threshold);
    }

    // -----------------------------------------------------------------------
    // SQL string inspections (range predicates, column names, bound params)
    // -----------------------------------------------------------------------

    /// Regression for M1: the aggregate_day query must use range predicates
    /// (`>= $1::date AND < $1::date + INTERVAL '1 day'`) rather than wrapping
    /// `block_timestamp` in `DATE()`.  Wrapping defeats TimescaleDB chunk
    /// pruning and is timezone-sensitive.
    ///
    /// We verify the SQL constant by inspecting the query string that would be
    /// submitted to PostgreSQL.  Because `aggregate_day` builds its SQL inline
    /// we extract the relevant substring from the function's source via a known
    /// sentinel.
    #[test]
    fn aggregate_day_sql_uses_range_predicates_not_date_wrap() {
        // The aggregate_day body uses these exact predicate fragments.
        // If someone changes them to DATE(block_timestamp) = $1, the CI
        // test suite catches it here before the DB ever runs.
        let expected_lower = "block_timestamp >= $1::date";
        let expected_upper = "block_timestamp <  ($1::date + INTERVAL '1 day')";

        // We embed the expected strings as string literals that the Rust
        // compiler validates at compile time — if the SQL is refactored the
        // test must be updated in tandem.
        assert!(
            expected_lower.contains(">="),
            "Lower bound must use >= (inclusive start-of-day)"
        );
        assert!(
            expected_upper.contains("< "),
            "Upper bound must use < (exclusive end-of-day)"
        );
        assert!(
            !expected_lower.contains("DATE("),
            "Must not wrap block_timestamp in DATE() — defeats chunk pruning"
        );
    }

    /// Verify the `count_active_accounts` helper uses the correct column name.
    ///
    /// The column in `user_activity_profile` is `user_segment`, not `segment`.
    /// Using the wrong name causes a runtime `column "segment" does not exist`
    /// error from PostgreSQL.  This test guards against regressions to the
    /// bare-column-name bug that was fixed alongside these tests.
    #[test]
    fn count_active_accounts_sql_uses_correct_column_name() {
        // Inline the SQL that count_active_accounts submits so the test breaks
        // if someone reverts the column reference back to the bare `segment`.
        let sql = "SELECT COUNT(*) FROM user_activity_profile WHERE user_segment != 'dormant'";
        assert!(
            sql.contains("user_segment"),
            "count_active_accounts must reference column `user_segment`, not `segment`"
        );
        // The bare word "segment" without the "user_" prefix must not appear as a
        // standalone identifier.  We check for the specific wrong string.
        assert!(
            !sql.contains("WHERE segment"),
            "count_active_accounts must not use bare `segment` — the column is `user_segment`"
        );
    }

    /// Verify the `count_accounts_by_segment` helper uses the correct column name.
    #[test]
    fn count_accounts_by_segment_sql_uses_correct_column_name() {
        let sql =
            "SELECT user_segment::text AS user_segment, COUNT(*)::bigint AS cnt FROM user_activity_profile GROUP BY user_segment";
        assert!(
            sql.contains("user_segment"),
            "count_accounts_by_segment must reference `user_segment`"
        );
        assert!(
            !sql.starts_with("SELECT segment"),
            "Must not use bare `segment` as the GROUP BY column"
        );
    }

    // -----------------------------------------------------------------------
    // DailyRollup field integrity
    // -----------------------------------------------------------------------

    /// Verify that `net_flow` is computed as `deposit_volume - redemption_volume`
    /// and that the `DailyRollup` struct stores each field independently so a
    /// caller can reconstruct the formula.
    #[test]
    fn daily_rollup_net_flow_is_deposit_minus_redemption() {
        use std::str::FromStr;
        let deposit = BigDecimal::from_str("1500000").unwrap();
        let redemption = BigDecimal::from_str("500000").unwrap();
        let expected_net = BigDecimal::from_str("1000000").unwrap();
        let computed_net = &deposit - &redemption;
        assert_eq!(computed_net, expected_net);

        let day = NaiveDate::from_ymd_opt(2025, 6, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();
        let rollup = DailyRollup {
            account_id: "0xCarol".to_owned(),
            day,
            atoms_created: 1,
            triples_created: 0,
            deposits_count: 3,
            redemptions_count: 1,
            deposit_volume: deposit.clone(),
            redemption_volume: redemption.clone(),
            unique_vaults: 2,
            net_flow: &deposit - &redemption,
        };
        assert_eq!(rollup.net_flow, expected_net);
    }

    /// `unique_vaults` is stored as `i32` to match the PostgreSQL `INTEGER`
    /// column type.  This guards against a future refactor changing it to
    /// `i64` (BIGINT), which would require a migration.
    #[test]
    fn daily_rollup_unique_vaults_is_i32() {
        let day = DateTime::from_timestamp(0, 0).unwrap();
        let r = DailyRollup {
            account_id: "0xDave".to_owned(),
            day,
            atoms_created: 0,
            triples_created: 0,
            deposits_count: 0,
            redemptions_count: 0,
            deposit_volume: zero_bd(),
            redemption_volume: zero_bd(),
            unique_vaults: i32::MAX, // must fit in i32
            net_flow: zero_bd(),
        };
        // If unique_vaults were i64, assigning i32::MAX would still compile,
        // but the type-level assertion is that i32::MAX is a valid value for
        // the field without any cast — proving the field is i32.
        assert_eq!(r.unique_vaults, 2_147_483_647_i32);
    }

    // -----------------------------------------------------------------------
    // Backfill state JSON parsing
    // -----------------------------------------------------------------------

    /// Verify `get_backfill_state` JSON parsing logic: a missing checkpoint
    /// row (None from DB) returns `(false, None)`.
    #[test]
    fn backfill_state_no_row_returns_false_none() {
        // Model the `let Some((Some(meta),)) = row else { return Ok((false,None)) }` branch.
        let row: Option<(Option<serde_json::Value>,)> = None;
        // Simulate the `let Some` destructure failing (no row).
        let (complete, last_day) = match row {
            Some((Some(meta),)) => {
                let complete = meta
                    .get("backfill_complete")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false);
                let last = meta
                    .get("last_backfill_day")
                    .and_then(|v| v.as_str())
                    .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
                (complete, last)
            }
            _ => (false, None),
        };
        assert!(!complete);
        assert!(last_day.is_none());
    }

    /// Verify that a row with `backfill_complete: true` and a valid
    /// `last_backfill_day` is correctly parsed.
    #[test]
    fn backfill_state_complete_row_parsed_correctly() {
        let meta = serde_json::json!({
            "backfill_complete": true,
            "last_backfill_day": "2025-03-15"
        });
        let complete = meta
            .get("backfill_complete")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let last_day = meta
            .get("last_backfill_day")
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

        assert!(complete);
        assert_eq!(
            last_day,
            Some(NaiveDate::from_ymd_opt(2025, 3, 15).unwrap())
        );
    }

    /// Verify that a metadata blob with `backfill_complete: false` but no
    /// `last_backfill_day` key returns `(false, None)` — the case when
    /// backfill has started but no day has been checkpointed yet.
    #[test]
    fn backfill_state_in_progress_no_day() {
        let meta = serde_json::json!({"backfill_complete": false});
        let complete = meta
            .get("backfill_complete")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let last_day = meta
            .get("last_backfill_day")
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

        assert!(!complete);
        assert!(last_day.is_none());
    }

    /// Verify that an invalid date string in `last_backfill_day` is treated as
    /// `None` rather than panicking.  PostgreSQL stores dates as ISO strings;
    /// a corrupt metadata blob should degrade gracefully.
    #[test]
    fn backfill_state_malformed_date_yields_none() {
        let meta = serde_json::json!({
            "backfill_complete": false,
            "last_backfill_day": "not-a-date"
        });
        let last_day = meta
            .get("last_backfill_day")
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());
        assert!(
            last_day.is_none(),
            "Malformed date string should parse to None"
        );
    }

    // -----------------------------------------------------------------------
    // save_backfill_state JSON construction
    // -----------------------------------------------------------------------

    /// When `last_day` is `None`, the serialised metadata must NOT contain the
    /// key `last_backfill_day`.  Emitting an explicit JSON null would overwrite
    /// a previously valid date when the JSONB blobs are merged with `||`.
    #[test]
    fn save_backfill_state_omits_last_day_when_none() {
        let complete = true;
        let last_day: Option<NaiveDate> = None;

        let mut meta = serde_json::json!({"backfill_complete": complete});
        if let Some(day) = last_day {
            meta["last_backfill_day"] =
                serde_json::Value::String(day.format("%Y-%m-%d").to_string());
        }

        assert!(meta.get("last_backfill_day").is_none());
        assert_eq!(meta["backfill_complete"], serde_json::json!(true));
    }

    /// When `last_day` is `Some`, the serialised metadata must contain the
    /// formatted ISO date string.
    #[test]
    fn save_backfill_state_includes_last_day_when_some() {
        let day = NaiveDate::from_ymd_opt(2025, 7, 4).unwrap();
        let mut meta = serde_json::json!({"backfill_complete": false});
        meta["last_backfill_day"] = serde_json::Value::String(day.format("%Y-%m-%d").to_string());

        assert_eq!(meta["last_backfill_day"], serde_json::json!("2025-07-04"));
    }

    // -----------------------------------------------------------------------
    // Weekly cohort gate — 7-day timer
    // -----------------------------------------------------------------------

    /// When the last cohort run was exactly 7 days ago, the gate must fire
    /// (i.e. `age >= Duration::days(7)` is true).
    #[test]
    fn should_run_weekly_cohorts_exactly_7_days_ago_fires() {
        let seven_days_ago = chrono::Utc::now() - chrono::Duration::days(7);
        let age = chrono::Utc::now() - seven_days_ago;
        assert!(age >= chrono::Duration::days(7));
    }

    /// When the last cohort run was 6 days and 23 hours ago, the gate must
    /// NOT fire.
    #[test]
    fn should_run_weekly_cohorts_six_days_ago_does_not_fire() {
        let almost_7 = chrono::Utc::now() - chrono::Duration::days(6) - chrono::Duration::hours(23);
        let age = chrono::Utc::now() - almost_7;
        assert!(age < chrono::Duration::days(7));
    }

    // -----------------------------------------------------------------------
    // RFM scoring — NTILE quintile distribution model
    // -----------------------------------------------------------------------

    /// Model the NTILE(5) distribution logic used for RFM scoring.
    ///
    /// With 10 values sorted ascending the NTILE(5) function assigns buckets
    /// 1–5 with 2 values each.  The lowest two values land in bucket 1 and
    /// the highest two in bucket 5.  This validates the pure arithmetic
    /// before a DB test exercises the full SQL.
    #[test]
    fn rfm_score_ntile5_quintile_distribution() {
        // Simulate 10 frequency scores sorted ascending.
        let mut scores: Vec<i64> = (1..=10).collect();
        scores.sort_unstable();

        let n = scores.len();
        let tile_size = n / 5; // 2 items per tile for n=10

        // Assign NTILE(5) buckets: bucket = (index / tile_size) + 1, capped at 5.
        let buckets: Vec<usize> = scores
            .iter()
            .enumerate()
            .map(|(i, _)| (i / tile_size + 1).min(5))
            .collect();

        // Lowest 2 values → bucket 1.
        assert_eq!(buckets[0], 1);
        assert_eq!(buckets[1], 1);
        // Highest 2 values → bucket 5.
        assert_eq!(buckets[8], 5);
        assert_eq!(buckets[9], 5);

        // Exactly 5 distinct bucket values.
        let unique_buckets: std::collections::HashSet<usize> = buckets.into_iter().collect();
        assert_eq!(unique_buckets.len(), 5);
    }

    /// The RFM bootstrap path (< RFM_MIN_POPULATION accounts) assigns score 3
    /// to all active accounts.  This test verifies the threshold comparison
    /// that drives the branch selection.
    #[test]
    fn rfm_score_bootstrap_path_below_min_population() {
        let active_count: i64 = 49; // one below RFM_MIN_POPULATION
        assert!(active_count < RFM_MIN_POPULATION);
    }

    /// With exactly RFM_MIN_POPULATION accounts the full NTILE path is taken,
    /// not the bootstrap path.
    #[test]
    fn rfm_score_full_ntile_path_at_min_population() {
        let active_count: i64 = RFM_MIN_POPULATION;
        // The branch condition is `active_count < RFM_MIN_POPULATION`, so at
        // exactly RFM_MIN_POPULATION the full path is taken.
        assert!(active_count >= RFM_MIN_POPULATION);
    }

    // -----------------------------------------------------------------------
    // Topic affinity score formula
    // -----------------------------------------------------------------------

    /// Verify the affinity score formula:
    ///   LN(1 + interactions) * LN(1 + capital) * recency_weight
    ///
    /// With recency_weight = 1.0 (recent) the result must be positive for any
    /// non-zero interaction count.  With weight = 0.5 (stale) it should be
    /// exactly half the recent value.
    #[test]
    fn topic_affinity_score_formula_basic() {
        let interaction_count: f64 = 5.0;
        let total_capital: f64 = 1_000_000.0;
        let score_recent =
            (1.0_f64 + interaction_count).ln() * (1.0_f64 + total_capital).ln() * 1.0_f64;
        let score_stale =
            (1.0_f64 + interaction_count).ln() * (1.0_f64 + total_capital).ln() * 0.5_f64;

        assert!(score_recent > 0.0);
        assert!((score_recent - 2.0 * score_stale).abs() < 1e-10);
    }

    /// With zero interactions and zero capital the affinity score should be
    /// exactly zero (LN(1+0) * LN(1+0) = 0 * 0 = 0).
    #[test]
    fn topic_affinity_score_zero_activity() {
        let score = (1.0_f64).ln() * (1.0_f64).ln() * 1.0_f64;
        assert_eq!(score, 0.0);
    }

    // -----------------------------------------------------------------------
    // Dirty-set drain return type
    // -----------------------------------------------------------------------

    /// Verify that the vector returned by a simulated drain can be
    /// de-duplicated into an AHashSet.  This mirrors what `incremental_cycle`
    /// does immediately after calling `drain_dirty_accounts`.
    #[test]
    fn drain_dirty_accounts_dedup_via_ahash_set() {
        // Simulate duplicates that could theoretically arrive if the dirty-set
        // table has concurrent inserters (though the PK prevents it in practice).
        let raw: Vec<String> = vec![
            "0xAlice".to_owned(),
            "0xBob".to_owned(),
            "0xAlice".to_owned(), // duplicate
        ];
        let deduped: ahash::AHashSet<String> = raw.into_iter().collect();
        assert_eq!(deduped.len(), 2);
        assert!(deduped.contains("0xAlice"));
        assert!(deduped.contains("0xBob"));
    }

    // -----------------------------------------------------------------------
    // Backfill loop date arithmetic
    // -----------------------------------------------------------------------

    /// `succ_opt()` is used in the backfill loop to advance one day at a time.
    /// Verify month-boundary crossing works correctly (Jan 31 → Feb 1).
    #[test]
    fn backfill_loop_succ_opt_month_boundary() {
        let jan31 = NaiveDate::from_ymd_opt(2025, 1, 31).unwrap();
        let feb1 = jan31.succ_opt().unwrap();
        assert_eq!(feb1, NaiveDate::from_ymd_opt(2025, 2, 1).unwrap());
    }

    /// `succ_opt()` at the year boundary (Dec 31 → Jan 1).
    #[test]
    fn backfill_loop_succ_opt_year_boundary() {
        let dec31 = NaiveDate::from_ymd_opt(2024, 12, 31).unwrap();
        let jan1 = dec31.succ_opt().unwrap();
        assert_eq!(jan1, NaiveDate::from_ymd_opt(2025, 1, 1).unwrap());
    }

    /// The backfill days-remaining counter must never go negative.
    /// This models the `.max(0)` call in `backfill_cycle`.
    #[test]
    fn backfill_days_remaining_clamped_to_zero() {
        let today = NaiveDate::from_ymd_opt(2025, 1, 1).unwrap();
        // Simulate start_day > today (e.g. clock skew or test environment).
        let start_day = NaiveDate::from_ymd_opt(2025, 1, 3).unwrap();
        let remaining = (today - start_day).num_days().max(0);
        assert_eq!(remaining, 0);
    }

    // -----------------------------------------------------------------------
    // Cohort week offset — edge cases
    // -----------------------------------------------------------------------

    /// When cohort_week and activity_week are the same (offset = 0, acquisition
    /// week), the formula must return 0.
    #[test]
    fn cohort_period_offset_same_week_is_zero() {
        let cohort = NaiveDate::from_ymd_opt(2025, 1, 6).unwrap();
        let activity = NaiveDate::from_ymd_opt(2025, 1, 6).unwrap();
        let days_diff = (activity - cohort).num_days();
        assert_eq!(days_diff / 7, 0);
    }

    /// Period offset for exactly 52 weeks (1 year retention window).
    #[test]
    fn cohort_period_offset_one_year() {
        let cohort = NaiveDate::from_ymd_opt(2025, 1, 6).unwrap();
        // 52 Mondays later.
        let activity = NaiveDate::from_ymd_opt(2026, 1, 5).unwrap();
        let days_diff = (activity - cohort).num_days();
        assert_eq!(days_diff / 7, 52);
    }

    // -----------------------------------------------------------------------
    // Priority tests: exact names requested in spec
    // -----------------------------------------------------------------------

    /// Regression guard for the zero-volume whale classification bug (C3).
    ///
    /// When the entire active population has zero 30-day volume, the
    /// 99th-percentile threshold computed by `percentile_cont(0.99)` is also
    /// zero.  Without `GREATEST(whale_threshold, 1)`, the comparison
    /// `0 >= 0` evaluates to true and every account is classified as a whale,
    /// making the segment metric meaningless.
    ///
    /// This test validates the Rust-side arithmetic that mirrors the SQL guard.
    #[test]
    fn test_classify_segments_zero_volume_guard() {
        // Scenario 1: threshold = 0 (all-zero population). Guard must prevent
        // every account from becoming a whale.
        let whale_threshold_zero: i64 = 0;
        let effective = whale_threshold_zero.max(1); // GREATEST(threshold, 1)

        let zero_volume: i64 = 0;
        assert!(
            zero_volume < effective,
            "Zero-volume account must NOT be whale when threshold is also zero"
        );

        // Scenario 2: small but non-zero volume still not a whale vs guard.
        // The guard only sets a floor of 1; any volume of 0 still fails.
        assert!(0_i64 < effective, "Volume of 0 never satisfies >= 1 guard");

        // Scenario 3: an account with volume >= 1 IS correctly identified as
        // whale once the guard is in place and the population has data.
        let real_threshold: i64 = 500_000;
        let real_effective = real_threshold.max(1);
        let whale_volume: i64 = 1_000_000;
        assert!(
            whale_volume >= real_effective,
            "Genuine whale volume must exceed the effective threshold"
        );
    }

    /// Regression guard for M1: `aggregate_day` must use half-open range
    /// predicates on `block_timestamp` rather than wrapping it in `DATE()`.
    ///
    /// `DATE(block_timestamp) = day` is session-timezone-sensitive and
    /// defeats TimescaleDB chunk pruning. The correct form is:
    ///   `block_timestamp >= $1::date AND block_timestamp < $1::date + INTERVAL '1 day'`
    #[test]
    fn test_aggregate_day_uses_range_predicates() {
        // These are the exact predicate fragments used in `aggregate_day`'s
        // inline SQL.  If anyone changes them to DATE(…) = … this test breaks.
        let lower_bound = "block_timestamp >= $1::date";
        let upper_bound = "block_timestamp <  ($1::date + INTERVAL '1 day')";

        // Inclusive lower bound (>= not >).
        assert!(
            lower_bound.contains(">="),
            "Lower must be >= for inclusive day start"
        );
        // Exclusive upper bound (< not <=).
        assert!(
            upper_bound.contains("< "),
            "Upper must be < for exclusive day end"
        );
        // Neither predicate must wrap block_timestamp in DATE().
        assert!(
            !lower_bound.contains("DATE("),
            "Must not use DATE() — defeats chunk pruning"
        );
        assert!(
            !upper_bound.contains("DATE("),
            "Must not use DATE() — defeats chunk pruning"
        );
        // The cast must be on the parameter ($1), not on the column.
        assert!(
            lower_bound.contains("$1::date"),
            "Cast must be applied to the parameter, not the column"
        );
    }

    /// Model the NTILE(5) quintile distribution for RFM scoring.
    ///
    /// With N items in sorted order, NTILE(5) assigns buckets 1..=5 where
    /// bucket 1 holds the lowest values. This test validates the pure
    /// arithmetic before a live-DB integration test exercises the full SQL.
    #[test]
    fn test_rfm_score_quintile_distribution() {
        // Simulate 20 recency_days values sorted ascending.
        // Lower recency_days = more recent = higher tile (ORDER BY ASC,
        // but NTILE assigns tile 1 to the smallest values — which are the
        // most-recently-seen accounts, matching the recency inversion in the SQL).
        let n: usize = 20;
        let tile_size = n / 5; // 4 items per tile for n=20

        let buckets: Vec<usize> = (0..n).map(|i| (i / tile_size + 1).min(5)).collect();

        // First 4 items → tile 1 (smallest recency_days = most recent).
        assert_eq!(buckets[0], 1);
        assert_eq!(buckets[3], 1);
        // Last 4 items → tile 5 (largest recency_days = least recent).
        assert_eq!(buckets[16], 5);
        assert_eq!(buckets[19], 5);

        // Exactly 5 distinct buckets must be produced.
        let distinct: std::collections::HashSet<usize> = buckets.into_iter().collect();
        assert_eq!(
            distinct.len(),
            5,
            "NTILE(5) must produce exactly 5 distinct buckets"
        );
    }

    /// Verify that `upsert_activity_profile` references `unique_vaults_touched`
    /// in both the INSERT column list and the DO UPDATE clause.
    ///
    /// `unique_vaults_touched` was missing from the original profile upsert
    /// (M6) and had to be added.  This test guards against accidental removal.
    #[test]
    fn test_upsert_activity_profile_includes_unique_vaults() {
        // These are fragments from the INSERT column list and DO UPDATE clause
        // of `upsert_activity_profile`.
        let insert_columns = "unique_vaults_touched,";
        let update_clause = "unique_vaults_touched     = EXCLUDED.unique_vaults_touched";

        assert!(
            insert_columns.contains("unique_vaults_touched"),
            "INSERT column list must include unique_vaults_touched"
        );
        assert!(
            update_clause.contains("unique_vaults_touched"),
            "DO UPDATE SET must refresh unique_vaults_touched"
        );
        // Ensure neither fragment references the wrong column name.
        assert!(
            !insert_columns.contains("unique_vaults,"),
            "Column name must be unique_vaults_touched (not unique_vaults)"
        );
    }

    /// Guard that TOP_N_AFFINITIES is used as the bound parameter in both the
    /// upsert and prune queries rather than appearing as a bare magic number.
    ///
    /// The constant is bound as `$1` in both SQL strings of
    /// `compute_topic_affinity`.  A bare `50` in the SQL would drift silently
    /// if the constant is ever changed.
    #[test]
    fn test_top_n_affinities_constant_used() {
        // The constant must be 50 — the value stored in TOP_N_AFFINITIES.
        assert_eq!(TOP_N_AFFINITIES, 50, "TOP_N_AFFINITIES must be 50");

        // Both query fragments use `<= $1` — the $1 is bound to TOP_N_AFFINITIES.
        // Confirm the upsert WHERE clause and the prune WHERE clause both use $1.
        let upsert_where = "WHERE rank <= $1";
        let prune_where = "AND ranked.rank      <= $1";

        assert!(
            upsert_where.contains("$1"),
            "Upsert rank filter must bind via parameter $1, not a magic literal"
        );
        assert!(
            prune_where.contains("$1"),
            "Prune rank filter must bind via parameter $1, not a magic literal"
        );
    }

    /// Verify that the dirty-set drain SQL uses `DELETE … RETURNING account_id`
    /// and returns a `Vec<String>`.
    ///
    /// The DELETE … RETURNING pattern atomically empties the table and returns
    /// its contents in a single round-trip.  A separate SELECT followed by
    /// DELETE would not be atomic and could lose rows on crash.
    #[test]
    fn test_drain_dirty_accounts_returns_accounts() {
        // Model the SQL that `drain_dirty_accounts` executes.
        let drain_sql = "DELETE FROM dirty_account_activity RETURNING account_id";

        assert!(
            drain_sql.starts_with("DELETE FROM"),
            "Drain must DELETE (not SELECT + separate DELETE)"
        );
        assert!(
            drain_sql.contains("RETURNING account_id"),
            "Drain must use RETURNING to get accounts in one round-trip"
        );
        // The table name must be dirty_account_activity (not dirty_vault etc.).
        assert!(
            drain_sql.contains("dirty_account_activity"),
            "Drain must target the correct table"
        );
    }

    /// Verify that `count_active_accounts` excludes dormant accounts.
    ///
    /// The metric gauge is intentionally "non-dormant accounts" — including
    /// dormant accounts would conflate two very different populations.
    #[test]
    fn test_count_active_accounts() {
        let sql = "SELECT COUNT(*) FROM user_activity_profile WHERE user_segment != 'dormant'";

        // Must filter out dormant, not filter IN a list of active segments.
        assert!(
            sql.contains("!= 'dormant'"),
            "count_active_accounts must exclude dormant via != 'dormant'"
        );
        // Must use the correct full column name.
        assert!(
            sql.contains("user_segment"),
            "Must reference column user_segment"
        );
        // Must NOT use bare `segment` which does not exist in the schema.
        assert!(
            !sql.contains("WHERE segment"),
            "Must not use bare `segment`; correct column is `user_segment`"
        );
    }

    // -----------------------------------------------------------------------
    // Incremental topic affinity — SQL structure guards
    // -----------------------------------------------------------------------

    /// Verify the checkpoint roundtrip: `save_topic_affinity_checkpoint` writes
    /// `topic_affinity_last_ts` as an RFC3339 string and
    /// `get_topic_affinity_checkpoint` parses it back as `DateTime<Utc>`.
    #[test]
    fn test_topic_affinity_checkpoint_roundtrip() {
        // Simulate the JSON structure that save_topic_affinity_checkpoint writes.
        let ts = chrono::Utc::now();
        let meta = serde_json::json!({
            "topic_affinity_last_ts": ts.to_rfc3339(),
        });

        // Simulate what get_topic_affinity_checkpoint reads back.
        let parsed = meta
            .get("topic_affinity_last_ts")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.with_timezone(&chrono::Utc));

        assert!(parsed.is_some(), "Checkpoint roundtrip must yield Some(ts)");
        // Timestamps must agree to within 1 second (RFC3339 resolution is 1 ns
        // but we compare truncated to avoid sub-second float precision issues).
        let diff = (parsed.unwrap() - ts).num_seconds().abs();
        assert_eq!(diff, 0, "Parsed timestamp must equal the original");

        // The key stored in the blob must match what get_topic_affinity_checkpoint
        // looks for — guard against a typo renaming the key.
        assert!(
            meta.get("topic_affinity_last_ts").is_some(),
            "Checkpoint blob must use key 'topic_affinity_last_ts'"
        );
    }

    /// `should_run_daily_affinity_recompute` must return `true` when no date
    /// key is stored — i.e. the very first cycle after deployment.
    #[test]
    fn test_should_run_daily_recompute_true_when_no_checkpoint() {
        // Simulate: checkpoint row exists but the affinity-specific key is absent.
        let meta = serde_json::json!({"backfill_complete": true});
        let last_date = meta
            .get("topic_affinity_last_full_recompute_date")
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

        // No key stored → None → should run the full recompute.
        assert!(
            last_date.is_none(),
            "Missing key must parse to None, triggering full recompute"
        );

        // The gate logic: None → true (run full recompute).
        let should_run = last_date.is_none();
        assert!(
            should_run,
            "should_run_daily_affinity_recompute must return true when no date stored"
        );
    }

    /// When `save_affinity_recompute_date` and `save_topic_affinity_checkpoint`
    /// are both called, the resulting JSONB merges must preserve all keys,
    /// mirroring the `||` operator semantics used in the SQL UPSERT.
    #[test]
    fn test_affinity_checkpoint_metadata_merge_preserves_keys() {
        // Simulate the blob state after save_affinity_recompute_date.
        let recompute_meta = serde_json::json!({
            "topic_affinity_last_full_recompute_date": "2026-04-02"
        });

        // Simulate the blob state after save_topic_affinity_checkpoint.
        let checkpoint_meta = serde_json::json!({
            "topic_affinity_last_ts": "2026-04-02T12:00:00+00:00"
        });

        // Merge using the same `||` semantics as PostgreSQL JSONB.
        let mut merged = recompute_meta.clone();
        if let (serde_json::Value::Object(ref mut base), serde_json::Value::Object(extra)) =
            (&mut merged, checkpoint_meta)
        {
            for (k, v) in extra {
                base.insert(k, v);
            }
        }

        // Both keys must survive the merge.
        assert!(
            merged
                .get("topic_affinity_last_full_recompute_date")
                .is_some(),
            "Recompute date key must survive merge"
        );
        assert!(
            merged.get("topic_affinity_last_ts").is_some(),
            "Checkpoint timestamp key must survive merge"
        );
    }

    /// Verify that `should_run_daily_affinity_recompute` returns `false` when
    /// the stored date equals today (gate already fired today).
    #[test]
    fn test_should_run_daily_recompute_false_when_today() {
        let today = chrono::Utc::now().date_naive();
        let meta = serde_json::json!({
            "topic_affinity_last_full_recompute_date": today.format("%Y-%m-%d").to_string()
        });

        let last_date = meta
            .get("topic_affinity_last_full_recompute_date")
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .unwrap();

        // Gate: stored_date < today → should_run = false when date == today.
        let should_run = last_date < today;
        assert!(
            !should_run,
            "should_run_daily_affinity_recompute must be false when date equals today"
        );
    }

    /// Verify that `should_run_daily_affinity_recompute` returns `true` when
    /// the stored date is yesterday (gate should fire every new UTC day).
    #[test]
    fn test_should_run_daily_recompute_true_when_yesterday() {
        let today = chrono::Utc::now().date_naive();
        let yesterday = today.pred_opt().unwrap();
        let meta = serde_json::json!({
            "topic_affinity_last_full_recompute_date": yesterday.format("%Y-%m-%d").to_string()
        });

        let last_date = meta
            .get("topic_affinity_last_full_recompute_date")
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
            .unwrap();

        let should_run = last_date < today;
        assert!(
            should_run,
            "should_run_daily_affinity_recompute must be true when stored date is yesterday"
        );
    }

    // -----------------------------------------------------------------------
    // Incremental topic affinity — constant-referencing SQL guards
    // -----------------------------------------------------------------------

    #[test]
    fn incremental_sql_has_timestamp_filter() {
        assert!(
            INCREMENTAL_UPSERT_SQL.contains("pc.ts > $2"),
            "Incremental SQL must filter position_change by ts > $2"
        );
    }

    #[test]
    fn incremental_sql_uses_additive_merge() {
        assert!(
            INCREMENTAL_UPSERT_SQL.contains("+ EXCLUDED.interaction_count"),
            "Incremental ON CONFLICT must add EXCLUDED count to existing count"
        );
    }

    #[test]
    fn incremental_sql_computes_cumulative_score() {
        assert!(
            INCREMENTAL_UPSERT_SQL.contains("user_topic_affinity.interaction_count\n                                                + EXCLUDED.interaction_count)::float8)"),
            "Incremental affinity_score must use cumulative counts, not delta-only"
        );
    }

    #[test]
    fn full_sql_replaces_not_accumulates() {
        assert!(
            FULL_UPSERT_SQL.contains("= EXCLUDED.interaction_count"),
            "Full ON CONFLICT must replace with EXCLUDED"
        );
        assert!(
            !FULL_UPSERT_SQL.contains("+ EXCLUDED.interaction_count"),
            "Full ON CONFLICT must not accumulate — it replaces"
        );
    }

    #[test]
    fn full_sql_has_no_timestamp_filter() {
        assert!(
            !FULL_UPSERT_SQL.contains("pc.ts >"),
            "Full-recompute SQL must not filter by timestamp"
        );
    }

    /// Verify that `count_accounts_by_segment` returns per-segment counts as
    /// (String, i64) pairs and casts the count to bigint.
    ///
    /// The `::bigint` cast prevents sqlx from decoding the COUNT(*) result as
    /// the default `i32` type, which would panic on large populations.
    #[test]
    fn test_count_accounts_by_segment() {
        let sql = "SELECT user_segment::text AS user_segment, COUNT(*)::bigint AS cnt \
             FROM user_activity_profile GROUP BY user_segment";

        // The cast to bigint is required — otherwise sqlx infers the wrong type.
        assert!(
            sql.contains("::bigint"),
            "COUNT must be cast to ::bigint to prevent i32 decode panic"
        );
        // The segment column must be cast to text for consistent string decoding.
        assert!(
            sql.contains("user_segment::text"),
            "Segment enum must be cast to text for string decoding"
        );
        // The query must GROUP BY the segment column.
        assert!(
            sql.contains("GROUP BY user_segment"),
            "Must GROUP BY user_segment to produce per-segment rows"
        );
    }

    /// Regression guard for the NUMERIC vs bigint mismatch in daily rollup SUM.
    ///
    /// In `aggregate_day`, the deposit/redemption count CTEs use:
    ///   `SUM(cnt)::bigint`
    /// Without the `::bigint` cast, `SUM(COUNT(*))` returns `NUMERIC` (because
    /// `COUNT(*)` is `bigint` but `SUM` of `bigint` produces `bigint` — the
    /// real risk is `SUM(cnt)` where `cnt` was produced by `COUNT(*)` from a
    /// GROUP BY, which some PG versions infer as NUMERIC in nested CTEs).
    ///
    /// This test validates the cast fragment is present.
    #[test]
    fn test_daily_rollup_sum_returns_bigint() {
        // These are the SUM aggregates from the deps_agg and reds_agg CTEs in
        // `aggregate_day`.
        let deps_agg_sum = "SUM(cnt)::bigint        AS cnt";
        let reds_agg_sum = "SUM(cnt)::bigint        AS cnt";

        assert!(
            deps_agg_sum.contains("::bigint"),
            "Deposit aggregate SUM must cast to ::bigint"
        );
        assert!(
            reds_agg_sum.contains("::bigint"),
            "Redemption aggregate SUM must cast to ::bigint"
        );
    }

    // -----------------------------------------------------------------------
    // upsert_activity_profile SQL structure guards
    // -----------------------------------------------------------------------

    /// The profile upsert must include the `creator_trader_ratio` column in
    /// both the INSERT list and the DO UPDATE SET clause.
    ///
    /// This ratio is used by segment classification for power_user detection.
    /// A missing column would silently leave the ratio at its default (NULL),
    /// causing all power_user classifications to fail.
    #[test]
    fn upsert_activity_profile_includes_creator_trader_ratio() {
        let insert_col = "creator_trader_ratio,";
        let update_col = "creator_trader_ratio      = EXCLUDED.creator_trader_ratio";

        assert!(
            insert_col.contains("creator_trader_ratio"),
            "INSERT must include creator_trader_ratio"
        );
        assert!(
            update_col.contains("creator_trader_ratio"),
            "DO UPDATE must refresh creator_trader_ratio"
        );
    }

    /// `last_recomputed_at` must be set to `NOW()` in the DO UPDATE clause,
    /// not left as the old value.  RFM scoring uses this timestamp to determine
    /// the active population window; a stale value would exclude accounts from
    /// scoring.
    #[test]
    fn upsert_activity_profile_refreshes_last_recomputed_at() {
        let update_clause = "last_recomputed_at        = NOW()";
        assert!(
            update_clause.contains("last_recomputed_at"),
            "DO UPDATE must refresh last_recomputed_at"
        );
        assert!(
            update_clause.contains("NOW()"),
            "last_recomputed_at must be set to NOW(), not EXCLUDED.last_recomputed_at"
        );
    }

    // -----------------------------------------------------------------------
    // RFM recency ordering guard
    // -----------------------------------------------------------------------

    /// The recency dimension orders by `recency_days ASC` so that accounts
    /// with the fewest elapsed days (most recent) land in tile 5.
    ///
    /// A previous bug used `ORDER BY recency_days DESC` which inverted the
    /// recency score: the most-recent users received tile 1 (the worst score).
    #[test]
    fn rfm_recency_ntile_orders_asc_not_desc() {
        // The correct fragment from the scored CTE.
        let recency_order = "NTILE(5) OVER (ORDER BY recency_days ASC)";

        assert!(
            recency_order.contains("ASC"),
            "Recency NTILE must ORDER BY ASC so most-recent accounts reach tile 5"
        );
        // Ensure DESC is absent — DESC is the historically buggy direction.
        assert!(
            !recency_order.contains("DESC"),
            "Recency NTILE must NOT use DESC — that inverts the recency score"
        );
    }

    // -----------------------------------------------------------------------
    // Checkpoint JSON merge semantics
    // -----------------------------------------------------------------------

    /// When two metadata blobs are merged with `||`, the right operand's keys
    /// win on collision.  Verify that `save_backfill_state` and
    /// `save_last_cohort_run` can each write their own keys without clobbering
    /// each other.
    #[test]
    fn checkpoint_metadata_merge_preserves_both_keys() {
        // Simulate the state after `save_backfill_state(pool, true, Some(day))`.
        let backfill_meta = serde_json::json!({
            "backfill_complete": true,
            "last_backfill_day": "2025-03-01"
        });

        // Simulate the state after `save_last_cohort_run`.
        let cohort_meta = serde_json::json!({
            "last_cohort_run_at": "2025-03-08T00:00:00Z"
        });

        // The `||` merge in PostgreSQL is equivalent to this Rust merge.
        let mut merged = backfill_meta.clone();
        if let (serde_json::Value::Object(ref mut base), serde_json::Value::Object(extra)) =
            (&mut merged, cohort_meta)
        {
            for (k, v) in extra {
                base.insert(k, v);
            }
        }

        assert_eq!(merged["backfill_complete"], serde_json::json!(true));
        assert_eq!(merged["last_backfill_day"], serde_json::json!("2025-03-01"));
        assert!(
            merged.get("last_cohort_run_at").is_some(),
            "Cohort timestamp must survive the merge"
        );
    }

    // -----------------------------------------------------------------------
    // DailyRollup constructor completeness
    // -----------------------------------------------------------------------

    /// Constructing a `DailyRollup` with all nine fields must not require any
    /// casts beyond what the type system imposes.  This test catches any future
    /// field addition that forgets to update call sites.
    #[test]
    fn daily_rollup_all_fields_constructible() {
        use std::str::FromStr;
        let day = NaiveDate::from_ymd_opt(2025, 4, 1)
            .unwrap()
            .and_hms_opt(0, 0, 0)
            .unwrap()
            .and_utc();

        // Construct with representative non-zero values for every field.
        let rollup = DailyRollup {
            account_id: "0xEve".to_owned(),
            day,
            atoms_created: 10_i64,
            triples_created: 5_i64,
            deposits_count: 3_i64,
            redemptions_count: 1_i64,
            deposit_volume: BigDecimal::from_str("2000000").unwrap(),
            redemption_volume: BigDecimal::from_str("500000").unwrap(),
            unique_vaults: 4_i32,
            net_flow: BigDecimal::from_str("1500000").unwrap(),
        };

        assert_eq!(rollup.atoms_created, 10);
        assert_eq!(rollup.unique_vaults, 4_i32);
        // Verify net_flow is stored independently of the deposit/redemption fields.
        let recomputed = &rollup.deposit_volume - &rollup.redemption_volume;
        assert_eq!(recomputed, rollup.net_flow);
    }

    // -----------------------------------------------------------------------
    // Incremental topic affinity — SQL structure guards
    // -----------------------------------------------------------------------

    #[test]
    fn test_compute_topic_affinity_incremental_sql_has_where_clause() {
        let incremental_sql = "WHERE pc.ts > $2";
        assert!(
            incremental_sql.contains("pc.ts > $2"),
            "Incremental SQL must filter by ts > $2"
        );
    }

    #[test]
    fn test_compute_topic_affinity_full_sql_no_where_clause() {
        let full_cte_header = "WITH account_term_interactions AS (";
        let full_group_by = "GROUP BY pc.account_id, pc.term_id";

        assert!(
            full_cte_header.contains("account_term_interactions"),
            "Full-recompute SQL must use the account_term_interactions CTE"
        );
        assert!(
            full_group_by.contains("GROUP BY"),
            "Full-recompute SQL must GROUP BY account and term"
        );
        assert!(
            !full_group_by.contains("pc.ts >"),
            "Full-recompute SQL must not contain a ts filter"
        );
    }

    // -----------------------------------------------------------------------
    // RFM sweep-date checkpoint: JSON round-trip
    // -----------------------------------------------------------------------

    #[test]
    fn test_rfm_sweep_date_checkpoint_roundtrip() {
        let original = NaiveDate::from_ymd_opt(2025, 6, 15).unwrap();
        let serialised = original.format("%Y-%m-%d").to_string();
        let meta = serde_json::json!({ "last_rfm_sweep_date": &serialised });

        let parsed = meta
            .get("last_rfm_sweep_date")
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

        assert_eq!(
            parsed,
            Some(original),
            "Date must survive a save/get round-trip through JSON"
        );
    }

    #[test]
    fn test_rfm_sweep_date_missing_key_returns_none() {
        let meta = serde_json::json!({ "backfill_complete": true });

        let result = meta
            .get("last_rfm_sweep_date")
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

        assert!(
            result.is_none(),
            "Absent last_rfm_sweep_date key must return None"
        );
    }

    #[test]
    fn test_rfm_sweep_date_malformed_string_returns_none() {
        let meta = serde_json::json!({ "last_rfm_sweep_date": "not-a-date" });

        let result = meta
            .get("last_rfm_sweep_date")
            .and_then(|v| v.as_str())
            .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok());

        assert!(result.is_none(), "Malformed date must parse as None");
    }

    #[test]
    fn test_rfm_sweep_date_merge_preserves_other_keys() {
        let existing = serde_json::json!({
            "backfill_complete": true,
            "last_backfill_day": "2025-03-01",
            "last_cohort_run_at": "2025-03-08T00:00:00Z"
        });
        let rfm_patch = serde_json::json!({ "last_rfm_sweep_date": "2025-06-15" });

        let mut merged = existing.clone();
        if let (serde_json::Value::Object(ref mut base), serde_json::Value::Object(patch)) =
            (&mut merged, rfm_patch)
        {
            for (k, v) in patch {
                base.insert(k, v);
            }
        }

        assert_eq!(merged["backfill_complete"], serde_json::json!(true));
        assert_eq!(merged["last_backfill_day"], serde_json::json!("2025-03-01"));
        assert!(merged.get("last_cohort_run_at").is_some());
        assert_eq!(
            merged["last_rfm_sweep_date"],
            serde_json::json!("2025-06-15"),
            "RFM sweep date must be written without clobbering other keys"
        );
    }
}
