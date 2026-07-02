//! Repository for the `projection_dead_letter` table.
//!
//! When a projection encounters an `ErrorClass::Fatal` error on a specific
//! event, the worker calls [`record_fatal`] to persist the offending event
//! to this table *before* returning the `Err` that pins the checkpoint.
//!
//! Operators can then inspect the entry, fix the projection code, mark the
//! row resolved (or delete it), and replay the unchanged checkpoint.
//!
//! # Idempotency
//!
//! The unique constraint `(projection_name, sequence_number)` prevents
//! duplicate inserts when the worker retries the same fatal event before
//! noticing the dead-letter write succeeded.  `ON CONFLICT DO NOTHING`
//! makes [`record_fatal`] safe to call repeatedly with the same payload.

use serde_json::Value;
use shared::parsed_event::ParsedEvent;
use shared::types::SequenceNumber;
use sqlx::PgPool;
use tracing::error;

use crate::error::ProjectionError;

/// Persist a fatally-failed [`ParsedEvent`] to `projection_dead_letter`.
///
/// Convenience wrapper around [`record_fatal`] that extracts the required
/// metadata (sequence number, block number, log index, transaction hash,
/// event type) from a `ParsedEvent` and re-serialises the typed data back
/// into `serde_json::Value` so the row can be replayed against a fixed
/// projection later.
///
/// This helper is the one projection error paths should call — the
/// low-level [`record_fatal`] is kept public for callers that already have
/// the individual fields unpacked.
///
/// On record-insert failure we log at `error!` level but do **not**
/// propagate the insert error to the caller — the caller is in the middle
/// of a fatal-error flow, and suppressing that original error in favour of
/// a transient DB error would mask the actual problem.  The metric
/// [`crate::metrics::record_dead_letter`] is still incremented so
/// dashboards surface that a fatal event was seen even if the dead-letter
/// write itself failed.
pub async fn record_fatal_event(
    pool: &PgPool,
    projection_name: &str,
    event: &ParsedEvent,
    err: &ProjectionError,
) {
    let error_class = format!("{:?}", err.classify());
    let error_message = err.to_string();
    let event_type = event.event_type().to_owned();

    // Re-serialise the typed event back to its `StoredEvent` form so we
    // can read `event_data` / `block_number` / `log_index` / `tx_hash` in
    // one place regardless of whether the input was typed or `Unknown`.
    let stored = match event.as_stored_event() {
        Ok(s) => s,
        Err(serialise_err) => {
            error!(
                projection = projection_name,
                sequence = event.sequence_number(),
                event_type = %event_type,
                serialise_err = %serialise_err,
                "record_fatal_event: failed to re-serialise event; skipping dead-letter insert"
            );
            crate::metrics::record_dead_letter(projection_name, &event_type);
            return;
        }
    };

    crate::metrics::record_dead_letter(projection_name, &event_type);

    if let Err(insert_err) = record_fatal(
        pool,
        projection_name,
        stored.sequence_number,
        &event_type,
        &error_class,
        &error_message,
        &stored.event_data,
        stored.block_number,
        stored.log_index,
        &stored.transaction_hash,
    )
    .await
    {
        error!(
            projection = projection_name,
            sequence = stored.sequence_number,
            event_type = %event_type,
            insert_err = %insert_err,
            original_err = %error_message,
            "record_fatal_event: dead-letter insert failed; continuing to propagate original error"
        );
    }
}

/// Low-level helper — prefer [`record_fatal_event`] unless you already
/// have the individual fields unpacked.
///
/// Inserts one row into `projection_dead_letter` using `ON CONFLICT DO
/// NOTHING`, making it safe to call repeatedly for the same `(projection_name,
/// sequence_number)` pair.
///
/// # Errors
///
/// Returns [`ProjectionError::Database`] if the underlying `sqlx::query`
/// fails (e.g. because the database is unreachable).  Callers in the
/// worker error path should treat this as transient and fall back to
/// their own retry/backoff logic so the dead-letter system itself never
/// silently drops a fatal event.
#[allow(clippy::too_many_arguments)]
pub async fn record_fatal(
    pool: &PgPool,
    projection_name: &str,
    sequence_number: SequenceNumber,
    event_type: &str,
    error_class: &str,
    error_message: &str,
    event_data: &Value,
    block_number: i64,
    log_index: i32,
    tx_hash: &str,
) -> Result<(), ProjectionError> {
    sqlx::query(
        r#"
        INSERT INTO projection_dead_letter (
            projection_name,
            sequence_number,
            event_type,
            error_class,
            error_message,
            event_data,
            block_number,
            log_index,
            tx_hash
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (projection_name, sequence_number) DO NOTHING
        "#,
    )
    .bind(projection_name)
    .bind(sequence_number)
    .bind(event_type)
    .bind(error_class)
    .bind(error_message)
    .bind(event_data)
    .bind(block_number)
    .bind(log_index)
    .bind(tx_hash)
    .execute(pool)
    .await?;

    Ok(())
}
