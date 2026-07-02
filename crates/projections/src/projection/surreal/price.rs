use std::collections::HashMap;

use serde_json::Value;
use shared::models::{SharePriceChangedRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;

use crate::error::ProjectionError;
use crate::projection::{get_str, Projection};
use crate::sink::{RecordId, SinkOperation};

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Projection for the `SharePriceChanged` event.
///
/// Produces a single vault node update with the latest share price.
/// The price is stored as a string to preserve full numeric precision
/// — consumers that require arithmetic should parse it accordingly.
pub struct PriceProjection;

impl Projection for PriceProjection {
    fn event_types(&self) -> &'static [EventType] {
        &[EventType::SharePriceChanged]
    }

    fn name(&self) -> &str {
        "price"
    }

    /// Transform a `SharePriceChanged` event into sink operations.
    ///
    /// Delegates to `project_parsed` via `parse_or_unknown` so that both code
    /// paths share the same logic and parity tests always pass.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::MissingField` if `term_id` or `share_price`
    /// is absent from `event.event_data`.
    fn project(&self, event: &StoredEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        let (parsed, _) = ParsedEvent::parse_or_unknown(event.clone());
        self.project_parsed(&parsed)
    }

    /// Typed event path — no JSON re-parsing.
    ///
    /// Matches on `ParsedEvent::SharePriceChanged` and builds the vault upsert
    /// directly from the typed `SharePriceChangedRecord` fields.
    fn project_parsed(&self, event: &ParsedEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        match event {
            ParsedEvent::SharePriceChanged { metadata, data } => {
                Ok(build_price_ops(metadata, data))
            }
            // SharePriceChanged that failed typed parse falls back to raw extraction.
            ParsedEvent::Unknown(raw) if raw.event_type == "SharePriceChanged" => {
                let term_id = get_str(&raw.event_data, "term_id")?;
                let share_price = get_str(&raw.event_data, "share_price")?;
                Ok(vec![build_vault_price_op(term_id, share_price)])
            }
            _ => Ok(vec![]),
        }
    }

    #[inline]
    fn uses_typed_events(&self) -> bool {
        true
    }
}

/// Build the single price vault upsert from typed record fields.
fn build_price_ops(
    _metadata: &EventMetadata,
    data: &SharePriceChangedRecord,
) -> Vec<SinkOperation> {
    // term_id is already a hex string — borrow directly.
    // share_price is BigDecimal; to_string() produces the numeric string.
    let share_price = data.share_price.to_string();
    vec![build_vault_price_op(&data.term_id, &share_price)]
}

/// Build the single `vault:[term_id]` price upsert from raw string fields.
fn build_vault_price_op(term_id: &str, share_price: &str) -> SinkOperation {
    SinkOperation::UpsertNode {
        id: RecordId::new("vault", term_id),
        fields: HashMap::from([("price".to_owned(), Value::String(share_price.to_owned()))]),
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

    /// `0x000...000f` — term id 15 in bytes32 hex format.
    const HEX_15: &str = "0x000000000000000000000000000000000000000000000000000000000000000f";

    fn make_event(event_data: Value) -> StoredEvent {
        StoredEvent {
            sequence_number: 30,
            block_number: 700,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xpricetx".to_owned(),
            log_index: 0,
            event_type: "SharePriceChanged".to_owned(),
            event_data,
            term_id: Some(HEX_15.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    fn typical_event() -> StoredEvent {
        make_event(json!({
            "term_id":      HEX_15,
            "curve_id":     "1",
            "share_price":  "1050000000000000000",
            "total_assets": "5000000000000000000",
            "total_shares": "4761904761904761904",
            "vault_type":   1
        }))
    }

    #[test]
    fn project_emits_one_op() {
        let proj = PriceProjection;
        let ops = proj.project(&typical_event()).unwrap();
        assert_eq!(ops.len(), 1);
    }

    #[test]
    fn project_vault_node_has_price() {
        let proj = PriceProjection;
        let ops = proj.project(&typical_event()).unwrap();
        let SinkOperation::UpsertNode { id, fields } = &ops[0] else {
            panic!("expected UpsertNode");
        };
        assert_eq!(id.table, "vault");
        assert_eq!(id.id, HEX_15);
        assert_eq!(fields["price"], json!("1050000000000000000"));
    }

    #[test]
    fn project_missing_term_id_returns_error() {
        let proj = PriceProjection;
        let event = make_event(json!({
            "share_price": "1050000000000000000"
        }));
        let err = proj.project(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "term_id"));
    }

    #[test]
    fn project_missing_share_price_returns_error() {
        let proj = PriceProjection;
        let event = make_event(json!({
            "term_id": HEX_15
        }));
        let err = proj.project(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "share_price"));
    }

    // -------------------------------------------------------------------------
    // Typed-path tests
    // -------------------------------------------------------------------------

    /// Build a complete `StoredEvent` whose `event_data` satisfies all fields
    /// required by `SharePriceChangedRecord` for serde deserialization.
    fn make_complete_event() -> StoredEvent {
        StoredEvent {
            sequence_number: 30,
            block_number: 700,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xpricetx".to_owned(),
            log_index: 0,
            event_type: "SharePriceChanged".to_owned(),
            event_data: json!({
                "block_number":     700,
                "block_timestamp":  "2024-01-01T00:00:00Z",
                "block_hash":       "0xblockhash",
                "transaction_hash": "0xpricetx",
                "log_index":        0,
                "term_id":          HEX_15,
                "curve_id":         "1",
                "share_price":      "1050000000000000000",
                "total_assets":     "5000000000000000000",
                "total_shares":     "4761904761904761904",
                "vault_type":       1
            }),
            term_id: Some(HEX_15.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn project_parsed_emits_ops_for_share_price_changed() {
        let proj = PriceProjection;
        let (parsed, err) = ParsedEvent::parse_or_unknown(make_complete_event());
        assert!(err.is_none(), "parse must succeed: {:?}", err);

        let ops = proj
            .project_parsed(&parsed)
            .expect("typed path must succeed");
        assert_eq!(ops.len(), 1, "typed path must emit 1 op");
    }

    #[test]
    fn project_parsed_unknown_variant_returns_empty_ops() {
        let proj = PriceProjection;
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

    /// Build a boundary `SharePriceChanged` event whose `term_id` is the max
    /// bytes32 hex value, and whose numeric fields are at the max u256 value —
    /// catches serialization drift between `BigDecimal::to_string()` and raw
    /// `get_str()`.
    fn make_boundary_event() -> StoredEvent {
        const MAX_BYTES32_HEX: &str =
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        const MAX_U256: &str =
            "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        StoredEvent {
            sequence_number: 31,
            block_number: 999_999,
            block_timestamp: Utc::now(),
            block_hash: "0xboundaryblock".to_owned(),
            transaction_hash: "0xboundarytx".to_owned(),
            log_index: 0,
            event_type: "SharePriceChanged".to_owned(),
            event_data: json!({
                "block_number":     999_999,
                "block_timestamp":  "2024-12-31T23:59:59Z",
                "block_hash":       "0xboundaryblock",
                "transaction_hash": "0xboundarytx",
                "log_index":        0,
                "term_id":          MAX_BYTES32_HEX,
                "curve_id":         "1",
                "share_price":      MAX_U256,
                "total_assets":     MAX_U256,
                "total_shares":     MAX_U256,
                "vault_type":       1
            }),
            term_id: Some(MAX_BYTES32_HEX.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn project_parsed_matches_project_for_share_price_changed() {
        use crate::projection::test_parity::make_unrelated_unknown_event;
        // Three-slice parity: happy path, boundary (max u256), Unknown.
        assert_surreal_projection_parity(
            &PriceProjection,
            &[
                make_complete_event(),
                make_boundary_event(),
                make_unrelated_unknown_event(99),
            ],
        );
    }

    #[test]
    fn uses_typed_events_is_true() {
        assert!(PriceProjection.uses_typed_events());
    }
}
