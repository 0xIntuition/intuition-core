use sqlx::PgPool;

use crate::error::Result;

pub struct CheckpointStore {
    pool: PgPool,
}

impl CheckpointStore {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    pub async fn get_checkpoint(&self, projection_name: &str, sink_name: &str) -> Result<i64> {
        let row = sqlx::query_scalar::<_, Option<i64>>(
            "SELECT last_sequence_number FROM projection_checkpoints
             WHERE projection_name = $1 AND sink_name = $2",
        )
        .bind(projection_name)
        .bind(sink_name)
        .fetch_optional(&self.pool)
        .await?;

        Ok(row.flatten().unwrap_or(0))
    }

    pub async fn save_checkpoint(
        &self,
        projection_name: &str,
        sink_name: &str,
        sequence_number: i64,
        block_number: i64,
    ) -> Result<()> {
        let key = format!("{projection_name}:{sink_name}");
        sqlx::query(
            "INSERT INTO projection_checkpoints (checkpoint_key, projection_name, sink_name, last_sequence_number, last_block_number)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (checkpoint_key) DO UPDATE SET
                 last_sequence_number = EXCLUDED.last_sequence_number,
                 last_block_number = EXCLUDED.last_block_number,
                 last_updated_at = NOW()",
        )
        .bind(&key)
        .bind(projection_name)
        .bind(sink_name)
        .bind(sequence_number)
        .bind(block_number)
        .execute(&self.pool)
        .await?;

        Ok(())
    }
}
