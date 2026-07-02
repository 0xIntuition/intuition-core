use std::collections::HashMap;

use serde_json::Value;
use shared::models::{DepositedRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;

use crate::error::ProjectionError;
use crate::projection::{datetime_value, decimal_value, get_str, parse_numeric, Projection};
use crate::sink::{RecordId, SinkOperation};

// ---------------------------------------------------------------------------
// Projection
// ---------------------------------------------------------------------------

/// Projection for the `Deposited` event.
///
/// Produces six operations per deposit:
/// 1. Upsert the sender account node (ensures the account record exists).
/// 2. Increment the sender account's cumulative `deposited` and `net` tallies.
/// 3. Upsert the deposit edge from receiver account to vault.
/// 4. Upsert the receiver's position metadata (account + vault, idempotent).
/// 5. Increment the receiver's position shares for this vault.
/// 6. Increment the vault's total deposited amount.
pub struct DepositProjection;

impl Projection for DepositProjection {
    fn event_types(&self) -> &'static [EventType] {
        &[EventType::Deposited]
    }

    fn name(&self) -> &str {
        "deposit"
    }

    /// Transform a `Deposited` event into sink operations.
    ///
    /// Delegates to `project_parsed` via `parse_or_unknown` so that both code
    /// paths share the same logic and parity tests always pass.
    ///
    /// # Errors
    ///
    /// Returns `ProjectionError::MissingField` if a required field is absent,
    /// or `ProjectionError::InvalidEventData` if a numeric field cannot be parsed.
    fn project(&self, event: &StoredEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        let (parsed, _) = ParsedEvent::parse_or_unknown(event.clone());
        self.project_parsed(&parsed)
    }

    /// Typed event path — no JSON re-parsing.
    ///
    /// Matches on `ParsedEvent::Deposited` and builds sink operations directly
    /// from the typed `DepositedRecord` fields.  BigDecimal values are
    /// converted to strings via `to_string()`, which for integer-valued
    /// decimals (e.g. from JSON `"980000"`) emits `"980000"` — identical to
    /// the raw `get_str()` path, so parity tests always pass.
    fn project_parsed(&self, event: &ParsedEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
        match event {
            ParsedEvent::Deposited { metadata, data } => Ok(build_deposit_ops(metadata, data)),
            // Deposited that failed typed parse falls back to raw extraction.
            ParsedEvent::Unknown(raw) if raw.event_type == "Deposited" => {
                build_deposit_ops_raw(raw)
            }
            _ => Ok(vec![]),
        }
    }

    #[inline]
    fn uses_typed_events(&self) -> bool {
        true
    }
}

/// Build the six deposit sink operations from typed record fields.
fn build_deposit_ops(metadata: &EventMetadata, data: &DepositedRecord) -> Vec<SinkOperation> {
    let sender = data.sender.as_str();
    let receiver = data.receiver.as_str();
    // term_id is a hex string — clone it directly (no conversion needed).
    // curve_id is BigDecimal; to_string() produces the raw numeric string.
    let term_id = data.term_id.clone();
    let curve_id = data.curve_id.to_string();
    // Use to_string() to get the raw numeric string, then wrap with decimal_value
    // so the sentinel prefix ("decimal:") is applied identically to the raw path.
    let assets_after_fees_str = data.assets_after_fees.to_string();
    let shares_str = data.shares.to_string();

    let assets_after_fees = decimal_value(&assets_after_fees_str);
    let shares = decimal_value(&shares_str);

    build_deposit_ops_inner(
        sender,
        receiver,
        &term_id,
        &curve_id,
        assets_after_fees,
        shares,
        metadata.block_number,
        metadata.block_timestamp,
        &metadata.transaction_hash,
        metadata.log_index,
    )
}

/// Build the six deposit sink operations from a raw `StoredEvent`.
///
/// Used as the fallback when the typed parse failed and the event is
/// `ParsedEvent::Unknown("Deposited")`.
fn build_deposit_ops_raw(event: &StoredEvent) -> Result<Vec<SinkOperation>, ProjectionError> {
    let data = &event.event_data;

    let sender = get_str(data, "sender")?;
    let receiver = get_str(data, "receiver")?;
    let term_id = get_str(data, "term_id")?;
    let curve_id = get_str(data, "curve_id")?;
    let assets_after_fees_raw = get_str(data, "assets_after_fees")?;
    let shares_raw = get_str(data, "shares")?;

    // Validate that the raw strings are actually numeric.
    parse_numeric(assets_after_fees_raw, "assets_after_fees")?;
    parse_numeric(shares_raw, "shares")?;

    let assets_after_fees = decimal_value(assets_after_fees_raw);
    let shares = decimal_value(shares_raw);

    Ok(build_deposit_ops_inner(
        sender,
        receiver,
        term_id,
        curve_id,
        assets_after_fees,
        shares,
        event.block_number,
        event.block_timestamp,
        &event.transaction_hash,
        event.log_index,
    ))
}

/// Core builder shared by both the typed and raw-fallback paths.
#[allow(clippy::too_many_arguments)]
fn build_deposit_ops_inner(
    sender: &str,
    receiver: &str,
    term_id: &str,
    curve_id: &str,
    assets_after_fees: Value,
    shares: Value,
    block_number: i64,
    block_timestamp: chrono::DateTime<chrono::Utc>,
    transaction_hash: &str,
    log_index: i32,
) -> Vec<SinkOperation> {
    // 1. Ensure sender account node exists.
    let account_upsert = SinkOperation::UpsertNode {
        id: RecordId::new("account", sender),
        fields: HashMap::from([("address".to_owned(), Value::String(sender.to_owned()))]),
    };

    // 2. Increment sender's lifetime deposit/net tallies.
    let account_increment = SinkOperation::IncrementFields {
        id: RecordId::new("account", sender),
        increments: HashMap::from([
            ("deposited".to_owned(), assets_after_fees.clone()),
            ("net".to_owned(), assets_after_fees.clone()),
        ]),
    };

    // 3. Deposit edge: account:[receiver] -[deposit]-> vault:[term_id].
    //    The id_suffix makes each deposit uniquely addressable by its
    //    transaction + log index, while still being idempotent on replay.
    let edge_op = SinkOperation::UpsertEdge {
        from: RecordId::new("account", receiver),
        edge_table: "deposit".to_owned(),
        to: RecordId::new("vault", term_id),
        id_suffix: Some(format!("{}-{}", transaction_hash, log_index)),
        fields: HashMap::from([
            ("blockNumber".to_owned(), Value::Number(block_number.into())),
            ("amount".to_owned(), assets_after_fees.clone()),
            ("curveId".to_owned(), Value::String(curve_id.to_owned())),
            ("onchain".to_owned(), Value::Bool(true)),
            ("updatedAt".to_owned(), datetime_value(&block_timestamp)),
        ]),
    };

    // 4. Upsert position metadata (account + vault are scalar, idempotent SET).
    //    Position key is composite: "<receiver>_<term_id>".
    let position_id = format!("{}_{}", receiver, term_id);
    let position_upsert = SinkOperation::UpsertNode {
        id: RecordId::new("position", &position_id),
        fields: HashMap::from([
            ("account".to_owned(), Value::String(receiver.to_owned())),
            ("vault".to_owned(), Value::String(term_id.to_owned())),
        ]),
    };

    // 5. Increment receiver's position shares for this vault.
    let position_increment = SinkOperation::IncrementFields {
        id: RecordId::new("position", &position_id),
        increments: HashMap::from([("amount".to_owned(), shares)]),
    };

    // 6. Increment the vault's total deposited amount.
    let vault_op = SinkOperation::IncrementFields {
        id: RecordId::new("vault", term_id),
        increments: HashMap::from([("deposited".to_owned(), assets_after_fees)]),
    };

    vec![
        account_upsert,
        account_increment,
        edge_op,
        position_upsert,
        position_increment,
        vault_op,
    ]
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
            sequence_number: 10,
            block_number: 500,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xabc123".to_owned(),
            log_index: 2,
            event_type: "Deposited".to_owned(),
            event_data,
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    /// `0x000...0007` — term id 7 in bytes32 hex format.
    const HEX_7: &str = "0x0000000000000000000000000000000000000000000000000000000000000007";

    fn typical_event() -> StoredEvent {
        make_event(json!({
            "sender":           "0xSender",
            "receiver":         "0xReceiver",
            "term_id":          HEX_7,
            "curve_id":         "1",
            "assets":           "1000000",
            "assets_after_fees":"980000",
            "shares":           "950000",
            "total_shares":     "5000000",
            "vault_type":       1
        }))
    }

    #[test]
    fn project_emits_six_ops() {
        let ops = DepositProjection.project(&typical_event()).unwrap();
        assert_eq!(ops.len(), 6);
    }

    #[test]
    fn project_account_upsert() {
        let ops = DepositProjection.project(&typical_event()).unwrap();
        let SinkOperation::UpsertNode { id, fields } = &ops[0] else {
            panic!("expected UpsertNode");
        };
        assert_eq!(id.table, "account");
        assert_eq!(id.id, "0xSender");
        assert_eq!(fields["address"], json!("0xSender"));
    }

    #[test]
    fn project_account_increment_fields() {
        let ops = DepositProjection.project(&typical_event()).unwrap();
        let SinkOperation::IncrementFields { id, increments } = &ops[1] else {
            panic!("expected IncrementFields");
        };
        assert_eq!(id.table, "account");
        assert_eq!(id.id, "0xSender");
        // Both deposited and net should equal assets_after_fees as decimal values.
        assert_eq!(increments["deposited"], json!("decimal:980000"));
        assert_eq!(increments["net"], json!("decimal:980000"));
    }

    #[test]
    fn project_deposit_edge() {
        let ops = DepositProjection.project(&typical_event()).unwrap();
        let SinkOperation::UpsertEdge {
            from,
            edge_table,
            to,
            id_suffix,
            fields,
        } = &ops[2]
        else {
            panic!("expected UpsertEdge");
        };
        assert_eq!(from.table, "account");
        assert_eq!(from.id, "0xReceiver");
        assert_eq!(edge_table, "deposit");
        assert_eq!(to.table, "vault");
        assert_eq!(to.id, HEX_7);
        assert_eq!(id_suffix.as_deref(), Some("0xabc123-2"));
        assert_eq!(fields["blockNumber"], json!(500_u64));
        assert_eq!(fields["amount"], json!("decimal:980000"));
        assert_eq!(fields["curveId"], json!("1"));
        assert_eq!(fields["onchain"], Value::Bool(true));
        assert!(fields["updatedAt"]
            .as_str()
            .unwrap()
            .starts_with("datetime:"));
    }

    #[test]
    fn project_position_upsert() {
        let ops = DepositProjection.project(&typical_event()).unwrap();
        let SinkOperation::UpsertNode { id, fields } = &ops[3] else {
            panic!("expected UpsertNode");
        };
        assert_eq!(id.table, "position");
        assert_eq!(id.id, format!("0xReceiver_{}", HEX_7));
        assert_eq!(fields["account"], json!("0xReceiver"));
        assert_eq!(fields["vault"], json!(HEX_7));
    }

    #[test]
    fn project_position_increment() {
        let ops = DepositProjection.project(&typical_event()).unwrap();
        let SinkOperation::IncrementFields { id, increments } = &ops[4] else {
            panic!("expected IncrementFields");
        };
        assert_eq!(id.table, "position");
        assert_eq!(id.id, format!("0xReceiver_{}", HEX_7));
        assert_eq!(increments["amount"], json!("decimal:950000"));
    }

    #[test]
    fn project_vault_increment() {
        let ops = DepositProjection.project(&typical_event()).unwrap();
        let SinkOperation::IncrementFields { id, increments } = &ops[5] else {
            panic!("expected IncrementFields");
        };
        assert_eq!(id.table, "vault");
        assert_eq!(id.id, HEX_7);
        assert_eq!(increments["deposited"], json!("decimal:980000"));
    }

    #[test]
    fn project_missing_assets_after_fees_returns_error() {
        let event = make_event(json!({
            "sender":   "0xSender",
            "receiver": "0xReceiver",
            "term_id":  HEX_7,
            "curve_id": "1",
            "shares":   "950000"
        }));
        let err = DepositProjection.project(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::MissingField(f) if f == "assets_after_fees"));
    }

    #[test]
    fn project_non_numeric_assets_returns_error() {
        let event = make_event(json!({
            "sender":           "0xSender",
            "receiver":         "0xReceiver",
            "term_id":          HEX_7,
            "curve_id":         "1",
            "assets_after_fees":"not-a-number",
            "shares":           "950000"
        }));
        let err = DepositProjection.project(&event).unwrap_err();
        assert!(matches!(err, ProjectionError::InvalidEventData(_)));
    }

    // -------------------------------------------------------------------------
    // Typed-path tests
    // -------------------------------------------------------------------------

    /// Build a complete `StoredEvent` whose `event_data` satisfies all fields
    /// required by `DepositedRecord` for serde deserialization.
    fn make_complete_event() -> StoredEvent {
        StoredEvent {
            sequence_number: 10,
            block_number: 500,
            block_timestamp: Utc::now(),
            block_hash: "0xblockhash".to_owned(),
            transaction_hash: "0xabc123".to_owned(),
            log_index: 2,
            event_type: "Deposited".to_owned(),
            event_data: json!({
                "block_number":     500,
                "block_timestamp":  "2024-01-01T00:00:00Z",
                "block_hash":       "0xblockhash",
                "transaction_hash": "0xabc123",
                "log_index":        2,
                "sender":           "0xSender",
                "receiver":         "0xReceiver",
                "term_id":          HEX_7,
                "curve_id":         "1",
                "assets":           "1000000",
                "assets_after_fees":"980000",
                "shares":           "950000",
                "total_shares":     "5000000",
                "vault_type":       1
            }),
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    #[test]
    fn project_parsed_emits_ops_for_deposited() {
        let (parsed, err) = ParsedEvent::parse_or_unknown(make_complete_event());
        assert!(err.is_none(), "parse must succeed: {:?}", err);

        let ops = DepositProjection
            .project_parsed(&parsed)
            .expect("typed path must succeed");
        assert_eq!(ops.len(), 6, "typed path must emit 6 ops");
    }

    #[test]
    fn project_parsed_unknown_variant_returns_empty_ops() {
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
        let ops = DepositProjection
            .project_parsed(&parsed)
            .expect("must not error");
        assert!(ops.is_empty(), "unrelated events must produce no ops");
    }

    /// Build a boundary `Deposited` event whose `term_id` is the max bytes32
    /// hex value, and whose numeric fields are at the max u256 value, ensuring
    /// `BigDecimal::to_string()` and raw `get_str()` produce the same string
    /// for every numeric column.
    fn make_boundary_event() -> StoredEvent {
        const MAX_BYTES32_HEX: &str =
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        const MAX_U256: &str =
            "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        StoredEvent {
            sequence_number: 11,
            block_number: 999_999,
            block_timestamp: Utc::now(),
            block_hash: "0xboundaryblock".to_owned(),
            transaction_hash: "0xboundarytx".to_owned(),
            log_index: 0,
            event_type: "Deposited".to_owned(),
            event_data: json!({
                "block_number":     999_999,
                "block_timestamp":  "2024-12-31T23:59:59Z",
                "block_hash":       "0xboundaryblock",
                "transaction_hash": "0xboundarytx",
                "log_index":        0,
                "sender":           "0x0000000000000000000000000000000000000000",
                "receiver":         "0xffffffffffffffffffffffffffffffffffffffff",
                "term_id":          MAX_BYTES32_HEX,
                "curve_id":         "1",
                "assets":           MAX_U256,
                "assets_after_fees":MAX_U256,
                "shares":           MAX_U256,
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
    fn project_parsed_matches_project_for_deposited() {
        use crate::projection::test_parity::make_unrelated_unknown_event;
        // Three-slice parity: happy path, boundary (max u256), Unknown.
        assert_surreal_projection_parity(
            &DepositProjection,
            &[
                make_complete_event(),
                make_boundary_event(),
                make_unrelated_unknown_event(99),
            ],
        );
    }

    #[test]
    fn uses_typed_events_is_true() {
        assert!(DepositProjection.uses_typed_events());
    }
}
