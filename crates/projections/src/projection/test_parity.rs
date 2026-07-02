//! Parity test helper for SurrealDB projections.
//!
//! Verifies that the raw event path (`project`) and the typed event path
//! (`project_parsed`) produce identical [`SinkOperation`] sequences for the
//! same event.  If a projection migrates to override `project_parsed` without
//! keeping it in sync with `project`, this helper will catch the divergence.

use chrono::Utc;
use serde_json::json;
use shared::models::StoredEvent;
use shared::parsed_event::ParsedEvent;

use crate::projection::traits::Projection;

/// Assert that `proj.project(event)` and `proj.project_parsed(parsed_event)`
/// produce identical sink operations for every event in `events`.
///
/// # Panics
///
/// Panics (via `assert_eq!`) when the raw and typed paths diverge.
///
/// # Arguments
///
/// * `proj` - Any type implementing [`Projection`]
/// * `events` - Slice of raw events to test against
pub(crate) fn assert_surreal_projection_parity<P: Projection>(proj: &P, events: &[StoredEvent]) {
    for event in events {
        let raw_ops = proj.project(event).expect("raw path must not error");
        let (parsed, _) = ParsedEvent::parse_or_unknown(event.clone());
        let typed_ops = proj
            .project_parsed(&parsed)
            .expect("typed path must not error");
        assert_eq!(
            raw_ops, typed_ops,
            "Surreal projection parity mismatch for event seq={} type={}",
            event.sequence_number, event.event_type
        );
    }
}

/// Build a `StoredEvent` with an event type the projection does not handle.
///
/// `parse_or_unknown` will return `ParsedEvent::Unknown(raw)`, and any
/// projection that does not match that event_type should return an empty
/// op list on both the raw and typed paths.
///
/// Used in the "three-slice" parity test: happy / boundary / unknown.
pub(crate) fn make_unrelated_unknown_event(sequence: i64) -> StoredEvent {
    StoredEvent {
        sequence_number: sequence,
        block_number: 1,
        block_timestamp: Utc::now(),
        block_hash: "0xunknownblock".to_owned(),
        transaction_hash: "0xunknowntx".to_owned(),
        log_index: 0,
        // A synthetic event type no projection in this crate handles — so
        // both the raw and typed paths must return `Ok(vec![])`.
        event_type: "SomeUnhandledEvent".to_owned(),
        event_data: json!({ "unrelated": true }),
        term_id: None,
        entity_id: None,
        is_canonical: true,
        ingested_at: Utc::now(),
    }
}
