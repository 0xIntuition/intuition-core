use std::collections::HashMap;

use serde_json::Value;
use shared::models::{StoredEvent, TripleCreatedRecord};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;

use crate::error::ProjectionError;
use crate::projection::{datetime_value, get_str, Projection};
use crate::sink::{RecordId, SinkOperation};

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Projection for the `TripleCreated` event.
///
/// Produces three upsert operations per event:
/// 1. Account node for the creator address.
/// 2. Vault node keyed by `term_id`.
/// 3. Triple node keyed by `term_id`, linking subject/predicate/object atoms.
pub struct TripleProjection;

impl Projection for TripleProjection {
    fn event_types(&self) -> &'static [EventType] {
        &[EventType::TripleCreated]
    }

    fn name(&self) -> &str {
        "triple"
    }

    /// Transform a `TripleCreated` event into sink operations.
    ///
    /// Delegates to `project_parsed` via `parse_or_unknown` so that both code
    /// paths share the same logic and parity tests always pass.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::MissingField` if any required field is absent
    /// from `event.event_data`.
    fn project(&self, event: &StoredEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        let (parsed, _) = ParsedEvent::parse_or_unknown(event.clone());
        self.project_parsed(&parsed)
    }

    /// Typed event path — no JSON re-parsing.
    ///
    /// Matches on `ParsedEvent::TripleCreated` and builds sink operations
    /// directly from the typed `TripleCreatedRecord` fields.
    fn project_parsed(&self, event: &ParsedEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        match event {
            ParsedEvent::TripleCreated { metadata, data } => Ok(build_triple_ops(metadata, data)),
            // TripleCreated that failed typed parse falls back to raw extraction.
            ParsedEvent::Unknown(raw) if raw.event_type == "TripleCreated" => {
                let creator = get_str(&raw.event_data, "creator")?;
                let term_id = get_str(&raw.event_data, "term_id")?;
                let subject_id = get_str(&raw.event_data, "subject_id")?;
                let predicate_id = get_str(&raw.event_data, "predicate_id")?;
                let object_id = get_str(&raw.event_data, "object_id")?;
                let ts = datetime_value(&raw.block_timestamp);
                Ok(build_raw_triple_ops(
                    creator,
                    term_id,
                    subject_id,
                    predicate_id,
                    object_id,
                    ts,
                ))
            }
            _ => Ok(vec![]),
        }
    }

    #[inline]
    fn uses_typed_events(&self) -> bool {
        true
    }
}

/// Build the three triple sink operations from typed record fields.
fn build_triple_ops(metadata: &EventMetadata, data: &TripleCreatedRecord) -> Vec<SinkOperation> {
    let creator = data.creator.as_str();
    // All ID fields are hex strings in the typed record — use them directly.
    let ts = datetime_value(&metadata.block_timestamp);

    build_raw_triple_ops(
        creator,
        &data.term_id,
        &data.subject_id,
        &data.predicate_id,
        &data.object_id,
        ts,
    )
}

/// Build the three triple sink operations from raw string fields.
///
/// Shared between the typed path, the Unknown-fallback path, and the
/// `core_entities` dual-write projection which must produce identical ops.
pub(crate) fn build_raw_triple_ops(
    creator: &str,
    term_id: &str,
    subject_id: &str,
    predicate_id: &str,
    object_id: &str,
    ts: Value,
) -> Vec<SinkOperation> {
    // account:[creator]
    let account_op = SinkOperation::UpsertNode {
        id: RecordId::new("account", creator),
        fields: HashMap::from([
            ("address".to_owned(), Value::String(creator.to_owned())),
            ("onchain".to_owned(), Value::Bool(true)),
            ("updatedAt".to_owned(), ts.clone()),
        ]),
    };

    // vault:[term_id]
    let vault_op = SinkOperation::UpsertNode {
        id: RecordId::new("vault", term_id),
        fields: HashMap::from([
            ("createdBy".to_owned(), Value::String(creator.to_owned())),
            ("onchain".to_owned(), Value::Bool(true)),
            ("updatedAt".to_owned(), ts.clone()),
        ]),
    };

    // triple:[term_id] — reconcile any draft with the same SPO, then UPSERT.
    let triple_op = SinkOperation::ReconcileTripleDraft {
        id: RecordId::new("triple", term_id),
        subject: subject_id.to_owned(),
        predicate: predicate_id.to_owned(),
        object: object_id.to_owned(),
        fields: HashMap::from([
            ("subject".to_owned(), Value::String(subject_id.to_owned())),
            (
                "predicate".to_owned(),
                Value::String(predicate_id.to_owned()),
            ),
            ("object".to_owned(), Value::String(object_id.to_owned())),
            ("createdBy".to_owned(), Value::String(creator.to_owned())),
            ("onchain".to_owned(), Value::Bool(true)),
            ("updatedAt".to_owned(), ts),
            ("vault".to_owned(), Value::String(term_id.to_owned())),
        ]),
    };

    vec![account_op, vault_op, triple_op]
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Utc;
    use serde_json::json;

    #[cfg(test)]
    use crate::projection::test_parity::assert_surreal_projection_parity;

    /// Encode `n` as a 0x-prefixed 64-nibble hex string (bytes32 format).
    fn hex_id(n: u64) -> String {
        format!("0x{:064x}", n)
    }

    fn make_event(event_data: Value) -> StoredEvent {
        StoredEvent {
            sequence_number: 2,
            block_number: 200,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 1,
            event_type: "TripleCreated".to_owned(),
            event_data,
            term_id: Some(hex_id(99)),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn project_emits_three_ops() {
        let proj = TripleProjection;
        let event = make_event(json!({
            "creator":      "0xCreator",
            "term_id":      hex_id(99),
            "subject_id":   hex_id(1),
            "predicate_id": hex_id(2),
            "object_id":    hex_id(3)
        }));

        let ops = proj.project(&event).expect("projection must succeed");
        assert_eq!(ops.len(), 3);
    }

    #[test]
    fn project_account_node_has_timestamps() {
        let proj = TripleProjection;
        let event = make_event(json!({
            "creator":      "0xAlice",
            "term_id":      hex_id(99),
            "subject_id":   hex_id(1),
            "predicate_id": hex_id(2),
            "object_id":    hex_id(3)
        }));

        let ops = proj.project(&event).unwrap();
        let SinkOperation::UpsertNode { id, fields } = &ops[0] else {
            panic!("expected UpsertNode");
        };
        assert_eq!(id.table, "account");
        assert_eq!(id.id, "0xAlice");
        assert_eq!(fields["address"], json!("0xAlice"));
        assert_eq!(fields["onchain"], Value::Bool(true));
        assert_eq!(
            fields["updatedAt"],
            crate::projection::datetime_value(&event.block_timestamp)
        );
    }

    #[test]
    fn project_vault_node_has_timestamps() {
        let proj = TripleProjection;
        let event = make_event(json!({
            "creator":      "0xAlice",
            "term_id":      hex_id(99),
            "subject_id":   hex_id(1),
            "predicate_id": hex_id(2),
            "object_id":    hex_id(3)
        }));

        let ops = proj.project(&event).unwrap();
        let SinkOperation::UpsertNode { id, fields } = &ops[1] else {
            panic!("expected UpsertNode");
        };
        assert_eq!(id.table, "vault");
        assert_eq!(id.id, hex_id(99));
        assert_eq!(fields["createdBy"], json!("0xAlice"));
        assert_eq!(fields["onchain"], Value::Bool(true));
        assert_eq!(
            fields["updatedAt"],
            crate::projection::datetime_value(&event.block_timestamp)
        );
    }

    #[test]
    fn project_triple_node_fields() {
        let proj = TripleProjection;
        let event = make_event(json!({
            "creator":      "0xCreator",
            "term_id":      hex_id(99),
            "subject_id":   hex_id(10),
            "predicate_id": hex_id(20),
            "object_id":    hex_id(30)
        }));

        let ops = proj.project(&event).unwrap();
        let SinkOperation::ReconcileTripleDraft {
            id,
            subject,
            predicate,
            object,
            fields,
        } = &ops[2]
        else {
            panic!("expected ReconcileTripleDraft, got {:?}", ops[2]);
        };
        assert_eq!(id.table, "triple");
        assert_eq!(id.id, hex_id(99));
        assert_eq!(*subject, hex_id(10));
        assert_eq!(*predicate, hex_id(20));
        assert_eq!(*object, hex_id(30));
        assert_eq!(fields["subject"], json!(hex_id(10)));
        assert_eq!(fields["predicate"], json!(hex_id(20)));
        assert_eq!(fields["object"], json!(hex_id(30)));
        assert_eq!(fields["createdBy"], json!("0xCreator"));
        assert_eq!(fields["vault"], json!(hex_id(99)));
        assert_eq!(fields["onchain"], Value::Bool(true));
        assert_eq!(
            fields["updatedAt"],
            crate::projection::datetime_value(&event.block_timestamp)
        );
    }

    #[test]
    fn project_missing_predicate_returns_error() {
        let proj = TripleProjection;
        let event = make_event(json!({
            "creator":    "0xCreator",
            "term_id":    hex_id(99),
            "subject_id": hex_id(1),
            "object_id":  hex_id(3)
        }));

        let err = proj.project(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "predicate_id"));
    }

    // -------------------------------------------------------------------------
    // Typed-path tests
    // -------------------------------------------------------------------------

    /// Build a complete `StoredEvent` whose `event_data` satisfies all fields
    /// required by `TripleCreatedRecord` for serde deserialization.
    fn make_complete_event() -> StoredEvent {
        StoredEvent {
            sequence_number: 2,
            block_number: 200,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 1,
            event_type: "TripleCreated".to_owned(),
            event_data: json!({
                "block_number":    200,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash":      "0xblockhash",
                "transaction_hash":"0xtxhash",
                "log_index":       1,
                "creator":         "0xCreator",
                "term_id":         hex_id(99),
                "subject_id":      hex_id(10),
                "predicate_id":    hex_id(20),
                "object_id":       hex_id(30)
            }),
            term_id: Some(hex_id(99)),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn project_parsed_emits_ops_for_triple_created() {
        let proj = TripleProjection;
        let event = make_complete_event();
        let (parsed, err) = ParsedEvent::parse_or_unknown(event);
        assert!(err.is_none(), "parse must succeed: {:?}", err);

        let ops = proj
            .project_parsed(&parsed)
            .expect("typed path must succeed");
        assert_eq!(ops.len(), 3, "typed path must emit 3 ops");
    }

    #[test]
    fn project_parsed_unknown_variant_returns_empty_ops() {
        let proj = TripleProjection;
        let other_event = StoredEvent {
            sequence_number: 99,
            block_number: 1,
            block_timestamp: Utc::now(),
            block_hash: "0xhash".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "SomeOtherEvent".to_owned(),
            event_data: json!({}),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        };
        let (parsed, _) = ParsedEvent::parse_or_unknown(other_event);
        let ops = proj.project_parsed(&parsed).expect("must not error");
        assert!(ops.is_empty(), "unrelated events must produce no ops");
    }

    /// Build a boundary `TripleCreated` event whose IDs are the max bytes32
    /// value.  Exercises the hex string path at the upper end of the on-chain
    /// range to confirm typed/raw parity holds for all 64-nibble hex values.
    fn make_boundary_event() -> StoredEvent {
        const MAX_BYTES32_HEX: &str =
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        StoredEvent {
            sequence_number: 3,
            block_number: 999_999,
            block_timestamp: Utc::now(),
            block_hash: "0xboundaryblock".to_owned(),
            transaction_hash: "0xboundarytx".to_owned(),
            log_index: 0,
            event_type: "TripleCreated".to_owned(),
            event_data: json!({
                "block_number":    999_999,
                "block_timestamp": "2024-12-31T23:59:59Z",
                "block_hash":      "0xboundaryblock",
                "transaction_hash":"0xboundarytx",
                "log_index":       0,
                "creator":         "0x0000000000000000000000000000000000000000",
                "term_id":         MAX_BYTES32_HEX,
                "subject_id":      MAX_BYTES32_HEX,
                "predicate_id":    MAX_BYTES32_HEX,
                "object_id":       MAX_BYTES32_HEX
            }),
            term_id: Some(MAX_BYTES32_HEX.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn project_parsed_matches_project_for_triple_created() {
        use crate::projection::test_parity::make_unrelated_unknown_event;
        let proj = TripleProjection;
        // Three-slice parity: happy path, boundary (max u256 IDs),
        // and an unrelated Unknown event that must produce empty ops
        // on both the raw and typed paths.
        assert_surreal_projection_parity(
            &proj,
            &[
                make_complete_event(),
                make_boundary_event(),
                make_unrelated_unknown_event(99),
            ],
        );
    }

    #[test]
    fn uses_typed_events_is_true() {
        assert!(TripleProjection.uses_typed_events());
    }
}
