//! Projection of `AtomContextRegistered` into the KG database.
//!
//! `atom_context:dual` deliberately owns an independent event-stream
//! checkpoint. It joins context events to `kg.nodes` by the exact on-chain
//! `term_id`, writes one immutable row per URI, and appends one `kg.events`
//! evidence row per registration event. It never mutates the atom payload or
//! attempts to resolve, normalize, fetch, or trust a URI.

use async_trait::async_trait;
use serde_json::json;
use shared::models::{AtomContextRegisteredRecord, StoredEvent};
use shared::parsed_event::{EventMetadata, ParsedEvent};
use shared::types::EventType;
use sqlx::{PgPool, Postgres, Transaction};
use tracing::warn;

use crate::error::ProjectionError;
use crate::projection::pg::PgProjection;

const PROJECTION_NAME: &str = "atom_context:dual";
const NODE_LOOKUP_SQL: &str = "SELECT classification_type FROM kg.nodes WHERE id = $1";
const CONTEXT_INSERT_SQL: &str = "INSERT INTO kg.node_contexts
         (node_id, event_sequence, block_number, block_timestamp,
          block_hash, transaction_hash, log_index, ordinal,
          registrant, uri_hex, uri_text)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (node_id, transaction_hash, log_index, ordinal) DO NOTHING";
const EVIDENCE_INSERT_SQL: &str = "INSERT INTO kg.events
         (event_time, id, actor_id, entity_kind, entity_id, event_type,
          classification_type, is_onchain, block_number, tx_hash,
          payload, created_at)
     VALUES ($1, $2, $3, 'node', $4, 'atom_context_registered',
             $5, true, $6, $7, $8, now())
     ON CONFLICT (event_time, id) DO NOTHING";

/// A byte-preserving URI representation ready for storage.
#[derive(Debug, Clone, PartialEq, Eq)]
struct ProjectedUri {
    ordinal: i32,
    uri_hex: String,
    uri_text: Option<String>,
}

/// KG-only context projector. The legacy pool supplied by [`PgProjection`]
/// is intentionally ignored; it remains the event/checkpoint database only.
pub struct AtomContextDualProjection {
    kg_pool: PgPool,
}

impl AtomContextDualProjection {
    pub fn new(kg_pool: PgPool) -> Self {
        Self { kg_pool }
    }
}

#[async_trait]
impl PgProjection for AtomContextDualProjection {
    fn name(&self) -> &str {
        PROJECTION_NAME
    }

    fn event_types(&self) -> &'static [EventType] {
        &[EventType::AtomContextRegistered]
    }

    fn uses_typed_events(&self) -> bool {
        true
    }

    async fn process_parsed_batch(
        &self,
        _event_store_pool: &PgPool,
        events: &[ParsedEvent],
    ) -> Result<(), ProjectionError> {
        let mut tx = self.kg_pool.begin().await?;

        for event in events {
            match event {
                ParsedEvent::AtomContextRegistered { metadata, data } => {
                    project_context_event(&mut tx, metadata, data).await?;
                }
                ParsedEvent::Unknown(raw)
                    if raw.event_type == EventType::AtomContextRegistered.as_str() =>
                {
                    // A malformed context payload must pin this projection's
                    // checkpoint. Advancing would permanently lose URI bytes.
                    return Err(ProjectionError::InvalidEventData(format!(
                        "sequence {} could not be parsed as AtomContextRegistered",
                        raw.sequence_number
                    )));
                }
                _ => {
                    // The worker filters by event_types(), so unrelated typed
                    // variants are only possible in direct unit/test calls.
                }
            }
        }

        tx.commit().await?;
        Ok(())
    }

    async fn process_batch(
        &self,
        pool: &PgPool,
        events: &[StoredEvent],
    ) -> Result<(), ProjectionError> {
        let parsed: Vec<_> = events
            .iter()
            .map(|event| ParsedEvent::parse_or_unknown(event.clone()).0)
            .collect();
        self.process_parsed_batch(pool, &parsed).await
    }
}

async fn project_context_event(
    tx: &mut Transaction<'_, Postgres>,
    metadata: &EventMetadata,
    data: &AtomContextRegisteredRecord,
) -> Result<(), ProjectionError> {
    // This exact equality is the dependency barrier between atom creation and
    // context registration. RowNotFound is transient to the worker, so the
    // transaction rolls back and the dedicated checkpoint remains pinned.
    let classification_type = sqlx::query_scalar::<_, String>(NODE_LOOKUP_SQL)
        .bind(&data.term_id)
        .fetch_optional(&mut **tx)
        .await?;
    let Some(classification_type) = classification_type else {
        warn!(
            projection = PROJECTION_NAME,
            sequence = metadata.sequence_number,
            term_id = %data.term_id,
            "Context dependency not ready: exact kg.nodes row is missing"
        );
        return Err(sqlx::Error::RowNotFound.into());
    };

    let projected_uris = project_uris(&data.uris)?;

    for uri in &projected_uris {
        sqlx::query(CONTEXT_INSERT_SQL)
            .bind(&data.term_id)
            .bind(metadata.sequence_number)
            .bind(metadata.block_number)
            .bind(metadata.block_timestamp)
            .bind(&metadata.block_hash)
            .bind(&metadata.transaction_hash)
            .bind(metadata.log_index)
            .bind(uri.ordinal)
            .bind(&data.registrant)
            .bind(&uri.uri_hex)
            .bind(&uri.uri_text)
            .execute(&mut **tx)
            .await?;
    }

    let event_id = context_event_id(&metadata.transaction_hash, metadata.log_index);
    let uri_hex: Vec<&str> = projected_uris
        .iter()
        .map(|uri| uri.uri_hex.as_str())
        .collect();
    let payload = json!({
        "event_sequence": metadata.sequence_number,
        "block_hash": metadata.block_hash,
        "log_index": metadata.log_index,
        "is_canonical": metadata.is_canonical,
        "uris": uri_hex,
    });

    sqlx::query(EVIDENCE_INSERT_SQL)
        .bind(metadata.block_timestamp)
        .bind(event_id)
        .bind(&data.registrant)
        .bind(&data.term_id)
        .bind(classification_type)
        .bind(metadata.block_number)
        .bind(&metadata.transaction_hash)
        .bind(payload)
        .execute(&mut **tx)
        .await?;

    Ok(())
}

fn project_uris(uris: &[String]) -> Result<Vec<ProjectedUri>, ProjectionError> {
    uris.iter()
        .enumerate()
        .map(|(ordinal, raw)| {
            let ordinal = i32::try_from(ordinal).map_err(|_| {
                ProjectionError::InvalidEventData(
                    "AtomContextRegistered URI ordinal exceeds int32".to_owned(),
                )
            })?;
            let encoded = raw.strip_prefix("0x").ok_or_else(|| {
                ProjectionError::InvalidEventData(format!(
                    "context URI at ordinal {ordinal} is not 0x-prefixed hex"
                ))
            })?;
            let bytes = hex::decode(encoded).map_err(|_| {
                ProjectionError::InvalidEventData(format!(
                    "context URI at ordinal {ordinal} is not valid even-length hex"
                ))
            })?;

            // Re-encoding makes the stored representation canonical without
            // changing a byte of the underlying opaque value.
            let uri_hex = format!("0x{}", hex::encode(&bytes));
            let uri_text = String::from_utf8(bytes)
                .ok()
                .filter(|value| !value.contains('\0'));

            Ok(ProjectedUri {
                ordinal,
                uri_hex,
                uri_text,
            })
        })
        .collect()
}

fn context_event_id(transaction_hash: &str, log_index: i32) -> String {
    format!("atom_context:{transaction_hash}:{log_index}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn projection_preserves_order_and_duplicates() {
        let input = vec![
            "0x69703a666f6f".to_owned(),
            "0x69703a626172".to_owned(),
            "0x69703a666f6f".to_owned(),
        ];

        let rows = project_uris(&input).expect("valid opaque bytes");

        assert_eq!(
            rows.iter().map(|row| row.ordinal).collect::<Vec<_>>(),
            [0, 1, 2]
        );
        assert_eq!(rows[0].uri_hex, rows[2].uri_hex);
        assert_eq!(rows[0].uri_text.as_deref(), Some("ip:foo"));
        assert_eq!(rows[1].uri_text.as_deref(), Some("ip:bar"));
    }

    #[test]
    fn unsafe_bytes_remain_in_hex_without_lossy_text() {
        let rows = project_uris(&[
            "0xfffe".to_owned(),
            "0x610062".to_owned(),
            "0x68747470733a2f2f6578616d706c652e636f6d".to_owned(),
        ])
        .expect("all values are valid bytes");

        assert_eq!(rows[0].uri_hex, "0xfffe");
        assert_eq!(rows[0].uri_text, None);
        assert_eq!(rows[1].uri_hex, "0x610062");
        assert_eq!(rows[1].uri_text, None);
        assert_eq!(rows[2].uri_text.as_deref(), Some("https://example.com"));
    }

    #[test]
    fn canonicalizes_hex_representation_without_normalizing_uri_bytes() {
        let rows = project_uris(&["0x49503A414243".to_owned()]).expect("valid bytes");

        assert_eq!(rows[0].uri_hex, "0x49503a414243");
        assert_eq!(rows[0].uri_text.as_deref(), Some("IP:ABC"));
    }

    #[test]
    fn malformed_hex_is_rejected_so_checkpoint_cannot_advance() {
        assert!(matches!(
            project_uris(&["ip:abc".to_owned()]),
            Err(ProjectionError::InvalidEventData(_))
        ));
        assert!(matches!(
            project_uris(&["0xabc".to_owned()]),
            Err(ProjectionError::InvalidEventData(_))
        ));
    }

    #[test]
    fn replay_keys_are_deterministic() {
        let first = project_uris(&["0x61".to_owned(), "0x61".to_owned()]).unwrap();
        let replay = project_uris(&["0x61".to_owned(), "0x61".to_owned()]).unwrap();

        assert_eq!(first, replay);
        assert_eq!(
            context_event_id("0xdeadbeef", 7),
            context_event_id("0xdeadbeef", 7)
        );
        assert_ne!(first[0].ordinal, first[1].ordinal);
        assert!(CONTEXT_INSERT_SQL.contains("ON CONFLICT"));
        assert!(CONTEXT_INSERT_SQL.contains("DO NOTHING"));
        assert!(EVIDENCE_INSERT_SQL.contains("ON CONFLICT"));
        assert!(EVIDENCE_INSERT_SQL.contains("DO NOTHING"));
    }

    #[test]
    fn missing_node_is_a_transient_database_dependency() {
        let error = ProjectionError::from(sqlx::Error::RowNotFound);
        assert_eq!(error.classify(), crate::error::ErrorClass::Transient);
    }
}
