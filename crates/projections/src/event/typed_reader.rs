//! Reads events from per-type typed tables instead of the monolithic event_store.
//!
//! Each typed table (e.g. `atom_created_events`, `deposited_events`) stores
//! strongly-typed columns. This reader reconstructs `StoredEvent` (including
//! the `event_data` JSONB) via SQL `jsonb_build_object`, so downstream
//! projections see the exact same `StoredEvent` shape — zero code changes
//! required in projection logic.
//!
//! For multi-event projections, individual typed table SELECTs are combined
//! with UNION ALL and a final ORDER BY sequence_number / LIMIT.

use async_trait::async_trait;
use shared::models::StoredEvent;
use sqlx::PgPool;

use super::source::EventSource;
use crate::error::Result;

pub struct TypedEventReader {
    pool: PgPool,
}

impl TypedEventReader {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

// ---------------------------------------------------------------------------
// SQL fragments per event type
// ---------------------------------------------------------------------------
// Each fragment SELECTs the same 12 columns as StoredEvent, reconstructing
// event_data via jsonb_build_object. NUMERIC columns are cast to TEXT to
// match the original JSON string representation from the indexer handlers.
//
// The fragments use $1 for after_sequence (shared across UNION ALL).
// ---------------------------------------------------------------------------

fn sql_fragment(event_type: &str) -> Option<&'static str> {
    match event_type {
        "AtomCreated" => Some(
            r#"SELECT sequence_number, block_number, block_timestamp, block_hash,
                      transaction_hash, log_index,
                      'AtomCreated'::TEXT AS event_type,
                      jsonb_build_object(
                          'creator', creator,
                          'term_id', term_id_hex,
                          'atom_data', atom_data,
                          'atom_wallet', atom_wallet
                      ) AS event_data,
                      term_id_hex AS term_id,
                      NULL::TEXT AS entity_id,
                      true AS is_canonical,
                      block_timestamp AS ingested_at
               FROM atom_created_events
               WHERE sequence_number > $1"#,
        ),
        "TripleCreated" => Some(
            r#"SELECT sequence_number, block_number, block_timestamp, block_hash,
                      transaction_hash, log_index,
                      'TripleCreated'::TEXT AS event_type,
                      jsonb_build_object(
                          'creator', creator,
                          'term_id', term_id_hex,
                          'subject_id', subject_id_hex,
                          'predicate_id', predicate_id_hex,
                          'object_id', object_id_hex
                      ) AS event_data,
                      term_id_hex AS term_id,
                      NULL::TEXT AS entity_id,
                      true AS is_canonical,
                      block_timestamp AS ingested_at
               FROM triple_created_events
               WHERE sequence_number > $1"#,
        ),
        "Deposited" => Some(
            r#"SELECT sequence_number, block_number, block_timestamp, block_hash,
                      transaction_hash, log_index,
                      'Deposited'::TEXT AS event_type,
                      jsonb_build_object(
                          'sender', sender,
                          'receiver', receiver,
                          'term_id', term_id_hex,
                          'curve_id', curve_id::TEXT,
                          'assets', assets::TEXT,
                          'assets_after_fees', assets_after_fees::TEXT,
                          'shares', shares::TEXT,
                          'total_shares', total_shares::TEXT,
                          'vault_type', vault_type
                      ) AS event_data,
                      term_id_hex AS term_id,
                      receiver AS entity_id,
                      true AS is_canonical,
                      block_timestamp AS ingested_at
               FROM deposited_events
               WHERE sequence_number > $1"#,
        ),
        "Redeemed" => Some(
            r#"SELECT sequence_number, block_number, block_timestamp, block_hash,
                      transaction_hash, log_index,
                      'Redeemed'::TEXT AS event_type,
                      jsonb_build_object(
                          'sender', sender,
                          'receiver', receiver,
                          'term_id', term_id_hex,
                          'curve_id', curve_id::TEXT,
                          'shares', shares::TEXT,
                          'total_shares', total_shares::TEXT,
                          'assets', assets::TEXT,
                          'fees', fees::TEXT,
                          'vault_type', vault_type
                      ) AS event_data,
                      term_id_hex AS term_id,
                      receiver AS entity_id,
                      true AS is_canonical,
                      block_timestamp AS ingested_at
               FROM redeemed_events
               WHERE sequence_number > $1"#,
        ),
        "SharePriceChanged" => Some(
            r#"SELECT sequence_number, block_number, block_timestamp, block_hash,
                      transaction_hash, log_index,
                      'SharePriceChanged'::TEXT AS event_type,
                      jsonb_build_object(
                          'term_id', term_id_hex,
                          'curve_id', curve_id::TEXT,
                          'share_price', share_price::TEXT,
                          'total_assets', total_assets::TEXT,
                          'total_shares', total_shares::TEXT,
                          'vault_type', vault_type
                      ) AS event_data,
                      term_id_hex AS term_id,
                      NULL::TEXT AS entity_id,
                      true AS is_canonical,
                      block_timestamp AS ingested_at
               FROM share_price_changed_events
               WHERE sequence_number > $1"#,
        ),
        "ProtocolFeeAccrued" => Some(
            r#"SELECT sequence_number, block_number, block_timestamp, block_hash,
                      transaction_hash, log_index,
                      'ProtocolFeeAccrued'::TEXT AS event_type,
                      jsonb_build_object(
                          'epoch', epoch::TEXT,
                          'sender', sender,
                          'amount', amount::TEXT
                      ) AS event_data,
                      NULL::TEXT AS term_id,
                      sender AS entity_id,
                      true AS is_canonical,
                      block_timestamp AS ingested_at
               FROM protocol_fee_accrued_events
               WHERE sequence_number > $1"#,
        ),
        _ => None,
    }
}

/// Build a UNION ALL query from the given event types.
///
/// Each sub-query reads from its typed table with `WHERE sequence_number > $1`.
/// The outer query adds `ORDER BY sequence_number ASC LIMIT $2`.
///
/// Uses `format!` for SQL composition, which is safe here because
/// event type strings come from a fixed enum — never from user input.
fn build_union_query(event_types: &[&str]) -> String {
    let fragments: Vec<&str> = event_types
        .iter()
        .filter_map(|et| sql_fragment(et))
        .collect();

    if fragments.len() == 1 {
        // Single table — no UNION ALL overhead
        format!("{} ORDER BY sequence_number ASC LIMIT $2", fragments[0])
    } else {
        // Each sub-query gets its own ORDER BY / LIMIT so PostgreSQL only
        // reads at most batch_size rows per table (index scan on
        // ux_*_seq) instead of scanning all qualifying rows before the
        // outer sort.
        let union = fragments
            .iter()
            .map(|f| format!("({f} ORDER BY sequence_number ASC LIMIT $2)"))
            .collect::<Vec<_>>()
            .join("\nUNION ALL\n");
        format!("{union}\nORDER BY sequence_number ASC LIMIT $2")
    }
}

#[async_trait]
impl EventSource for TypedEventReader {
    async fn read_batch_multi(
        &self,
        event_types: &[&str],
        after_sequence: i64,
        batch_size: i64,
    ) -> Result<Vec<StoredEvent>> {
        if event_types.is_empty() {
            return Ok(Vec::new());
        }

        let query = build_union_query(event_types);

        let events = sqlx::query_as::<_, StoredEvent>(&query)
            .bind(after_sequence)
            .bind(batch_size)
            .fetch_all(&self.pool)
            .await?;

        Ok(events)
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn single_event_type_no_union() {
        let q = build_union_query(&["AtomCreated"]);
        assert!(!q.contains("UNION ALL"));
        assert!(q.contains("atom_created_events"));
        assert!(q.contains("ORDER BY sequence_number ASC LIMIT $2"));
    }

    #[test]
    fn multi_event_types_union_all() {
        let q = build_union_query(&["Deposited", "Redeemed"]);
        assert!(q.contains("UNION ALL"));
        assert!(q.contains("deposited_events"));
        assert!(q.contains("redeemed_events"));
        assert!(q.contains("ORDER BY sequence_number ASC LIMIT $2"));
    }

    #[test]
    fn all_six_event_types() {
        let q = build_union_query(&[
            "AtomCreated",
            "TripleCreated",
            "Deposited",
            "Redeemed",
            "SharePriceChanged",
            "ProtocolFeeAccrued",
        ]);
        // 5 UNION ALL connectors for 6 fragments
        assert_eq!(q.matches("UNION ALL").count(), 5);
    }

    #[test]
    fn unknown_event_type_ignored() {
        let q = build_union_query(&["Unknown"]);
        // No fragments matched, so the query is just the ORDER BY / LIMIT
        // (would produce empty result set, but won't panic)
        assert!(q.contains("ORDER BY"));
    }

    #[test]
    fn jsonb_build_object_casts_numeric_to_text() {
        let q = build_union_query(&["Deposited"]);
        // Numeric-only columns (curve_id, assets, shares) must still be cast to
        // TEXT so that serde_json can deserialise them into BigDecimal via string
        // parsing.  term_id is now sourced from the hex column, not ::TEXT.
        assert!(q.contains("curve_id::TEXT"));
        assert!(q.contains("assets::TEXT"));
        assert!(q.contains("shares::TEXT"));
        // term_id comes from the hex column — no decimal cast.
        assert!(q.contains("term_id_hex"));
        assert!(!q.contains("term_id::TEXT"));
    }

    #[test]
    fn triple_created_uses_hex_ids_not_decimal() {
        let q = build_union_query(&["TripleCreated"]);
        // term_id / subject_id / predicate_id / object_id in event_data must
        // use the *_hex columns so that String deserialization succeeds.
        assert!(q.contains("term_id_hex"));
        assert!(q.contains("subject_id_hex"));
        assert!(q.contains("predicate_id_hex"));
        assert!(q.contains("object_id_hex"));
        // The NUMERIC::TEXT forms must NOT appear inside jsonb_build_object for
        // these ID fields (they are still read via term_id_hex AS term_id in the
        // outer SELECT for the StoredEvent.term_id column, which is fine).
        // Verify the query does not cast the ID numerics to text.
        assert!(!q.contains("subject_id::TEXT"));
        assert!(!q.contains("predicate_id::TEXT"));
        assert!(!q.contains("object_id::TEXT"));
    }
}
