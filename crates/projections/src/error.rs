use thiserror::Error;

/// Classification of a [`ProjectionError`] for retry and supervision decisions.
///
/// Callers must match on `classify()` exhaustively to handle all variants.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[must_use = "error classification should be matched exhaustively"]
pub enum ErrorClass {
    /// Unrecoverable — the worker should stop and not retry.
    Fatal,
    /// Temporary failure — retry with exponential back-off.
    Transient,
    /// The circuit breaker is open — wait for it to close before retrying.
    CircuitProtected,
}

#[derive(Error, Debug)]
pub enum ProjectionError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),

    #[error("SurrealDB error: {0}")]
    Surreal(#[from] surrealdb::Error),

    #[error("Invalid event data: {0}")]
    InvalidEventData(String),

    #[error("Missing field in event_data: {0}")]
    MissingField(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("Configuration error: {0}")]
    Config(String),

    #[error("Sink error: {0}")]
    Sink(String),

    /// A SurrealDB UNIQUE index rejected the write because an existing record
    /// already owns the same indexed fields (e.g. `idx_triple_spo`).  This is
    /// classified as **Fatal** because retrying will never succeed — the
    /// conflicting record must be reconciled first.
    #[error("Unique constraint violation: {0}")]
    UniqueConstraintViolation(String),

    /// The circuit breaker is open; the downstream database is being protected
    /// from further calls until the probe interval elapses.
    #[error("Circuit breaker open: {0}")]
    CircuitOpen(String),
}

impl ProjectionError {
    /// Classify this error for retry and supervision decisions.
    ///
    /// The match is exhaustive — adding a new variant to `ProjectionError`
    /// will cause a compile error here, forcing the author to assign a class
    /// to the new variant rather than silently falling through.
    pub fn classify(&self) -> ErrorClass {
        match self {
            ProjectionError::Database(_) => ErrorClass::Transient,
            ProjectionError::Surreal(_) => ErrorClass::Transient,
            ProjectionError::Sink(_) => ErrorClass::Transient,
            ProjectionError::CircuitOpen(_) => ErrorClass::CircuitProtected,
            ProjectionError::InvalidEventData(_) => ErrorClass::Fatal,
            ProjectionError::MissingField(_) => ErrorClass::Fatal,
            ProjectionError::Serialization(_) => ErrorClass::Fatal,
            ProjectionError::Config(_) => ErrorClass::Fatal,
            ProjectionError::UniqueConstraintViolation(_) => ErrorClass::Fatal,
        }
    }
}

pub type Result<T> = std::result::Result<T, ProjectionError>;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_transient_variants() {
        assert_eq!(
            ProjectionError::Database(sqlx::Error::PoolClosed).classify(),
            ErrorClass::Transient
        );
        assert_eq!(
            ProjectionError::Surreal(surrealdb::Error::thrown("test".into())).classify(),
            ErrorClass::Transient
        );
        assert_eq!(
            ProjectionError::Sink("timeout".into()).classify(),
            ErrorClass::Transient
        );
    }

    #[test]
    fn classify_fatal_variants() {
        assert_eq!(
            ProjectionError::InvalidEventData("bad".into()).classify(),
            ErrorClass::Fatal
        );
        assert_eq!(
            ProjectionError::MissingField("sender".into()).classify(),
            ErrorClass::Fatal
        );
        assert_eq!(
            ProjectionError::Config("missing".into()).classify(),
            ErrorClass::Fatal
        );
        let serde_err =
            serde_json::from_str::<serde_json::Value>("{{bad}}").expect_err("should fail");
        assert_eq!(
            ProjectionError::Serialization(serde_err).classify(),
            ErrorClass::Fatal
        );
        assert_eq!(
            ProjectionError::UniqueConstraintViolation("idx_triple_spo already contains".into())
                .classify(),
            ErrorClass::Fatal
        );
    }

    #[test]
    fn classify_circuit_protected() {
        assert_eq!(
            ProjectionError::CircuitOpen("tripped".into()).classify(),
            ErrorClass::CircuitProtected
        );
    }

    /// Meta-test: pin the expected [`ErrorClass`] for every
    /// [`ProjectionError`] variant.  Combined with the `_exhaustive_check`
    /// inner function, this guarantees:
    ///
    /// 1. Adding a new variant forces a compile error in `_exhaustive_check`,
    ///    making the author extend the `cases` table below.
    /// 2. Changing an existing variant's classification (e.g. accidentally
    ///    flipping `Database` from `Transient` to `Fatal`) breaks the
    ///    assertion instead of silently passing — the weaker "one of three
    ///    classes" check would not catch this regression.
    #[test]
    fn every_variant_has_a_classification() {
        let serde_err =
            serde_json::from_str::<serde_json::Value>("{{bad}}").expect_err("malformed json");

        // Pin the expected class per variant.  Every variant listed in
        // `_exhaustive_check` below must appear here.
        let cases: Vec<(ProjectionError, ErrorClass)> = vec![
            (
                ProjectionError::Database(sqlx::Error::PoolClosed),
                ErrorClass::Transient,
            ),
            (
                ProjectionError::Surreal(surrealdb::Error::thrown("x".into())),
                ErrorClass::Transient,
            ),
            (ProjectionError::Sink("x".into()), ErrorClass::Transient),
            (
                ProjectionError::CircuitOpen("x".into()),
                ErrorClass::CircuitProtected,
            ),
            (
                ProjectionError::InvalidEventData("x".into()),
                ErrorClass::Fatal,
            ),
            (ProjectionError::MissingField("x".into()), ErrorClass::Fatal),
            (ProjectionError::Serialization(serde_err), ErrorClass::Fatal),
            (ProjectionError::Config("x".into()), ErrorClass::Fatal),
            (
                ProjectionError::UniqueConstraintViolation("x".into()),
                ErrorClass::Fatal,
            ),
        ];

        for (err, expected) in &cases {
            assert_eq!(
                err.classify(),
                *expected,
                "misclassified variant {err:?} — expected {expected:?}"
            );
        }

        // Compile-time exhaustiveness guard: if a new ProjectionError variant
        // is introduced, this match will fail to compile and force the author
        // to extend the `cases` vec above.
        fn _exhaustive_check(e: &ProjectionError) {
            match e {
                ProjectionError::Database(_)
                | ProjectionError::Surreal(_)
                | ProjectionError::InvalidEventData(_)
                | ProjectionError::MissingField(_)
                | ProjectionError::Serialization(_)
                | ProjectionError::Config(_)
                | ProjectionError::Sink(_)
                | ProjectionError::UniqueConstraintViolation(_)
                | ProjectionError::CircuitOpen(_) => {}
            }
        }
    }
}
