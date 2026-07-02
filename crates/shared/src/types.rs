use serde::{Deserialize, Serialize};
use sqlx::types::BigDecimal;

/// Block number type
pub type BlockNumber = i64;

/// Numeric type for decimal values (PostgreSQL numeric)
pub type Numeric = BigDecimal;

/// Log index type
pub type LogIndex = i32;

/// Sequence number type (auto-incrementing in event_store)
pub type SequenceNumber = i64;

/// Transaction hash type
pub type TxHash = String;

/// Block hash type
pub type BlockHash = String;

/// Term ID type (vault identifier)
pub type TermId = String;

/// Entity ID type (user address or atom ID)
pub type EntityId = String;

/// Event type enumeration
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text")]
#[serde(rename_all = "PascalCase")]
pub enum EventType {
    AtomCreated,
    TripleCreated,
    Deposited,
    Redeemed,
    SharePriceChanged,
    ProtocolFeeAccrued,
}

impl EventType {
    pub fn as_str(&self) -> &'static str {
        match self {
            EventType::AtomCreated => "AtomCreated",
            EventType::TripleCreated => "TripleCreated",
            EventType::Deposited => "Deposited",
            EventType::Redeemed => "Redeemed",
            EventType::SharePriceChanged => "SharePriceChanged",
            EventType::ProtocolFeeAccrued => "ProtocolFeeAccrued",
        }
    }
}

impl std::fmt::Display for EventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

/// Error returned when an `event_type` string does not correspond to a known
/// [`EventType`] variant.  Callers typically fall back to
/// [`crate::parsed_event::ParsedEvent::Unknown`] in this case.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownEventType(pub String);

impl std::fmt::Display for UnknownEventType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "unknown event type: {}", self.0)
    }
}

impl std::error::Error for UnknownEventType {}

impl std::str::FromStr for EventType {
    type Err = UnknownEventType;

    /// Parse a canonical `PascalCase` event-type string into an [`EventType`].
    ///
    /// The string form must match [`EventType::as_str`] exactly — this is the
    /// single source of truth so that renaming a variant produces a compile
    /// error rather than silent parsing drift.
    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s {
            "AtomCreated" => Ok(Self::AtomCreated),
            "TripleCreated" => Ok(Self::TripleCreated),
            "Deposited" => Ok(Self::Deposited),
            "Redeemed" => Ok(Self::Redeemed),
            "SharePriceChanged" => Ok(Self::SharePriceChanged),
            "ProtocolFeeAccrued" => Ok(Self::ProtocolFeeAccrued),
            other => Err(UnknownEventType(other.to_owned())),
        }
    }
}

#[cfg(test)]
mod event_type_tests {
    use super::*;
    use std::str::FromStr;

    /// Every [`EventType`] variant must round-trip through `as_str` /
    /// `FromStr` so the two string mappings cannot drift apart.
    #[test]
    fn from_str_round_trips_every_variant() {
        let variants = [
            EventType::AtomCreated,
            EventType::TripleCreated,
            EventType::Deposited,
            EventType::Redeemed,
            EventType::SharePriceChanged,
            EventType::ProtocolFeeAccrued,
        ];
        for v in variants {
            let s = v.as_str();
            let back = EventType::from_str(s).expect("round-trip must succeed");
            assert_eq!(v, back, "round-trip mismatch for {s}");
        }
    }

    #[test]
    fn from_str_rejects_unknown_string() {
        let err = EventType::from_str("NotARealEvent").unwrap_err();
        assert_eq!(err.0, "NotARealEvent");
        assert!(format!("{err}").contains("NotARealEvent"));
    }

    #[test]
    fn from_str_is_case_sensitive() {
        // PascalCase is the canonical form — "atomcreated" must fail so we
        // never accept accidentally-lowercased event types from upstream.
        assert!(EventType::from_str("atomcreated").is_err());
        assert!(EventType::from_str("ATOMCREATED").is_err());
    }
}

/// Vault type classification
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text")]
pub enum VaultType {
    Atom,
    Triple,
    Unknown,
}

impl std::fmt::Display for VaultType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            VaultType::Atom => write!(f, "Atom"),
            VaultType::Triple => write!(f, "Triple"),
            VaultType::Unknown => write!(f, "Unknown"),
        }
    }
}

/// Ingestion mode
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type)]
#[sqlx(type_name = "text")]
#[serde(rename_all = "lowercase")]
pub enum IngestionMode {
    Historical,
    Realtime,
}

impl std::fmt::Display for IngestionMode {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            IngestionMode::Historical => write!(f, "historical"),
            IngestionMode::Realtime => write!(f, "realtime"),
        }
    }
}
