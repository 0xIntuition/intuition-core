//! Worker types that drive projections through the event log.

pub mod batch;
pub mod core_entities;
pub mod pg;
pub mod surreal;

pub use batch::BatchWorker;
pub use core_entities::CoreEntitiesWorker;
pub use pg::PgWorker;
pub use surreal::Worker;
