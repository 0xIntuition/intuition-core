//! Typed `ParsedEvent` enum — a `StoredEvent` whose `event_data` JSON has
//! been deserialised into a concrete record struct.
//!
//! # Design Rationale
//!
//! Every projection previously called `get_str()` / `parse_decimal()` on
//! `StoredEvent.event_data: serde_json::Value` independently. That means
//! the same JSON path is parsed N times (once per projection) and any
//! field-name typo surfaces at runtime rather than at deserialization time.
//!
//! `ParsedEvent` solves this by:
//! 1. Parsing once at the worker loop boundary (before the event is fanned
//!    out to projections).
//! 2. Encoding the known event shapes in the type system — projections that
//!    pattern-match `ParsedEvent::Deposited { data, .. }` receive a
//!    `DepositedRecord` whose fields have already been validated.
//! 3. Falling back gracefully via `ParsedEvent::Unknown(StoredEvent)` for
//!    event types not yet represented by a typed struct, preserving full
//!    backward-compatibility with existing projections.
//!
//! # Migration Path
//!
//! Projections can be migrated incrementally:
//! - Unmigrated projections continue to receive `&StoredEvent` unchanged.
//! - Migrated projections override `process_parsed_batch` (on `PgProjection`)
//!   and match on the typed variants.
//! - The `ParsedEvent::as_stored_event()` helper lets a migrated projection
//!   delegate back to raw-event helpers for variants it does not handle.

use chrono::{DateTime, Utc};

use crate::models::{
    AtomCreatedRecord, DepositedRecord, ProtocolFeeAccruedRecord, RedeemedRecord,
    SharePriceChangedRecord, StoredEvent, TripleCreatedRecord,
};
use crate::types::{BlockNumber, LogIndex, SequenceNumber};

// ---------------------------------------------------------------------------
// EventMetadata
// ---------------------------------------------------------------------------

/// Fields common to every event variant, extracted from [`StoredEvent`].
///
/// Projections that need the raw envelope (sequence number, block metadata,
/// transaction hash, etc.) can obtain it here without touching `event_data`.
#[derive(Debug, Clone)]
pub struct EventMetadata {
    /// Monotonically-increasing position in the event log (primary sort key).
    pub sequence_number: SequenceNumber,
    /// Chain height at which this event was emitted.
    pub block_number: BlockNumber,
    /// Wall-clock time of the block (UTC).
    pub block_timestamp: DateTime<Utc>,
    /// Hex-encoded hash of the containing block.
    pub block_hash: String,
    /// Hex-encoded hash of the containing transaction.
    pub transaction_hash: String,
    /// Position of this log within the transaction.
    pub log_index: LogIndex,
    /// Canonical string name of the event (e.g. `"Deposited"`).
    pub event_type: String,
    /// Optional vault / term identifier forwarded by the ingestion layer.
    pub term_id: Option<String>,
    /// Optional entity identifier forwarded by the ingestion layer.
    pub entity_id: Option<String>,
    /// Whether this event belongs to the canonical chain.
    pub is_canonical: bool,
    /// Wall-clock time this event was written to the local store.
    pub ingested_at: DateTime<Utc>,
}

impl EventMetadata {
    /// Extract metadata from a `StoredEvent` without consuming it.
    #[inline]
    pub fn from_event(event: &StoredEvent) -> Self {
        Self {
            sequence_number: event.sequence_number,
            block_number: event.block_number,
            block_timestamp: event.block_timestamp,
            block_hash: event.block_hash.clone(),
            transaction_hash: event.transaction_hash.clone(),
            log_index: event.log_index,
            event_type: event.event_type.clone(),
            term_id: event.term_id.clone(),
            entity_id: event.entity_id.clone(),
            is_canonical: event.is_canonical,
            ingested_at: event.ingested_at,
        }
    }
}

// ---------------------------------------------------------------------------
// ParsedEvent
// ---------------------------------------------------------------------------

/// A [`StoredEvent`] whose `event_data` JSON has been deserialised into a
/// typed record struct.
///
/// Construction is only possible via [`ParsedEvent::parse`], which enforces
/// the invariant that the record fields have been validated by `serde`.
///
/// # Variants
///
/// One variant exists per known event type.  Any event whose `event_type`
/// string is not recognised is wrapped in [`ParsedEvent::Unknown`] so
/// existing projections can still consume it through the raw `StoredEvent`
/// API.
#[derive(Debug, Clone)]
pub enum ParsedEvent {
    /// `AtomCreated` event with validated fields.
    AtomCreated {
        metadata: EventMetadata,
        data: AtomCreatedRecord,
    },
    /// `TripleCreated` event with validated fields.
    TripleCreated {
        metadata: EventMetadata,
        data: TripleCreatedRecord,
    },
    /// `Deposited` event with validated fields.
    Deposited {
        metadata: EventMetadata,
        data: DepositedRecord,
    },
    /// `Redeemed` event with validated fields.
    Redeemed {
        metadata: EventMetadata,
        data: RedeemedRecord,
    },
    /// `SharePriceChanged` event with validated fields.
    SharePriceChanged {
        metadata: EventMetadata,
        data: SharePriceChangedRecord,
    },
    /// `ProtocolFeeAccrued` event with validated fields.
    ProtocolFeeAccrued {
        metadata: EventMetadata,
        data: ProtocolFeeAccruedRecord,
    },
    /// Catch-all for event types not yet represented by a typed struct.
    ///
    /// The original `StoredEvent` is preserved in its entirety so that
    /// projections which have not yet been migrated continue to work without
    /// change.
    Unknown(StoredEvent),
}

/// The parse error returned by [`ParsedEvent::parse`].
///
/// Carries both the name of the event type that failed and the underlying
/// `serde_json` error so callers can log precise diagnostics.
#[derive(Debug, thiserror::Error)]
#[error("failed to parse event_data for event type '{event_type}': {source}")]
pub struct ParseError {
    /// The `event_type` string from the original `StoredEvent`.
    pub event_type: String,
    /// The underlying deserialisation error.
    #[source]
    pub source: serde_json::Error,
}

/// Deserialise `event_data` into a typed record and wrap it in the given
/// `ParsedEvent` variant.  Eliminates the repetitive
/// `serde_json::from_value` + `map_err(ParseError)` pattern from each
/// match arm in [`ParsedEvent::parse`].
macro_rules! parse_variant {
    ($event_type:expr, $variant:ident, $metadata:expr, $event_data:expr) => {{
        let data = serde_json::from_value($event_data).map_err(|source| ParseError {
            event_type: $event_type.as_str().to_owned(),
            source,
        })?;
        Ok(ParsedEvent::$variant {
            metadata: $metadata,
            data,
        })
    }};
}

impl ParsedEvent {
    /// Parse a [`StoredEvent`] into a typed variant, **never dropping the event**.
    ///
    /// Unlike [`parse`], this method returns a `(Self, Option<ParseError>)` pair
    /// so callers always receive a value regardless of whether parsing succeeded:
    ///
    /// | Outcome | `(Self, Option<ParseError>)` |
    /// |---------|------------------------------|
    /// | Known type, data valid | `(Typed { .. }, None)` |
    /// | Unknown event type | `(Unknown(raw), None)` |
    /// | Known type, data malformed | `(Unknown(raw), Some(err))` |
    ///
    /// This is the preferred entry-point in worker loops where data-loss on
    /// parse failures is unacceptable.  The caller should log and emit a metric
    /// for any `Some(err)` so malformed events are visible in dashboards without
    /// blocking checkpoint advancement.
    ///
    /// The raw event is cloned up-front so the fallback `Unknown` variant always
    /// carries the original bytes even if the typed parse consumed the event.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let (parsed, maybe_err) = ParsedEvent::parse_or_unknown(stored_event);
    /// if let Some(err) = maybe_err {
    ///     warn!(error = %err, "parse failed; falling back to Unknown");
    /// }
    /// ```
    #[must_use]
    pub fn parse_or_unknown(event: StoredEvent) -> (Self, Option<ParseError>) {
        // Clone the raw event before consuming it so we can fall back to
        // Unknown(raw) if the typed parse fails.
        let raw = event.clone();
        match Self::parse(event) {
            Ok(parsed) => (parsed, None),
            Err(err) => (Self::Unknown(raw), Some(err)),
        }
    }

    /// Parse a [`StoredEvent`] into a typed variant.
    ///
    /// # Returns
    ///
    /// - `Ok(ParsedEvent::Xyz { metadata, data })` when the event type is
    ///   recognised and `event_data` deserialises successfully.
    /// - `Ok(ParsedEvent::Unknown(event))` when the event type is not yet
    ///   represented by a typed struct.
    /// - `Err(ParseError { .. })` when the event type is known but
    ///   `event_data` fails to deserialise.  The caller can then decide
    ///   whether to skip the event, send it to the DLQ, etc.
    ///
    /// # Examples
    ///
    /// ```ignore
    /// let parsed = ParsedEvent::parse(stored_event)?;
    /// match parsed {
    ///     ParsedEvent::Deposited { metadata, data } => {
    ///         println!("deposit from {} at block {}", data.sender, metadata.block_number);
    ///     }
    ///     ParsedEvent::Unknown(raw) => {
    ///         // Handled by legacy projection code.
    ///     }
    ///     _ => {}
    /// }
    /// ```
    pub fn parse(event: StoredEvent) -> Result<Self, ParseError> {
        use std::str::FromStr;

        use crate::types::EventType;

        let metadata = EventMetadata::from_event(&event);

        // Dispatch through `EventType::from_str` so renaming a variant's
        // canonical string form becomes a compile error here instead of a
        // silent parse regression.  Unknown strings fall through to the
        // `Unknown` variant, preserving the existing never-drops-events
        // contract for event types not yet represented by a typed struct.
        let Ok(event_type) = EventType::from_str(&event.event_type) else {
            return Ok(Self::Unknown(event));
        };

        match event_type {
            EventType::AtomCreated => {
                parse_variant!(
                    EventType::AtomCreated,
                    AtomCreated,
                    metadata,
                    event.event_data
                )
            }
            EventType::TripleCreated => parse_variant!(
                EventType::TripleCreated,
                TripleCreated,
                metadata,
                event.event_data
            ),
            EventType::Deposited => {
                parse_variant!(EventType::Deposited, Deposited, metadata, event.event_data)
            }
            EventType::Redeemed => {
                parse_variant!(EventType::Redeemed, Redeemed, metadata, event.event_data)
            }
            EventType::SharePriceChanged => parse_variant!(
                EventType::SharePriceChanged,
                SharePriceChanged,
                metadata,
                event.event_data
            ),
            EventType::ProtocolFeeAccrued => parse_variant!(
                EventType::ProtocolFeeAccrued,
                ProtocolFeeAccrued,
                metadata,
                event.event_data
            ),
        }
    }

    /// Return the common metadata for this event.
    ///
    /// For [`ParsedEvent::Unknown`] the metadata is reconstructed on the fly
    /// from the raw `StoredEvent` fields.
    #[inline]
    pub fn metadata(&self) -> EventMetadataRef<'_> {
        match self {
            Self::AtomCreated { metadata, .. }
            | Self::TripleCreated { metadata, .. }
            | Self::Deposited { metadata, .. }
            | Self::Redeemed { metadata, .. }
            | Self::SharePriceChanged { metadata, .. }
            | Self::ProtocolFeeAccrued { metadata, .. } => EventMetadataRef::Owned(metadata),
            Self::Unknown(e) => EventMetadataRef::Raw(e),
        }
    }

    /// The canonical `event_type` string (e.g. `"Deposited"`).
    #[inline]
    pub fn event_type(&self) -> &str {
        match self {
            Self::AtomCreated { metadata, .. }
            | Self::TripleCreated { metadata, .. }
            | Self::Deposited { metadata, .. }
            | Self::Redeemed { metadata, .. }
            | Self::SharePriceChanged { metadata, .. }
            | Self::ProtocolFeeAccrued { metadata, .. } => &metadata.event_type,
            Self::Unknown(e) => &e.event_type,
        }
    }

    /// Sequence number of this event in the event log.
    #[inline]
    pub fn sequence_number(&self) -> SequenceNumber {
        match self {
            Self::AtomCreated { metadata, .. }
            | Self::TripleCreated { metadata, .. }
            | Self::Deposited { metadata, .. }
            | Self::Redeemed { metadata, .. }
            | Self::SharePriceChanged { metadata, .. }
            | Self::ProtocolFeeAccrued { metadata, .. } => metadata.sequence_number,
            Self::Unknown(e) => e.sequence_number,
        }
    }

    /// Reconstruct a `StoredEvent` from this parsed event for use by
    /// projections that have not yet been migrated to the typed API.
    ///
    /// For [`ParsedEvent::Unknown`] this is a zero-copy clone of the
    /// original event.  For typed variants the `event_data` is
    /// re-serialised, which incurs an allocation — this is intentional
    /// to keep the migration path open without requiring every projection
    /// to be updated at once.
    pub fn as_stored_event(&self) -> Result<StoredEvent, serde_json::Error> {
        macro_rules! reserialise {
            ($metadata:expr, $data:expr) => {
                Ok(stored_event_from_parts(
                    $metadata,
                    serde_json::to_value($data)?,
                ))
            };
        }

        match self {
            Self::Unknown(e) => Ok(e.clone()),
            Self::AtomCreated { metadata, data } => reserialise!(metadata, data),
            Self::TripleCreated { metadata, data } => reserialise!(metadata, data),
            Self::Deposited { metadata, data } => reserialise!(metadata, data),
            Self::Redeemed { metadata, data } => reserialise!(metadata, data),
            Self::SharePriceChanged { metadata, data } => reserialise!(metadata, data),
            Self::ProtocolFeeAccrued { metadata, data } => reserialise!(metadata, data),
        }
    }
}

// ---------------------------------------------------------------------------
// EventMetadataRef — zero-copy metadata access for Unknown events
// ---------------------------------------------------------------------------

/// A reference to event metadata that avoids cloning for the `Unknown` variant.
///
/// Callers that only need `sequence_number` or `event_type` can use the
/// accessor methods on this type without triggering an allocation.
pub enum EventMetadataRef<'a> {
    /// Metadata from a typed variant.
    Owned(&'a EventMetadata),
    /// Metadata derived on-the-fly from a raw `StoredEvent`.
    Raw(&'a StoredEvent),
}

impl EventMetadataRef<'_> {
    /// Monotonically-increasing event log position.
    #[inline]
    pub fn sequence_number(&self) -> SequenceNumber {
        match self {
            Self::Owned(m) => m.sequence_number,
            Self::Raw(e) => e.sequence_number,
        }
    }

    /// Block number at which this event was emitted.
    #[inline]
    pub fn block_number(&self) -> BlockNumber {
        match self {
            Self::Owned(m) => m.block_number,
            Self::Raw(e) => e.block_number,
        }
    }

    /// Wall-clock UTC timestamp of the block.
    ///
    /// `DateTime<Utc>` is `Copy`, so this is returned by value for both variants.
    #[inline]
    pub fn block_timestamp(&self) -> DateTime<Utc> {
        match self {
            Self::Owned(m) => m.block_timestamp,
            Self::Raw(e) => e.block_timestamp,
        }
    }

    /// Hex-encoded hash of the containing block (e.g. `"0xabc..."`).
    #[inline]
    pub fn block_hash(&self) -> &str {
        match self {
            Self::Owned(m) => &m.block_hash,
            Self::Raw(e) => &e.block_hash,
        }
    }

    /// Hex-encoded hash of the containing transaction (e.g. `"0xdef..."`).
    #[inline]
    pub fn transaction_hash(&self) -> &str {
        match self {
            Self::Owned(m) => &m.transaction_hash,
            Self::Raw(e) => &e.transaction_hash,
        }
    }

    /// Position of this log entry within the transaction.
    #[inline]
    pub fn log_index(&self) -> LogIndex {
        match self {
            Self::Owned(m) => m.log_index,
            Self::Raw(e) => e.log_index,
        }
    }

    /// Canonical string name of the event (e.g. `"Deposited"`).
    #[inline]
    pub fn event_type(&self) -> &str {
        match self {
            Self::Owned(m) => &m.event_type,
            Self::Raw(e) => &e.event_type,
        }
    }

    /// Optional vault / term identifier forwarded by the ingestion layer.
    #[inline]
    pub fn term_id(&self) -> Option<&str> {
        match self {
            Self::Owned(m) => m.term_id.as_deref(),
            Self::Raw(e) => e.term_id.as_deref(),
        }
    }

    /// Optional entity identifier forwarded by the ingestion layer.
    #[inline]
    pub fn entity_id(&self) -> Option<&str> {
        match self {
            Self::Owned(m) => m.entity_id.as_deref(),
            Self::Raw(e) => e.entity_id.as_deref(),
        }
    }

    /// Whether this event belongs to the canonical chain.
    #[inline]
    pub fn is_canonical(&self) -> bool {
        match self {
            Self::Owned(m) => m.is_canonical,
            Self::Raw(e) => e.is_canonical,
        }
    }

    /// Wall-clock UTC time this event was written to the local store.
    ///
    /// `DateTime<Utc>` is `Copy`, so this is returned by value for both variants.
    #[inline]
    pub fn ingested_at(&self) -> DateTime<Utc> {
        match self {
            Self::Owned(m) => m.ingested_at,
            Self::Raw(e) => e.ingested_at,
        }
    }
}

// ---------------------------------------------------------------------------
// Compile-time exhaustive-match guards (Phase 2.2)
// ---------------------------------------------------------------------------
//
// These two private functions will fail to compile if either `EventType` or
// `ParsedEvent` gains a new variant without a corresponding update here.
// They are never called at runtime — the `#[allow(dead_code)]` attribute
// suppresses the unused-function lint.

#[allow(dead_code)]
fn _event_type_exhaustive_check(et: crate::types::EventType) -> &'static str {
    use crate::types::EventType;
    match et {
        EventType::AtomCreated => "AtomCreated",
        EventType::TripleCreated => "TripleCreated",
        EventType::Deposited => "Deposited",
        EventType::Redeemed => "Redeemed",
        EventType::SharePriceChanged => "SharePriceChanged",
        EventType::ProtocolFeeAccrued => "ProtocolFeeAccrued",
    }
}

#[allow(dead_code)]
fn _parsed_event_exhaustive_check(e: &ParsedEvent) -> Option<crate::types::EventType> {
    use crate::types::EventType;
    match e {
        ParsedEvent::AtomCreated { .. } => Some(EventType::AtomCreated),
        ParsedEvent::TripleCreated { .. } => Some(EventType::TripleCreated),
        ParsedEvent::Deposited { .. } => Some(EventType::Deposited),
        ParsedEvent::Redeemed { .. } => Some(EventType::Redeemed),
        ParsedEvent::SharePriceChanged { .. } => Some(EventType::SharePriceChanged),
        ParsedEvent::ProtocolFeeAccrued { .. } => Some(EventType::ProtocolFeeAccrued),
        ParsedEvent::Unknown(_) => None,
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Reconstruct a `StoredEvent` from split metadata + serialised `event_data`.
#[inline]
fn stored_event_from_parts(metadata: &EventMetadata, event_data: serde_json::Value) -> StoredEvent {
    StoredEvent {
        sequence_number: metadata.sequence_number,
        block_number: metadata.block_number,
        block_timestamp: metadata.block_timestamp,
        block_hash: metadata.block_hash.clone(),
        transaction_hash: metadata.transaction_hash.clone(),
        log_index: metadata.log_index,
        event_type: metadata.event_type.clone(),
        event_data,
        term_id: metadata.term_id.clone(),
        entity_id: metadata.entity_id.clone(),
        is_canonical: metadata.is_canonical,
        ingested_at: metadata.ingested_at,
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
    use std::str::FromStr;

    // Canonical bytes32 hex constants used across test fixtures.
    // These represent small integers left-padded to 32 bytes, matching the
    // format emitted by the on-chain indexer for term_id / subject_id / etc.
    const HEX_1: &str = "0x0000000000000000000000000000000000000000000000000000000000000001";
    const HEX_2: &str = "0x0000000000000000000000000000000000000000000000000000000000000002";
    const HEX_3: &str = "0x0000000000000000000000000000000000000000000000000000000000000003";
    const HEX_7: &str = "0x0000000000000000000000000000000000000000000000000000000000000007";
    const HEX_10: &str = "0x000000000000000000000000000000000000000000000000000000000000000a";

    // -------------------------------------------------------------------
    // Test event builders
    // -------------------------------------------------------------------

    /// Wrap arbitrary `event_data` in a `StoredEvent` with a given type.
    fn make_stored(event_type: &str, event_data: serde_json::Value) -> StoredEvent {
        StoredEvent {
            sequence_number: 42,
            block_number: 1_000,
            block_timestamp: Utc::now(),
            block_hash: "0xblock".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 3,
            event_type: event_type.to_owned(),
            event_data,
            term_id: Some(HEX_7.to_owned()),
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    fn atom_created_event() -> StoredEvent {
        make_stored(
            "AtomCreated",
            json!({
                "creator": "0xCreator",
                "term_id": HEX_7,
                "atom_data": "ipfs://QmFoo",
                "atom_wallet": "0xWallet"
            }),
        )
    }

    fn triple_created_event() -> StoredEvent {
        make_stored(
            "TripleCreated",
            json!({
                "creator": "0xCreator",
                "term_id": HEX_10,
                "subject_id": HEX_1,
                "predicate_id": HEX_2,
                "object_id": HEX_3
            }),
        )
    }

    fn deposited_event() -> StoredEvent {
        make_stored(
            "Deposited",
            json!({
                "sender": "0xSender",
                "receiver": "0xReceiver",
                "term_id": HEX_7,
                "curve_id": "1",
                "assets": "1000000",
                "assets_after_fees": "980000",
                "shares": "950000",
                "total_shares": "5000000",
                "vault_type": 1
            }),
        )
    }

    fn redeemed_event() -> StoredEvent {
        make_stored(
            "Redeemed",
            json!({
                "sender": "0xSender",
                "receiver": "0xReceiver",
                "term_id": HEX_7,
                "curve_id": "1",
                "shares": "100000",
                "total_shares": "4900000",
                "assets": "98000",
                "fees": "2000",
                "vault_type": 1
            }),
        )
    }

    fn share_price_changed_event() -> StoredEvent {
        make_stored(
            "SharePriceChanged",
            json!({
                "term_id": HEX_7,
                "curve_id": "1",
                "share_price": "1020000",
                "total_assets": "5100000",
                "total_shares": "5000000",
                "vault_type": 1
            }),
        )
    }

    fn protocol_fee_accrued_event() -> StoredEvent {
        make_stored(
            "ProtocolFeeAccrued",
            json!({
                "epoch": "42",
                "sender": "0xSender",
                "amount": "5000"
            }),
        )
    }

    fn unknown_event() -> StoredEvent {
        StoredEvent {
            sequence_number: 1,
            block_number: 100,
            block_timestamp: Utc::now(),
            block_hash: "0xblock".to_owned(),
            transaction_hash: "0xtx".to_owned(),
            log_index: 0,
            event_type: "SomeUnknownEvent".to_owned(),
            event_data: json!({ "foo": "bar" }),
            term_id: None,
            entity_id: None,
            is_canonical: true,
            ingested_at: Utc::now(),
        }
    }

    // -------------------------------------------------------------------
    // Parse happy-path tests for every variant
    // -------------------------------------------------------------------

    #[test]
    fn parse_atom_created_yields_typed_variant() {
        let parsed = ParsedEvent::parse(atom_created_event()).expect("parse should succeed");
        let ParsedEvent::AtomCreated { metadata, data } = parsed else {
            panic!("expected AtomCreated variant");
        };
        assert_eq!(metadata.sequence_number, 42);
        assert_eq!(data.creator, "0xCreator");
        assert_eq!(data.atom_data, "ipfs://QmFoo");
        assert_eq!(data.atom_wallet, "0xWallet");
    }

    #[test]
    fn parse_triple_created_yields_typed_variant() {
        let parsed = ParsedEvent::parse(triple_created_event()).expect("parse should succeed");
        let ParsedEvent::TripleCreated { metadata, data } = parsed else {
            panic!("expected TripleCreated variant");
        };
        assert_eq!(metadata.sequence_number, 42);
        assert_eq!(data.creator, "0xCreator");
        // term_id / subject_id / predicate_id / object_id are hex strings (keccak256 bytes32).
        assert_eq!(data.term_id, HEX_10);
        assert_eq!(data.subject_id, HEX_1);
        assert_eq!(data.predicate_id, HEX_2);
        assert_eq!(data.object_id, HEX_3);
    }

    #[test]
    fn parse_deposited_yields_typed_variant() {
        let parsed = ParsedEvent::parse(deposited_event()).expect("parse should succeed");
        let ParsedEvent::Deposited { metadata, data } = parsed else {
            panic!("expected Deposited variant");
        };
        assert_eq!(metadata.sequence_number, 42);
        assert_eq!(metadata.block_number, 1_000);
        assert_eq!(metadata.transaction_hash, "0xtx");
        assert_eq!(data.sender, "0xSender");
        assert_eq!(data.receiver, "0xReceiver");
        assert_eq!(
            data.assets_after_fees,
            sqlx::types::BigDecimal::from_str("980000").unwrap()
        );
    }

    #[test]
    fn parse_redeemed_yields_typed_variant() {
        let parsed = ParsedEvent::parse(redeemed_event()).expect("parse should succeed");
        let ParsedEvent::Redeemed { metadata, data } = parsed else {
            panic!("expected Redeemed variant");
        };
        assert_eq!(metadata.sequence_number, 42);
        assert_eq!(data.sender, "0xSender");
        assert_eq!(
            data.assets,
            sqlx::types::BigDecimal::from_str("98000").unwrap()
        );
        assert_eq!(
            data.fees,
            sqlx::types::BigDecimal::from_str("2000").unwrap()
        );
    }

    #[test]
    fn parse_share_price_changed_yields_typed_variant() {
        let parsed = ParsedEvent::parse(share_price_changed_event()).expect("parse should succeed");
        let ParsedEvent::SharePriceChanged { metadata, data } = parsed else {
            panic!("expected SharePriceChanged variant");
        };
        assert_eq!(metadata.sequence_number, 42);
        assert_eq!(
            data.share_price,
            sqlx::types::BigDecimal::from_str("1020000").unwrap()
        );
        assert_eq!(
            data.total_assets,
            sqlx::types::BigDecimal::from_str("5100000").unwrap()
        );
    }

    #[test]
    fn parse_protocol_fee_accrued_yields_typed_variant() {
        let parsed =
            ParsedEvent::parse(protocol_fee_accrued_event()).expect("parse should succeed");
        let ParsedEvent::ProtocolFeeAccrued { metadata, data } = parsed else {
            panic!("expected ProtocolFeeAccrued variant");
        };
        assert_eq!(metadata.sequence_number, 42);
        assert_eq!(data.sender, "0xSender");
        assert_eq!(
            data.amount,
            sqlx::types::BigDecimal::from_str("5000").unwrap()
        );
    }

    #[test]
    fn parse_unknown_event_type_yields_unknown_variant() {
        let event = unknown_event();
        let seq = event.sequence_number;

        let parsed = ParsedEvent::parse(event).expect("parse should not fail for unknown");

        let ParsedEvent::Unknown(raw) = parsed else {
            panic!("expected ParsedEvent::Unknown");
        };

        assert_eq!(raw.sequence_number, seq);
        assert_eq!(raw.event_type, "SomeUnknownEvent");
    }

    // -------------------------------------------------------------------
    // Round-trip tests: parse -> as_stored_event -> parse
    // -------------------------------------------------------------------

    /// Verify that `parse(event).as_stored_event()` produces JSON-equivalent
    /// output for every typed variant.  This is the backward-compatibility
    /// guarantee that lets migrated and unmigrated projections coexist.
    fn assert_round_trip(original: StoredEvent) {
        let event_type = original.event_type.clone();
        let original_data = original.event_data.clone();

        let parsed = ParsedEvent::parse(original).unwrap_or_else(|e| {
            panic!("parse failed for {event_type}: {e}");
        });

        let reconstructed = parsed.as_stored_event().unwrap_or_else(|e| {
            panic!("as_stored_event failed for {event_type}: {e}");
        });

        assert_eq!(reconstructed.event_type, event_type);
        assert_eq!(reconstructed.sequence_number, 42);
        assert_eq!(reconstructed.block_number, 1_000);
        assert_eq!(reconstructed.transaction_hash, "0xtx");

        // Compare event_data field-by-field (JSON equivalence).
        assert_eq!(
            reconstructed.event_data, original_data,
            "round-trip data mismatch for {event_type}"
        );
    }

    #[test]
    fn round_trip_atom_created() {
        assert_round_trip(atom_created_event());
    }

    #[test]
    fn round_trip_triple_created() {
        assert_round_trip(triple_created_event());
    }

    #[test]
    fn round_trip_deposited() {
        assert_round_trip(deposited_event());
    }

    #[test]
    fn round_trip_redeemed() {
        assert_round_trip(redeemed_event());
    }

    #[test]
    fn round_trip_share_price_changed() {
        assert_round_trip(share_price_changed_event());
    }

    #[test]
    fn round_trip_protocol_fee_accrued() {
        assert_round_trip(protocol_fee_accrued_event());
    }

    #[test]
    fn round_trip_unknown() {
        let event = unknown_event();
        let original_data = event.event_data.clone();
        let parsed = ParsedEvent::parse(event).unwrap();
        let reconstructed = parsed.as_stored_event().unwrap();
        assert_eq!(reconstructed.event_data, original_data);
    }

    // -------------------------------------------------------------------
    // Accessor tests
    // -------------------------------------------------------------------

    #[test]
    fn sequence_number_accessor_consistent() {
        let event = deposited_event();
        let seq = event.sequence_number;
        let parsed = ParsedEvent::parse(event).unwrap();
        assert_eq!(parsed.sequence_number(), seq);
    }

    #[test]
    fn event_type_accessor_consistent() {
        let event = deposited_event();
        let parsed = ParsedEvent::parse(event).unwrap();
        assert_eq!(parsed.event_type(), "Deposited");
    }

    // -------------------------------------------------------------------
    // parse_or_unknown tests
    // -------------------------------------------------------------------

    /// A malformed Deposited event must yield Unknown with a Some(err) — no data loss.
    #[test]
    fn parse_or_unknown_malformed_deposited_yields_unknown_with_err() {
        let mut event = deposited_event();
        event.event_data = json!({ "sender": 123 }); // `sender` must be a string
        let (parsed, maybe_err) = ParsedEvent::parse_or_unknown(event.clone());
        assert!(
            maybe_err.is_some(),
            "expected a parse error for malformed data"
        );
        assert_eq!(maybe_err.unwrap().event_type, "Deposited");
        let ParsedEvent::Unknown(raw) = parsed else {
            panic!("expected Unknown fallback on malformed data");
        };
        assert_eq!(raw.sequence_number, event.sequence_number);
        assert_eq!(raw.event_type, "Deposited");
    }

    /// An unknown event type must yield Unknown with None — not an error.
    #[test]
    fn parse_or_unknown_unknown_type_yields_unknown_no_err() {
        let event = unknown_event();
        let seq = event.sequence_number;
        let (parsed, maybe_err) = ParsedEvent::parse_or_unknown(event);
        assert!(
            maybe_err.is_none(),
            "unknown type should not produce an error"
        );
        let ParsedEvent::Unknown(raw) = parsed else {
            panic!("expected Unknown for unrecognised event type");
        };
        assert_eq!(raw.sequence_number, seq);
        assert_eq!(raw.event_type, "SomeUnknownEvent");
    }

    /// A well-formed event must yield a typed variant with None error.
    #[test]
    fn parse_or_unknown_well_formed_yields_typed_no_err() {
        let event = deposited_event();
        let (parsed, maybe_err) = ParsedEvent::parse_or_unknown(event);
        assert!(
            maybe_err.is_none(),
            "well-formed event should not produce an error"
        );
        assert!(
            matches!(parsed, ParsedEvent::Deposited { .. }),
            "expected Deposited variant"
        );
    }

    /// Sequence number must be preserved even when parsing falls back to Unknown.
    #[test]
    fn parse_or_unknown_preserves_sequence_number_on_malformed() {
        let mut event = deposited_event();
        // sequence_number is set to 42 in make_stored
        event.event_data = json!({}); // completely empty — will fail
        let (parsed, maybe_err) = ParsedEvent::parse_or_unknown(event);
        assert!(maybe_err.is_some());
        // The Unknown fallback must carry the original sequence number.
        assert_eq!(parsed.sequence_number(), 42);
    }

    /// Round-trip through parse_or_unknown then as_stored_event must be lossless.
    #[test]
    fn parse_or_unknown_round_trips_through_as_stored_event() {
        // Use a well-formed event so the typed path is exercised.
        let event = atom_created_event();
        let original_data = event.event_data.clone();
        let (parsed, maybe_err) = ParsedEvent::parse_or_unknown(event);
        assert!(maybe_err.is_none());
        let reconstructed = parsed
            .as_stored_event()
            .expect("as_stored_event must succeed");
        assert_eq!(reconstructed.event_type, "AtomCreated");
        assert_eq!(reconstructed.sequence_number, 42);
        assert_eq!(reconstructed.event_data, original_data);
    }

    // -------------------------------------------------------------------
    // Error path tests
    // -------------------------------------------------------------------

    #[test]
    fn parse_error_on_malformed_deposited_data() {
        let mut event = deposited_event();
        // Break the event_data so serde fails.
        event.event_data = json!({ "sender": 123 }); // `sender` must be a string
        let err = ParsedEvent::parse(event).expect_err("expected parse error");
        assert_eq!(err.event_type, "Deposited");
    }

    #[test]
    fn parse_error_on_malformed_atom_created_data() {
        let mut event = atom_created_event();
        event.event_data = json!({ "creator": 123 });
        let err = ParsedEvent::parse(event).expect_err("expected parse error");
        assert_eq!(err.event_type, "AtomCreated");
    }

    // -------------------------------------------------------------------
    // Metadata ref tests
    // -------------------------------------------------------------------

    #[test]
    fn unknown_metadata_ref_sequence_number() {
        let event = unknown_event();
        let parsed = ParsedEvent::parse(event).unwrap();
        let meta_ref = parsed.metadata();
        assert_eq!(meta_ref.sequence_number(), 1);
    }

    #[test]
    fn typed_metadata_ref_block_number() {
        let parsed = ParsedEvent::parse(deposited_event()).unwrap();
        let meta_ref = parsed.metadata();
        assert_eq!(meta_ref.block_number(), 1_000);
    }

    // -------------------------------------------------------------------
    // Expanded EventMetadataRef accessor tests (Phase 1.1)
    // -------------------------------------------------------------------

    /// Verify all new accessors on a typed (Owned) variant.
    #[test]
    fn metadata_ref_accessors_typed_variant() {
        let event = deposited_event();
        let parsed = ParsedEvent::parse(event).unwrap();
        let meta = parsed.metadata();

        assert_eq!(meta.block_hash(), "0xblock");
        assert_eq!(meta.transaction_hash(), "0xtx");
        assert_eq!(meta.log_index(), 3);
        assert_eq!(meta.event_type(), "Deposited");
        assert_eq!(meta.term_id(), Some(HEX_7));
        assert_eq!(meta.entity_id(), None);
        assert!(meta.is_canonical());
        // block_timestamp and ingested_at are DateTime<Utc> — just verify they are non-zero epoch.
        assert!(meta.block_timestamp().timestamp() > 0);
        assert!(meta.ingested_at().timestamp() > 0);
    }

    /// Verify all new accessors on an Unknown (Raw) variant.
    #[test]
    fn metadata_ref_accessors_unknown_variant() {
        let event = unknown_event();
        let parsed = ParsedEvent::parse(event).unwrap();
        let meta = parsed.metadata();

        assert_eq!(meta.block_hash(), "0xblock");
        assert_eq!(meta.transaction_hash(), "0xtx");
        assert_eq!(meta.log_index(), 0);
        assert_eq!(meta.event_type(), "SomeUnknownEvent");
        assert_eq!(meta.term_id(), None);
        assert_eq!(meta.entity_id(), None);
        assert!(meta.is_canonical());
        assert!(meta.block_timestamp().timestamp() > 0);
        assert!(meta.ingested_at().timestamp() > 0);
    }

    // -------------------------------------------------------------------
    // Proptest round-trip and invariant tests (Phase 2.1)
    // -------------------------------------------------------------------
    //
    // These tests use the proptest strategy builders below to generate
    // plausible event shapes and verify parse ↔ as_stored_event round-trips
    // along with `parse_or_unknown` invariants.

    mod proptest_helpers {
        use super::*;
        use proptest::prelude::*;

        /// Generate a hex Ethereum address string (`"0x"` + 40 hex chars).
        pub fn arb_address() -> impl Strategy<Value = String> {
            // proptest's `[a-f0-9]{40}` regex — keep it simple and deterministic.
            "[0-9a-f]{40}".prop_map(|s| format!("0x{s}"))
        }

        /// Generate a non-negative decimal integer string suitable for BigDecimal fields.
        pub fn arb_decimal() -> impl Strategy<Value = String> {
            (0u64..=u64::MAX / 2).prop_map(|n| n.to_string())
        }

        /// Generate a bytes32 hex string suitable for `term_id` / `subject_id` /
        /// `predicate_id` / `object_id` fields (keccak256 hash format).
        pub fn arb_hex_id() -> impl Strategy<Value = String> {
            "[0-9a-f]{64}".prop_map(|s| format!("0x{s}"))
        }

        /// Wrap field values in a StoredEvent for a given event_type string.
        pub fn wrap(event_type: &str, event_data: serde_json::Value) -> StoredEvent {
            StoredEvent {
                sequence_number: 1,
                block_number: 1_000,
                block_timestamp: chrono::Utc::now(),
                block_hash: "0xblockhash".to_owned(),
                transaction_hash: "0xtxhash".to_owned(),
                log_index: 0,
                event_type: event_type.to_owned(),
                event_data,
                term_id: Some(HEX_1.to_owned()),
                entity_id: None,
                is_canonical: true,
                ingested_at: chrono::Utc::now(),
            }
        }

        prop_compose! {
            /// Strategy producing a well-formed `AtomCreated` StoredEvent.
            pub fn arb_atom_created_event()
                (creator in arb_address(), term_id in arb_hex_id(),
                 atom_data in "[a-z0-9]{8}", atom_wallet in arb_address())
            -> StoredEvent {
                wrap("AtomCreated", serde_json::json!({
                    "creator": creator,
                    "term_id": term_id,
                    "atom_data": atom_data,
                    "atom_wallet": atom_wallet
                }))
            }
        }

        prop_compose! {
            /// Strategy producing a well-formed `TripleCreated` StoredEvent.
            pub fn arb_triple_created_event()
                (creator in arb_address(), term_id in arb_hex_id(),
                 subject_id in arb_hex_id(), predicate_id in arb_hex_id(),
                 object_id in arb_hex_id())
            -> StoredEvent {
                wrap("TripleCreated", serde_json::json!({
                    "creator": creator,
                    "term_id": term_id,
                    "subject_id": subject_id,
                    "predicate_id": predicate_id,
                    "object_id": object_id
                }))
            }
        }

        prop_compose! {
            /// Strategy producing a well-formed `Deposited` StoredEvent.
            pub fn arb_deposited_event()
                (sender in arb_address(), receiver in arb_address(),
                 term_id in arb_hex_id(), curve_id in arb_decimal(),
                 assets in arb_decimal(), assets_after_fees in arb_decimal(),
                 shares in arb_decimal(), total_shares in arb_decimal())
            -> StoredEvent {
                wrap("Deposited", serde_json::json!({
                    "sender": sender,
                    "receiver": receiver,
                    "term_id": term_id,
                    "curve_id": curve_id,
                    "assets": assets,
                    "assets_after_fees": assets_after_fees,
                    "shares": shares,
                    "total_shares": total_shares,
                    "vault_type": 1
                }))
            }
        }

        prop_compose! {
            /// Strategy producing a well-formed `Redeemed` StoredEvent.
            pub fn arb_redeemed_event()
                (sender in arb_address(), receiver in arb_address(),
                 term_id in arb_hex_id(), curve_id in arb_decimal(),
                 shares in arb_decimal(), total_shares in arb_decimal(),
                 assets in arb_decimal(), fees in arb_decimal())
            -> StoredEvent {
                wrap("Redeemed", serde_json::json!({
                    "sender": sender,
                    "receiver": receiver,
                    "term_id": term_id,
                    "curve_id": curve_id,
                    "shares": shares,
                    "total_shares": total_shares,
                    "assets": assets,
                    "fees": fees,
                    "vault_type": 1
                }))
            }
        }

        prop_compose! {
            /// Strategy producing a well-formed `SharePriceChanged` StoredEvent.
            pub fn arb_share_price_changed_event()
                (term_id in arb_hex_id(), curve_id in arb_decimal(),
                 share_price in arb_decimal(), total_assets in arb_decimal(),
                 total_shares in arb_decimal())
            -> StoredEvent {
                wrap("SharePriceChanged", serde_json::json!({
                    "term_id": term_id,
                    "curve_id": curve_id,
                    "share_price": share_price,
                    "total_assets": total_assets,
                    "total_shares": total_shares,
                    "vault_type": 1
                }))
            }
        }

        prop_compose! {
            /// Strategy producing a well-formed `ProtocolFeeAccrued` StoredEvent.
            pub fn arb_protocol_fee_accrued_event()
                (epoch in arb_decimal(), sender in arb_address(), amount in arb_decimal())
            -> StoredEvent {
                wrap("ProtocolFeeAccrued", serde_json::json!({
                    "epoch": epoch,
                    "sender": sender,
                    "amount": amount
                }))
            }
        }
    }

    use proptest::prelude::*;

    proptest! {
        #![proptest_config(ProptestConfig { cases: 256, .. ProptestConfig::default() })]

        /// parse → as_stored_event round-trip must be JSON-equivalent for AtomCreated.
        #[test]
        fn proptest_parse_round_trip_atom_created(event in proptest_helpers::arb_atom_created_event()) {
            let event_type = event.event_type.clone();
            let original_data = event.event_data.clone();
            let parsed = ParsedEvent::parse(event).expect("arb atom_created should always parse");
            let reconstructed = parsed.as_stored_event().expect("round-trip must succeed");
            prop_assert_eq!(&reconstructed.event_type, &event_type);
            prop_assert_eq!(&reconstructed.event_data, &original_data);
        }

        /// parse → as_stored_event round-trip must be JSON-equivalent for TripleCreated.
        #[test]
        fn proptest_parse_round_trip_triple_created(event in proptest_helpers::arb_triple_created_event()) {
            let event_type = event.event_type.clone();
            let original_data = event.event_data.clone();
            let parsed = ParsedEvent::parse(event).expect("arb triple_created should always parse");
            let reconstructed = parsed.as_stored_event().expect("round-trip must succeed");
            prop_assert_eq!(&reconstructed.event_type, &event_type);
            prop_assert_eq!(&reconstructed.event_data, &original_data);
        }

        /// parse → as_stored_event round-trip must be JSON-equivalent for Deposited.
        #[test]
        fn proptest_parse_round_trip_deposited(event in proptest_helpers::arb_deposited_event()) {
            let event_type = event.event_type.clone();
            let original_data = event.event_data.clone();
            let parsed = ParsedEvent::parse(event).expect("arb deposited should always parse");
            let reconstructed = parsed.as_stored_event().expect("round-trip must succeed");
            prop_assert_eq!(&reconstructed.event_type, &event_type);
            prop_assert_eq!(&reconstructed.event_data, &original_data);
        }

        /// parse → as_stored_event round-trip must be JSON-equivalent for Redeemed.
        #[test]
        fn proptest_parse_round_trip_redeemed(event in proptest_helpers::arb_redeemed_event()) {
            let event_type = event.event_type.clone();
            let original_data = event.event_data.clone();
            let parsed = ParsedEvent::parse(event).expect("arb redeemed should always parse");
            let reconstructed = parsed.as_stored_event().expect("round-trip must succeed");
            prop_assert_eq!(&reconstructed.event_type, &event_type);
            prop_assert_eq!(&reconstructed.event_data, &original_data);
        }

        /// parse → as_stored_event round-trip must be JSON-equivalent for SharePriceChanged.
        #[test]
        fn proptest_parse_round_trip_share_price_changed(event in proptest_helpers::arb_share_price_changed_event()) {
            let event_type = event.event_type.clone();
            let original_data = event.event_data.clone();
            let parsed = ParsedEvent::parse(event).expect("arb share_price_changed should always parse");
            let reconstructed = parsed.as_stored_event().expect("round-trip must succeed");
            prop_assert_eq!(&reconstructed.event_type, &event_type);
            prop_assert_eq!(&reconstructed.event_data, &original_data);
        }

        /// parse → as_stored_event round-trip must be JSON-equivalent for ProtocolFeeAccrued.
        #[test]
        fn proptest_parse_round_trip_protocol_fee_accrued(event in proptest_helpers::arb_protocol_fee_accrued_event()) {
            let event_type = event.event_type.clone();
            let original_data = event.event_data.clone();
            let parsed = ParsedEvent::parse(event).expect("arb protocol_fee_accrued should always parse");
            let reconstructed = parsed.as_stored_event().expect("round-trip must succeed");
            prop_assert_eq!(&reconstructed.event_type, &event_type);
            prop_assert_eq!(&reconstructed.event_data, &original_data);
        }

        /// parse_or_unknown must NEVER drop events — every input produces one output
        /// with the same sequence_number and event_type.
        #[test]
        fn proptest_parse_or_unknown_never_loses_events(
            event_type_str in "[A-Za-z]{3,20}",
            seq in 0i64..=i64::MAX / 2,
        ) {
            let event = StoredEvent {
                sequence_number: seq,
                block_number: 1_000,
                block_timestamp: chrono::Utc::now(),
                block_hash: "0xblock".to_owned(),
                transaction_hash: "0xtx".to_owned(),
                log_index: 0,
                event_type: event_type_str.clone(),
                event_data: serde_json::json!({ "arbitrary": true }),
                term_id: None,
                entity_id: None,
                is_canonical: true,
                ingested_at: chrono::Utc::now(),
            };
            let (parsed, _maybe_err) = ParsedEvent::parse_or_unknown(event);
            prop_assert_eq!(parsed.sequence_number(), seq);
            prop_assert_eq!(parsed.event_type(), event_type_str.as_str());
        }

        /// All metadata accessors on EventMetadataRef must return values consistent
        /// with the underlying StoredEvent, for both typed and Unknown variants.
        #[test]
        fn proptest_metadata_accessors_consistent_across_variants(
            event in proptest_helpers::arb_deposited_event(),
        ) {
            // Typed variant
            let typed_parsed = ParsedEvent::parse(event.clone()).expect("well-formed");
            let meta = typed_parsed.metadata();
            prop_assert_eq!(meta.sequence_number(), event.sequence_number);
            prop_assert_eq!(meta.block_number(), event.block_number);
            prop_assert_eq!(meta.block_hash(), event.block_hash.as_str());
            prop_assert_eq!(meta.transaction_hash(), event.transaction_hash.as_str());
            prop_assert_eq!(meta.log_index(), event.log_index);
            prop_assert_eq!(meta.event_type(), event.event_type.as_str());
            prop_assert_eq!(meta.is_canonical(), event.is_canonical);

            // Unknown variant (use an event with an unrecognised type)
            let unknown_raw = StoredEvent {
                event_type: "UnknownType".to_owned(),
                ..event.clone()
            };
            let unknown_parsed = ParsedEvent::parse(unknown_raw.clone()).expect("Unknown parses");
            let raw_meta = unknown_parsed.metadata();
            prop_assert_eq!(raw_meta.sequence_number(), unknown_raw.sequence_number);
            prop_assert_eq!(raw_meta.block_hash(), unknown_raw.block_hash.as_str());
            prop_assert_eq!(raw_meta.is_canonical(), unknown_raw.is_canonical);
        }
    }
}
