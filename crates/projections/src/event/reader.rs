use async_trait::async_trait;
use shared::models::StoredEvent;
use sqlx::PgPool;

use super::source::EventSource;
use crate::error::Result;

pub struct EventReader {
    pool: PgPool,
}

impl EventReader {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait]
impl EventSource for EventReader {
    async fn read_batch_multi(
        &self,
        event_types: &[&str],
        after_sequence: i64,
        batch_size: i64,
    ) -> Result<Vec<StoredEvent>> {
        let events = sqlx::query_as::<_, StoredEvent>(
            "SELECT sequence_number, block_number, block_timestamp, block_hash,
                    transaction_hash, log_index, event_type, event_data,
                    term_id, entity_id, is_canonical, ingested_at
             FROM event_store
             WHERE event_type = ANY($1)
               AND sequence_number > $2
               AND is_canonical = true
             ORDER BY sequence_number ASC
             LIMIT $3",
        )
        .bind(event_types)
        .bind(after_sequence)
        .bind(batch_size)
        .fetch_all(&self.pool)
        .await?;

        Ok(events)
    }
}
