//! Shared Types and Utilities for Intuition Blockchain Indexer
//!
//! This crate provides common types, utilities, and abstractions used across
//! the indexing system (ingestion service, projection workers, and API server).
//!
//! # Modules
//!
//! ## Models
//!
//! Core data models representing blockchain events and database entities:
//! - `StoredEvent` - Canonical representation of an indexed blockchain event
//! - Event metadata (block number, timestamp, transaction hash)
//!
//! ## Types
//!
//! Type aliases and newtype wrappers for domain concepts:
//! - `BlockNumber` - Block height (i64)
//! - `Numeric` - PostgreSQL NUMERIC type for precise decimal math
//! - Address and hash types
//!
//! ## Errors
//!
//! Unified error type (`IndexerError`) used across all services:
//! - `DependencyMissing` - Referenced data not yet available
//! - `Database` - Database operation failed
//! - `InvalidEventData` - Malformed event data
//! - `ConnectionPool` - Connection pool exhausted
//!
//! ## Locking
//!
//! PostgreSQL advisory lock utilities for preventing race conditions:
//! - `acquire_vault_lock` - Acquires an advisory lock on a vault
//! - `LockableEvent` - Trait for events that affect lockable resources
//!
//! Lock ordering is deterministic (lexicographic by resource ID) to prevent deadlocks.
//!
//! ## Configuration
//!
//! Shared configuration utilities and constants.
//!
//! # Usage
//!
//! ```rust
//! use shared::{
//!     errors::{IndexerError, Result},
//!     models::StoredEvent,
//!     types::BlockNumber,
//! };
//!
//! fn process_event(event: &StoredEvent) -> Result<()> {
//!     let block: BlockNumber = event.block_number;
//!     // Process event...
//!     Ok(())
//! }
//! ```

pub mod config;
pub mod errors;
pub mod graph_flags;
pub mod locking;
pub mod models;
pub mod parsed_event;
pub mod types;

// Test utilities (only available in test builds)
#[cfg(test)]
pub mod test_utils;

// Property-based test invariants
#[cfg(test)]
mod proptest_invariants;

// Re-export commonly used types
pub use errors::*;
pub use locking::*;
pub use models::*;
pub use parsed_event::{EventMetadata, EventMetadataRef, ParseError, ParsedEvent};
pub use types::*;
