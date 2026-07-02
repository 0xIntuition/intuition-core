//! Thin adapters that bridge existing worker types to the [`SupervisedWorker`] trait.
//!
//! Each adapter holds an `Option<ConcreteWorker>` that is `.take()`n on every
//! `run()` call.  The supervisor's factory closure re-populates it with a fresh
//! worker before each restart.
//!
//! ## Why Option<Worker>?
//!
//! All concrete worker types (`Worker`, `PgWorker`, `BatchWorker`,
//! `CoreEntitiesWorker`) consume `self` on `.run()` — there is no way to call
//! `run` twice on the same instance.  The `SupervisedWorker` trait requires
//! `&mut self`, however, so we store the worker behind an `Option` and `.take()`
//! it out on each call.  The supervisor's factory closure must have repopulated
//! the `Option` before calling `run()` again; the `expect` messages below will
//! surface if that contract is violated.

use super::supervisor::{SupervisedWorker, WorkerError};
use crate::error::{ErrorClass, ProjectionError};
use tokio_util::sync::CancellationToken;

/// Convert a [`ProjectionError`] into a [`WorkerError`] using exhaustive
/// classification.
///
/// * `Transient` / `CircuitProtected` → `WorkerError::Transient` (supervisor restarts).
/// * `Fatal` → `WorkerError::Fatal` (supervisor stops permanently).
fn to_worker_error(e: ProjectionError) -> WorkerError {
    match e.classify() {
        ErrorClass::Transient | ErrorClass::CircuitProtected => {
            WorkerError::Transient(e.to_string())
        }
        ErrorClass::Fatal => WorkerError::Fatal(e.to_string()),
    }
}

/// Generate a [`SupervisedWorker`] adapter for a worker type whose `run`
/// method consumes `self`.
///
/// Usage: `supervised_adapter!(AdapterName, path::to::WorkerType);`
macro_rules! supervised_adapter {
    ($name:ident, $worker_type:ty) => {
        pub struct $name {
            #[allow(dead_code)]
            label: String,
            inner: Option<$worker_type>,
        }
        impl $name {
            pub fn new(label: impl Into<String>, worker: $worker_type) -> Self {
                Self { label: label.into(), inner: Some(worker) }
            }
        }
        impl SupervisedWorker for $name {
            fn name(&self) -> &str { &self.label }
            async fn run(&mut self, token: CancellationToken) -> Result<(), WorkerError> {
                // The supervisor's factory closure constructs a fresh adapter
                // (with `Some(worker)`) before each restart, so this expect is
                // a contract violation, not a recoverable runtime error.
                let worker = self.inner.take().expect(concat!(
                    stringify!($name), "::run called on consumed adapter; factory must provide a fresh instance each restart"
                ));
                worker.run(token).await.map_err(to_worker_error)
            }
        }
    };
}

supervised_adapter!(SupervisedSurrealWorker, crate::worker::Worker);
supervised_adapter!(SupervisedPgWorker, crate::worker::PgWorker);
supervised_adapter!(SupervisedBatchWorker, crate::worker::BatchWorker);

/// Adapter for [`CoreEntitiesWorker`](crate::worker::CoreEntitiesWorker).
///
/// Unlike the macro-generated adapters, `CoreEntitiesWorker` is always a
/// singleton with a fixed label (`"core_entities:dual"`), so `new` takes
/// only the worker — no label argument.
pub struct SupervisedCoreEntitiesWorker {
    inner: Option<crate::worker::CoreEntitiesWorker>,
}
impl SupervisedCoreEntitiesWorker {
    pub fn new(worker: crate::worker::CoreEntitiesWorker) -> Self {
        Self {
            inner: Some(worker),
        }
    }
}
impl SupervisedWorker for SupervisedCoreEntitiesWorker {
    // Fixed label — CoreEntitiesWorker is always a singleton.
    fn name(&self) -> &str {
        "core_entities:dual"
    }
    async fn run(&mut self, token: CancellationToken) -> Result<(), WorkerError> {
        let worker = self.inner.take().expect(
            "SupervisedCoreEntitiesWorker::run called on consumed adapter; factory must provide a fresh instance each restart",
        );
        worker.run(token).await.map_err(to_worker_error)
    }
}
