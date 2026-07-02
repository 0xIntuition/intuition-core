use std::collections::HashMap;

use serde_json::Value;
use shared::models::{ProtocolFeeAccruedRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;

use crate::error::ProjectionError;
use crate::projection::{get_str, Projection};
use crate::sink::{RecordId, SinkOperation};

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Projection for the `ProtocolFeeAccrued` event.
///
/// Produces a single account node upsert that ensures the fee-paying address
/// exists in the graph.  Further aggregation (e.g. lifetime fees paid) can
/// be layered on top later without a full re-index by replaying this event.
pub struct FeeProjection;

impl Projection for FeeProjection {
    fn event_types(&self) -> &'static [EventType] {
        &[EventType::ProtocolFeeAccrued]
    }

    fn name(&self) -> &str {
        "fee"
    }

    /// Transform a `ProtocolFeeAccrued` event into sink operations.
    ///
    /// Delegates to `project_parsed` via `parse_or_unknown` so that both code
    /// paths share the same logic and parity tests always pass.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::MissingField` if `sender` is absent
    /// from `event.event_data`.
    fn project(&self, event: &StoredEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        let (parsed, _) = ParsedEvent::parse_or_unknown(event.clone());
        self.project_parsed(&parsed)
    }

    /// Typed event path — no JSON re-parsing.
    ///
    /// Matches on `ParsedEvent::ProtocolFeeAccrued` and builds the account
    /// upsert directly from the typed `ProtocolFeeAccruedRecord` fields.
    fn project_parsed(&self, event: &ParsedEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        match event {
            ParsedEvent::ProtocolFeeAccrued { metadata, data } => Ok(build_fee_ops(metadata, data)),
            // ProtocolFeeAccrued that failed typed parse falls back to raw extraction.
            ParsedEvent::Unknown(raw) if raw.event_type == "ProtocolFeeAccrued" => {
                let sender = get_str(&raw.event_data, "sender")?;
                Ok(vec![build_account_op(sender)])
            }
            _ => Ok(vec![]),
        }
    }

    #[inline]
    fn uses_typed_events(&self) -> bool {
        true
    }
}

/// Build the single account upsert from typed record fields.
fn build_fee_ops(_metadata: &EventMetadata, data: &ProtocolFeeAccruedRecord) -> Vec<SinkOperation> {
    vec![build_account_op(data.sender.as_str())]
}

/// Build the `account:[sender]` upsert from a raw address string.
fn build_account_op(sender: &str) -> SinkOperation {
    SinkOperation::UpsertNode {
        id: RecordId::new("account", sender),
        fields: HashMap::from([("address".to_owned(), Value::String(sender.to_owned()))]),
    }
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

    fn make_event(event_data: Value) -> StoredEvent {
        StoredEvent {
            sequence_number: 40,
            block_number: 800,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xfeetx".to_owned(),
            log_index: 0,
            event_type: "ProtocolFeeAccrued".to_owned(),
            event_data,
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    fn typical_event() -> StoredEvent {
        make_event(json!({
            "epoch":  "12",
            "sender": "0xProtocolFeeRecipient",
            "amount": "50000"
        }))
    }

    #[test]
    fn project_emits_one_op() {
        let proj = FeeProjection;
        let ops = proj.project(&typical_event()).unwrap();
        assert_eq!(ops.len(), 1);
    }

    #[test]
    fn project_account_node_has_address() {
        let proj = FeeProjection;
        let ops = proj.project(&typical_event()).unwrap();
        let SinkOperation::UpsertNode { id, fields } = &ops[0] else {
            panic!("expected UpsertNode");
        };
        assert_eq!(id.table, "account");
        assert_eq!(id.id, "0xProtocolFeeRecipient");
        assert_eq!(fields["address"], json!("0xProtocolFeeRecipient"));
    }

    #[test]
    fn project_missing_sender_returns_error() {
        let proj = FeeProjection;
        let event = make_event(json!({
            "epoch":  "12",
            "amount": "50000"
        }));
        let err = proj.project(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "sender"));
    }

    #[test]
    fn project_event_types_is_protocol_fee_accrued() {
        assert_eq!(
            FeeProjection.event_types(),
            &[EventType::ProtocolFeeAccrued]
        );
    }

    #[test]
    fn projection_name_is_fee() {
        assert_eq!(FeeProjection.name(), "fee");
    }

    // -------------------------------------------------------------------------
    // Typed-path tests
    // -------------------------------------------------------------------------

    /// Build a complete `StoredEvent` whose `event_data` satisfies all fields
    /// required by `ProtocolFeeAccruedRecord` for serde deserialization.
    fn make_complete_event() -> StoredEvent {
        StoredEvent {
            sequence_number: 40,
            block_number: 800,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xfeetx".to_owned(),
            log_index: 0,
            event_type: "ProtocolFeeAccrued".to_owned(),
            event_data: json!({
                "block_number":     800,
                "block_timestamp":  "2024-01-01T00:00:00Z",
                "block_hash":       "0xblockhash",
                "transaction_hash": "0xfeetx",
                "log_index":        0,
                "epoch":            "12",
                "sender":           "0xProtocolFeeRecipient",
                "amount":           "50000"
            }),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn project_parsed_emits_ops_for_protocol_fee_accrued() {
        let proj = FeeProjection;
        let (parsed, err) = ParsedEvent::parse_or_unknown(make_complete_event());
        assert!(err.is_none(), "parse must succeed: {:?}", err);

        let ops = proj
            .project_parsed(&parsed)
            .expect("typed path must succeed");
        assert_eq!(ops.len(), 1, "typed path must emit 1 op");
    }

    #[test]
    fn project_parsed_unknown_variant_returns_empty_ops() {
        let proj = FeeProjection;
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

    /// Build a boundary `ProtocolFeeAccrued` event whose `epoch` and
    /// `amount` are at the max u256 value — catches serialization drift
    /// between `BigDecimal::to_string()` and raw `get_str()`.
    fn make_boundary_event() -> StoredEvent {
        const MAX_U256: &str =
            "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        StoredEvent {
            sequence_number: 41,
            block_number: 999_999,
            block_timestamp: Utc::now(),
            block_hash: "0xboundaryblock".to_owned(),
            transaction_hash: "0xboundarytx".to_owned(),
            log_index: 0,
            event_type: "ProtocolFeeAccrued".to_owned(),
            event_data: json!({
                "block_number":     999_999,
                "block_timestamp":  "2024-12-31T23:59:59Z",
                "block_hash":       "0xboundaryblock",
                "transaction_hash": "0xboundarytx",
                "log_index":        0,
                "epoch":            MAX_U256,
                "sender":           "0x0000000000000000000000000000000000000000",
                "amount":           MAX_U256
            }),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn project_parsed_matches_project_for_protocol_fee_accrued() {
        use crate::projection::test_parity::make_unrelated_unknown_event;
        // Three-slice parity: happy path, boundary (max u256), Unknown.
        assert_surreal_projection_parity(
            &FeeProjection,
            &[
                make_complete_event(),
                make_boundary_event(),
                make_unrelated_unknown_event(99),
            ],
        );
    }

    #[test]
    fn uses_typed_events_is_true() {
        assert!(FeeProjection.uses_typed_events());
    }
}
