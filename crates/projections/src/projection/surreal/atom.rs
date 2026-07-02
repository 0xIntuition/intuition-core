use std::collections::HashMap;

use serde_json::Value;
use shared::models::{AtomCreatedRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;

use crate::error::ProjectionError;
use crate::projection::{datetime_value, get_str, Projection};
use crate::sink::{RecordId, SinkOperation};

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Projection for the `AtomCreated` event.
///
/// Produces three upsert operations per event:
/// 1. Account node for the creator address.
/// 2. Vault node keyed by `term_id`.
/// 3. Atom node keyed by `term_id`, carrying both decoded string data and
///    the original hex payload.
pub struct AtomProjection;

/// Decode an atom payload from `0x`-prefixed hex into a UTF-8 string.
///
/// Returns `None` if the hex is invalid, the bytes are not valid UTF-8,
/// or the decoded string contains null bytes (which SurrealDB/PG may reject).
/// Binary atoms (images, CBOR, etc.) simply store the hex as fallback.
fn decode_atom_data_hex(atom_data_hex: &str) -> Option<String> {
    let normalized_hex = atom_data_hex.strip_prefix("0x").unwrap_or(atom_data_hex);
    let decoded_bytes = hex::decode(normalized_hex).ok()?;
    let s = String::from_utf8(decoded_bytes).ok()?;
    if s.contains('\0') {
        return None;
    }
    Some(s)
}

impl Projection for AtomProjection {
    fn event_types(&self) -> &'static [EventType] {
        &[EventType::AtomCreated]
    }

    fn name(&self) -> &str {
        "atom"
    }

    /// Transform an `AtomCreated` event into sink operations.
    ///
    /// Delegates to `project_parsed` via `parse_or_unknown` so that both code
    /// paths share the same logic and parity tests always pass.
    ///
    /// # Errors
    ///
    /// Returns:
    /// - `ProjectionError::MissingField` if any required field is absent from
    ///   `event.event_data`.
    /// - `ProjectionError::InvalidEventData` if `atom_data` is invalid hex or
    ///   does not decode as UTF-8.
    fn project(&self, event: &StoredEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        let (parsed, _) = ParsedEvent::parse_or_unknown(event.clone());
        self.project_parsed(&parsed)
    }

    /// Typed event path — no JSON re-parsing.
    ///
    /// Matches on `ParsedEvent::AtomCreated` and builds sink operations
    /// directly from the typed `AtomCreatedRecord` fields.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::MissingField("atom_data")` if the event
    /// falls back to `Unknown` due to a parse failure on the `AtomCreated`
    /// fields (via the raw `project` delegation path in the fallback arm).
    fn project_parsed(&self, event: &ParsedEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        match event {
            ParsedEvent::AtomCreated { metadata, data } => Ok(build_atom_ops(metadata, data)),
            // AtomCreated that failed typed parse falls back to raw field
            // extraction so we do not silently drop the event.
            ParsedEvent::Unknown(raw) if raw.event_type == "AtomCreated" => {
                // Typed parse failed — fall back to raw JSON field extraction.
                let creator = get_str(&raw.event_data, "creator")?;
                let term_id = get_str(&raw.event_data, "term_id")?;
                let atom_data_hex = get_str(&raw.event_data, "atom_data")?;
                let display_data =
                    decode_atom_data_hex(atom_data_hex).unwrap_or_else(|| atom_data_hex.to_owned());
                let ts = datetime_value(&raw.block_timestamp);
                Ok(build_raw_atom_ops(
                    creator,
                    term_id,
                    atom_data_hex,
                    &display_data,
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

/// Build the three atom sink operations from typed record fields.
fn build_atom_ops(metadata: &EventMetadata, data: &AtomCreatedRecord) -> Vec<SinkOperation> {
    let creator = data.creator.as_str();
    // term_id is already a hex string (e.g. "0xa0e157...") — use it directly.
    let term_id = data.term_id.as_str();
    let atom_data_hex = data.atom_data.as_str();
    let display_data =
        decode_atom_data_hex(atom_data_hex).unwrap_or_else(|| atom_data_hex.to_owned());
    let ts = datetime_value(&metadata.block_timestamp);

    build_raw_atom_ops(creator, term_id, atom_data_hex, &display_data, ts)
}

/// Build the three atom sink operations from raw string fields.
///
/// Shared between the typed path and the Unknown-fallback path so that both
/// produce identical output and the parity test always passes.
fn build_raw_atom_ops(
    creator: &str,
    term_id: &str,
    atom_data_hex: &str,
    display_data: &str,
    ts: Value,
) -> Vec<SinkOperation> {
    // account:[creator] — one node per unique address.
    let account_op = SinkOperation::UpsertNode {
        id: RecordId::new("account", creator),
        fields: HashMap::from([
            ("address".to_owned(), Value::String(creator.to_owned())),
            ("onchain".to_owned(), Value::Bool(true)),
            ("updatedAt".to_owned(), ts.clone()),
        ]),
    };

    // vault:[term_id] — vault metadata anchored to the term.
    let vault_op = SinkOperation::UpsertNode {
        id: RecordId::new("vault", term_id),
        fields: HashMap::from([
            ("createdBy".to_owned(), Value::String(creator.to_owned())),
            ("onchain".to_owned(), Value::Bool(true)),
            ("updatedAt".to_owned(), ts.clone()),
        ]),
    };

    // atom:[term_id] — the atom payload node.
    let atom_op = SinkOperation::UpsertNode {
        id: RecordId::new("atom", term_id),
        fields: HashMap::from([
            ("data".to_owned(), Value::String(display_data.to_owned())),
            (
                "dataHex".to_owned(),
                Value::String(atom_data_hex.to_owned()),
            ),
            ("createdBy".to_owned(), Value::String(creator.to_owned())),
            ("type".to_owned(), Value::String("default".to_owned())),
            ("onchain".to_owned(), Value::Bool(true)),
            ("updatedAt".to_owned(), ts),
            // Back-reference to the vault that holds this atom's shares.
            ("vault".to_owned(), Value::String(term_id.to_owned())),
        ]),
    };

    vec![account_op, vault_op, atom_op]
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

    const HELLO_WORLD_HEX: &str = "0x68656c6c6f20776f726c64";

    fn make_event(event_data: Value) -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 0,
            event_type: "AtomCreated".to_owned(),
            event_data,
            term_id: Some("42".to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    /// A short hex id used in tests: `0x000...002a` (= 42 in decimal).
    const HEX_42: &str = "0x000000000000000000000000000000000000000000000000000000000000002a";

    #[test]
    fn project_emits_three_ops() {
        let proj = AtomProjection;
        let event = make_event(json!({
            "creator":     "0xCreator",
            "term_id":     HEX_42,
            "atom_data":   HELLO_WORLD_HEX,
            "atom_wallet": "0xWallet"
        }));

        let ops = proj.project(&event).expect("projection must succeed");
        assert_eq!(ops.len(), 3);
    }

    #[test]
    fn project_account_node_has_address_and_timestamps() {
        let proj = AtomProjection;
        let event = make_event(json!({
            "creator":     "0xCreator",
            "term_id":     HEX_42,
            "atom_data":   HELLO_WORLD_HEX,
            "atom_wallet": "0xWallet"
        }));

        let ops = proj.project(&event).unwrap();
        let SinkOperation::UpsertNode { id, fields } = &ops[0] else {
            panic!("expected UpsertNode");
        };
        assert_eq!(id.table, "account");
        assert_eq!(id.id, "0xCreator");
        assert_eq!(fields["address"], json!("0xCreator"));
        assert_eq!(fields["onchain"], Value::Bool(true));
        assert_eq!(
            fields["updatedAt"],
            crate::projection::datetime_value(&event.block_timestamp)
        );
    }

    #[test]
    fn project_vault_node_has_created_by_and_timestamps() {
        let proj = AtomProjection;
        let event = make_event(json!({
            "creator":     "0xCreator",
            "term_id":     HEX_42,
            "atom_data":   HELLO_WORLD_HEX,
            "atom_wallet": "0xWallet"
        }));

        let ops = proj.project(&event).unwrap();
        let SinkOperation::UpsertNode { id, fields } = &ops[1] else {
            panic!("expected UpsertNode");
        };
        assert_eq!(id.table, "vault");
        assert_eq!(id.id, HEX_42);
        assert_eq!(fields["createdBy"], json!("0xCreator"));
        assert_eq!(fields["onchain"], Value::Bool(true));
        assert_eq!(
            fields["updatedAt"],
            crate::projection::datetime_value(&event.block_timestamp)
        );
    }

    #[test]
    fn project_atom_node_fields() {
        let proj = AtomProjection;
        let event = make_event(json!({
            "creator":     "0xCreator",
            "term_id":     HEX_42,
            "atom_data":   HELLO_WORLD_HEX,
            "atom_wallet": "0xWallet"
        }));

        let ops = proj.project(&event).unwrap();
        let SinkOperation::UpsertNode { id, fields } = &ops[2] else {
            panic!("expected UpsertNode");
        };
        assert_eq!(id.table, "atom");
        assert_eq!(id.id, HEX_42);
        assert_eq!(fields["data"], json!("hello world"));
        assert_eq!(fields["dataHex"], json!(HELLO_WORLD_HEX));
        assert_eq!(fields["createdBy"], json!("0xCreator"));
        assert_eq!(fields["vault"], json!(HEX_42));
        assert_eq!(fields["type"], json!("default"));
        assert_eq!(fields["onchain"], Value::Bool(true));
        assert_eq!(
            fields["updatedAt"],
            crate::projection::datetime_value(&event.block_timestamp)
        );
    }

    #[test]
    fn project_missing_creator_returns_error() {
        let proj = AtomProjection;
        let event = make_event(json!({
            "term_id":   HEX_42,
            "atom_data": HELLO_WORLD_HEX
        }));

        let err = proj.project(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "creator"));
    }

    #[test]
    fn project_missing_atom_data_returns_error() {
        let proj = AtomProjection;
        let event = make_event(json!({
            "creator": "0xCreator",
            "term_id": HEX_42
        }));

        let err = proj.project(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "atom_data"));
    }

    #[test]
    fn decode_atom_data_hex_rejects_invalid_hex() {
        assert!(decode_atom_data_hex("0xnothex").is_none());
    }

    #[test]
    fn decode_atom_data_hex_accepts_non_prefixed_hex() {
        assert_eq!(decode_atom_data_hex("68656c6c6f").unwrap(), "hello");
    }

    #[test]
    fn decode_atom_data_hex_returns_none_for_non_utf8() {
        assert!(decode_atom_data_hex("0xff").is_none());
    }

    #[test]
    fn decode_atom_data_hex_rejects_null_bytes() {
        // "hello\0" in hex
        assert!(decode_atom_data_hex("0x68656c6c6f00").is_none());
    }

    #[test]
    fn binary_atom_falls_back_to_hex() {
        let proj = AtomProjection;
        let event = make_event(json!({
            "creator": "0xCreator",
            "term_id": HEX_42,
            "atom_data": "0xff"
        }));
        let ops = proj.project(&event).expect("binary atoms should not error");
        assert_eq!(ops.len(), 3);
        // The atom node should store the hex as data fallback
        if let SinkOperation::UpsertNode { fields, .. } = &ops[2] {
            assert_eq!(
                fields.get("data").unwrap(),
                &Value::String("0xff".to_owned())
            );
            assert_eq!(
                fields.get("dataHex").unwrap(),
                &Value::String("0xff".to_owned())
            );
        } else {
            panic!("expected UpsertNode");
        }
    }

    // -------------------------------------------------------------------------
    // Typed-path tests
    // -------------------------------------------------------------------------

    /// Build a complete `StoredEvent` whose `event_data` satisfies all fields
    /// required by `AtomCreatedRecord` for serde deserialization.
    fn make_complete_event() -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xtxhash".to_owned(),
            log_index: 0,
            event_type: "AtomCreated".to_owned(),
            event_data: json!({
                "block_number":    100,
                "block_timestamp": "2024-01-01T00:00:00Z",
                "block_hash":      "0xblockhash",
                "transaction_hash":"0xtxhash",
                "log_index":       0,
                "creator":         "0xCreator",
                "term_id":         HEX_42,
                "atom_data":       HELLO_WORLD_HEX,
                "atom_wallet":     "0xWallet"
            }),
            term_id: Some(HEX_42.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn project_parsed_emits_ops_for_atom_created() {
        let proj = AtomProjection;
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
        let proj = AtomProjection;
        // Wrap an unrelated event type so we hit the catch-all `_ =>` arm.
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

    /// Build a boundary `AtomCreated` event whose `term_id` is the max bytes32
    /// value.  Exercises the hex string path at the upper end of the on-chain
    /// range to confirm typed/raw parity holds for all 64-nibble hex values.
    fn make_boundary_event() -> StoredEvent {
        // 0xff...ff — the maximum bytes32 value on EVM chains (64 hex nibbles).
        const MAX_BYTES32_HEX: &str =
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        StoredEvent {
            sequence_number: 2,
            block_number: 999_999,
            block_timestamp: Utc::now(),
            block_hash: "0xboundaryblock".to_owned(),
            transaction_hash: "0xboundarytx".to_owned(),
            log_index: 0,
            event_type: "AtomCreated".to_owned(),
            event_data: json!({
                "block_number":    999_999,
                "block_timestamp": "2024-12-31T23:59:59Z",
                "block_hash":      "0xboundaryblock",
                "transaction_hash":"0xboundarytx",
                "log_index":       0,
                "creator":         "0x0000000000000000000000000000000000000000",
                "term_id":         MAX_BYTES32_HEX,
                "atom_data":       HELLO_WORLD_HEX,
                "atom_wallet":     "0xffffffffffffffffffffffffffffffffffffffff"
            }),
            term_id: Some(MAX_BYTES32_HEX.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn project_parsed_matches_project_for_atom_created() {
        use crate::projection::test_parity::make_unrelated_unknown_event;
        let proj = AtomProjection;
        // Three-slice parity: happy path, boundary (max u256),
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
        assert!(AtomProjection.uses_typed_events());
    }
}
