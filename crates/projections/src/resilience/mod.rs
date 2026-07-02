//! Fault-tolerance infrastructure: circuit breaker, retry, supervisor, watchdog,
//! connection management, and checkpoint persistence.

pub mod checkpoint;
pub mod circuit_breaker;
pub mod connection_manager;
pub mod retry;
pub mod supervised_adapters;
pub mod supervisor;
pub mod watchdog;

// Re-export the types used by main.rs via the short `resilience::` form.
pub use checkpoint::CheckpointStore;
pub use circuit_breaker::CircuitBreaker;
pub use supervisor::Supervisor;
pub use watchdog::Heartbeat;
