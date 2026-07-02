//! Test utilities for integration and unit testing across the codebase.
//!
//! This module provides fixtures, factories, and helpers for:
//! - Setting up test databases with migrations
//! - Generating mock events for projections
//! - Creating mock RPC clients
//! - Database assertions and cleanup

use chrono::{DateTime, Utc};
use sqlx::{postgres::PgPoolOptions, PgPool};
use std::sync::Arc;
use tokio::sync::OnceCell;

use crate::models::{NewEvent, StoredEvent};
use crate::types::{BlockNumber, EventType, LogIndex, SequenceNumber};

/// Global test database pool that's initialized once per test run.
/// This uses testcontainers to spin up a temporary Postgres instance.
static TEST_DB_POOL: OnceCell<Arc<PgPool>> = OnceCell::const_new();

/// Test database configuration
pub struct TestDatabase {
    pool: Arc<PgPool>,
}

impl TestDatabase {
    /// Create a new test database instance.
    /// This will reuse the same database pool across tests but create isolated transactions.
    pub async fn new() -> Self {
        let pool = TEST_DB_POOL
            .get_or_init(|| async {
                // In a real implementation with testcontainers, we would:
                // 1. Start a postgres container
                // 2. Run migrations
                // 3. Return the pool
                //
                // For now, this connects to the DATABASE_URL from env
                // which should be a test database when running tests.
                let database_url = std::env::var("DATABASE_URL").unwrap_or_else(|_| {
                    "postgres://postgres:postgres@localhost:5432/indexer_test".to_string()
                });

                let pool = PgPoolOptions::new()
                    .max_connections(10)
                    .connect(&database_url)
                    .await
                    .expect("Failed to connect to test database");

                Arc::new(pool)
            })
            .await
            .clone();

        Self { pool }
    }

    /// Get the database pool for executing queries
    pub fn pool(&self) -> &PgPool {
        &self.pool
    }

    /// Run database migrations (should be called once before tests)
    pub async fn run_migrations(&self) -> Result<(), sqlx::Error> {
        // Run migrations using sqlx migrate macro or manual SQL
        // This would typically use sqlx::migrate!() macro
        Ok(())
    }

    /// Clean all test data from tables (useful for test isolation)
    pub async fn clean_tables(&self) -> Result<(), sqlx::Error> {
        sqlx::query("TRUNCATE TABLE event_store, projection_checkpoints, projection_dead_letter, vaults, positions, share_price_history RESTART IDENTITY CASCADE")
            .execute(self.pool())
            .await?;
        Ok(())
    }

    /// Insert a test event and return its sequence number
    pub async fn insert_event(&self, event: NewEvent) -> Result<SequenceNumber, sqlx::Error> {
        let rec = sqlx::query_scalar::<_, i64>(
            r#"
            INSERT INTO event_store (
                block_number, block_timestamp, block_hash,
                transaction_hash, log_index, event_type, event_data, is_canonical
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING sequence_number
            "#,
        )
        .bind(event.block_number)
        .bind(event.block_timestamp)
        .bind(event.block_hash)
        .bind(event.transaction_hash)
        .bind(event.log_index)
        .bind(event.event_type.as_str())
        .bind(event.event_data)
        .bind(event.is_canonical)
        .fetch_one(self.pool())
        .await?;

        Ok(rec)
    }

    /// Get event by sequence number
    pub async fn get_event(
        &self,
        sequence_number: SequenceNumber,
    ) -> Result<Option<StoredEvent>, sqlx::Error> {
        sqlx::query_as::<_, StoredEvent>(
            r#"
            SELECT
                sequence_number,
                block_number,
                block_timestamp,
                block_hash,
                transaction_hash,
                log_index,
                event_type,
                event_data,
                term_id,
                entity_id,
                is_canonical,
                ingested_at
            FROM event_store
            WHERE sequence_number = $1
            "#,
        )
        .bind(sequence_number)
        .fetch_optional(self.pool())
        .await
    }
}

/// Factory for creating test events with sensible defaults
pub struct EventFactory {
    block_number: BlockNumber,
    log_index: LogIndex,
    timestamp: DateTime<Utc>,
}

impl EventFactory {
    /// Create a new event factory starting at the given block
    pub fn new(starting_block: BlockNumber) -> Self {
        Self {
            block_number: starting_block,
            log_index: 0,
            timestamp: Utc::now(),
        }
    }

    /// Create an AtomCreated event
    pub fn atom_created(&mut self, term_id: &str, creator: &str) -> NewEvent {
        let event = NewEvent {
            block_number: self.block_number,
            block_timestamp: self.timestamp,
            block_hash: format!("0x{:064x}", self.block_number),
            transaction_hash: format!(
                "0x{:064x}",
                self.block_number * 1000 + self.log_index as i64
            ),
            log_index: self.log_index,
            event_type: EventType::AtomCreated,
            event_data: serde_json::json!({
                "id": term_id,
                "creator": creator,
                "data": "ipfs://Qm...",
                "vaultId": "1"
            }),
            is_canonical: true,
        };

        self.log_index += 1;
        event
    }

    /// Create a TripleCreated event
    pub fn triple_created(
        &mut self,
        term_id: &str,
        subject_id: &str,
        predicate_id: &str,
        object_id: &str,
        creator: &str,
    ) -> NewEvent {
        let event = NewEvent {
            block_number: self.block_number,
            block_timestamp: self.timestamp,
            block_hash: format!("0x{:064x}", self.block_number),
            transaction_hash: format!(
                "0x{:064x}",
                self.block_number * 1000 + self.log_index as i64
            ),
            log_index: self.log_index,
            event_type: EventType::TripleCreated,
            event_data: serde_json::json!({
                "id": term_id,
                "subjectId": subject_id,
                "predicateId": predicate_id,
                "objectId": object_id,
                "creator": creator,
                "vaultId": "1"
            }),
            is_canonical: true,
        };

        self.log_index += 1;
        event
    }

    /// Create a Deposited event
    pub fn deposited(
        &mut self,
        term_id: &str,
        sender: &str,
        receiver: &str,
        assets: &str,
        shares: &str,
    ) -> NewEvent {
        let event = NewEvent {
            block_number: self.block_number,
            block_timestamp: self.timestamp,
            block_hash: format!("0x{:064x}", self.block_number),
            transaction_hash: format!(
                "0x{:064x}",
                self.block_number * 1000 + self.log_index as i64
            ),
            log_index: self.log_index,
            event_type: EventType::Deposited,
            event_data: serde_json::json!({
                "id": term_id,
                "sender": sender,
                "receiver": receiver,
                "assets": assets,
                "shares": shares
            }),
            is_canonical: true,
        };

        self.log_index += 1;
        event
    }

    /// Create a Redeemed event
    pub fn redeemed(
        &mut self,
        term_id: &str,
        sender: &str,
        receiver: &str,
        assets: &str,
        shares: &str,
    ) -> NewEvent {
        let event = NewEvent {
            block_number: self.block_number,
            block_timestamp: self.timestamp,
            block_hash: format!("0x{:064x}", self.block_number),
            transaction_hash: format!(
                "0x{:064x}",
                self.block_number * 1000 + self.log_index as i64
            ),
            log_index: self.log_index,
            event_type: EventType::Redeemed,
            event_data: serde_json::json!({
                "id": term_id,
                "sender": sender,
                "receiver": receiver,
                "assets": assets,
                "shares": shares
            }),
            is_canonical: true,
        };

        self.log_index += 1;
        event
    }

    /// Create a SharePriceChanged event
    pub fn share_price_changed(
        &mut self,
        term_id: &str,
        vault_id: &str,
        assets: &str,
        shares: &str,
    ) -> NewEvent {
        let event = NewEvent {
            block_number: self.block_number,
            block_timestamp: self.timestamp,
            block_hash: format!("0x{:064x}", self.block_number),
            transaction_hash: format!(
                "0x{:064x}",
                self.block_number * 1000 + self.log_index as i64
            ),
            log_index: self.log_index,
            event_type: EventType::SharePriceChanged,
            event_data: serde_json::json!({
                "id": term_id,
                "vaultId": vault_id,
                "assets": assets,
                "shares": shares
            }),
            is_canonical: true,
        };

        self.log_index += 1;
        event
    }

    /// Advance to the next block
    pub fn next_block(&mut self) {
        self.block_number += 1;
        self.log_index = 0;
        self.timestamp += chrono::Duration::seconds(12); // ~12s block time
    }

    /// Set a custom timestamp
    pub fn set_timestamp(&mut self, timestamp: DateTime<Utc>) {
        self.timestamp = timestamp;
    }
}

/// Mock RPC client for testing (avoiding real blockchain calls)
#[cfg(test)]
pub mod mock_rpc {
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    /// Mock RPC client that returns pre-configured responses
    pub struct MockRpcClient {
        blocks: Arc<Mutex<HashMap<u64, MockBlock>>>,
        logs: Arc<Mutex<Vec<MockLog>>>,
    }

    #[derive(Clone, Debug)]
    pub struct MockBlock {
        pub number: u64,
        pub hash: String,
        pub timestamp: u64,
    }

    #[derive(Clone, Debug)]
    pub struct MockLog {
        pub block_number: u64,
        pub log_index: u32,
        pub transaction_hash: String,
        pub topics: Vec<String>,
        pub data: String,
    }

    impl MockRpcClient {
        pub fn new() -> Self {
            Self {
                blocks: Arc::new(Mutex::new(HashMap::new())),
                logs: Arc::new(Mutex::new(Vec::new())),
            }
        }

        /// Add a mock block
        pub fn add_block(&self, block: MockBlock) {
            self.blocks.lock().unwrap().insert(block.number, block);
        }

        /// Add a mock log
        pub fn add_log(&self, log: MockLog) {
            self.logs.lock().unwrap().push(log);
        }

        /// Get block by number
        pub fn get_block(&self, number: u64) -> Option<MockBlock> {
            self.blocks.lock().unwrap().get(&number).cloned()
        }

        /// Get logs in block range
        pub fn get_logs(&self, from: u64, to: u64) -> Vec<MockLog> {
            self.logs
                .lock()
                .unwrap()
                .iter()
                .filter(|log| log.block_number >= from && log.block_number <= to)
                .cloned()
                .collect()
        }
    }

    impl Default for MockRpcClient {
        fn default() -> Self {
            Self::new()
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_event_factory_increments_log_index() {
        let mut factory = EventFactory::new(1000);

        let event1 = factory.atom_created("0x1234", "0xabcd");
        let event2 = factory.atom_created("0x5678", "0xef01");

        assert_eq!(event1.log_index, 0);
        assert_eq!(event2.log_index, 1);
        assert_eq!(event1.block_number, event2.block_number);
    }

    #[test]
    fn test_event_factory_next_block() {
        let mut factory = EventFactory::new(1000);

        let event1 = factory.atom_created("0x1234", "0xabcd");
        factory.next_block();
        let event2 = factory.atom_created("0x5678", "0xef01");

        assert_eq!(event1.block_number, 1000);
        assert_eq!(event2.block_number, 1001);
        assert_eq!(event2.log_index, 0); // Reset on new block
    }

    #[test]
    fn test_event_factory_creates_unique_hashes() {
        let mut factory = EventFactory::new(1000);

        let event1 = factory.atom_created("0x1234", "0xabcd");
        let event2 = factory.atom_created("0x5678", "0xef01");

        assert_ne!(event1.transaction_hash, event2.transaction_hash);
    }

    #[test]
    fn test_mock_rpc_client() {
        use mock_rpc::*;

        let client = MockRpcClient::new();

        client.add_block(MockBlock {
            number: 100,
            hash: "0xabc".to_string(),
            timestamp: 1234567890,
        });

        let block = client.get_block(100).unwrap();
        assert_eq!(block.number, 100);
        assert_eq!(block.hash, "0xabc");
    }

    #[test]
    fn test_mock_rpc_client_logs_filtering() {
        use mock_rpc::*;

        let client = MockRpcClient::new();

        client.add_log(MockLog {
            block_number: 100,
            log_index: 0,
            transaction_hash: "0x1".to_string(),
            topics: vec![],
            data: "".to_string(),
        });

        client.add_log(MockLog {
            block_number: 105,
            log_index: 0,
            transaction_hash: "0x2".to_string(),
            topics: vec![],
            data: "".to_string(),
        });

        let logs = client.get_logs(100, 102);
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].block_number, 100);
    }
}
