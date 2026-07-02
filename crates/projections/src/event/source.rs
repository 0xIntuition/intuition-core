//! Abstraction over event reading, allowing projections to consume events
//! from either the monolithic `event_store` or per-type typed tables.
//!
//! Both `EventReader` and `TypedEventReader` implement this trait, enabling
//! a runtime switch via the `USE_TYPED_READER` environment variable.

use async_trait::async_trait;
use shared::models::StoredEvent;

use crate::error::Result;

/// Trait for reading batches of events by type, ordered by sequence_number.
///
/// Workers use this to poll for new events. The trait is object-safe so it
/// can be stored as `Arc<dyn EventSource>` in workers.
#[async_trait]
pub trait EventSource: Send + Sync + 'static {
    /// Read a batch of events for multiple event types at once.
    ///
    /// Events are returned ordered by `sequence_number ASC` across all types,
    /// preserving global causal ordering for multi-event projections.
    async fn read_batch_multi(
        &self,
        event_types: &[&str],
        after_sequence: i64,
        batch_size: i64,
    ) -> Result<Vec<StoredEvent>>;
}
