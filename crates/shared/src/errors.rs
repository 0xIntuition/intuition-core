use thiserror::Error;

/// Classification of an [`IndexerError`] for retry and supervision decisions.
///
/// Exhaustive match — adding a new variant to `IndexerError` without updating
/// `classify()` will cause a compiler error.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
#[must_use = "error classification should be matched exhaustively"]
pub enum IndexerErrorClass {
    /// Unrecoverable — the indexer should stop and not retry.
    Fatal,
    /// Temporary failure — retry with exponential back-off.
    Retriable,
}

#[derive(Error, Debug)]
pub enum IndexerError {
    #[error("Database error: {0}")]
    Database(#[from] sqlx::Error),
    #[error("Redis error: {0}")]
    Redis(#[from] redis::RedisError),
    #[error("RPC error: {0}")]
    Rpc(String),
    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),
    #[error("Configuration error: {0}")]
    Config(String),
    #[error("Dependency missing: {0}")]
    DependencyMissing(String),
    #[error("Reorg detected at block {0}")]
    ReorgDetected(i64),
    #[error("Leader election error: {0}")]
    LeaderElection(String),
    #[error("Projection error: {0}")]
    Projection(String),
    #[error("Invalid event data: {0}")]
    InvalidEventData(String),
    #[error("Event decoding error: {0}")]
    EventDecoding(String),
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("Metrics error: {0}")]
    Metrics(String),
    #[error("Connection pool exhausted: {0}")]
    ConnectionPool(String),
    #[error("Other error: {0}")]
    Other(#[from] anyhow::Error),
}

impl IndexerError {
    /// Classify this error for retry decisions (exhaustive match).
    pub fn classify(&self) -> IndexerErrorClass {
        match self {
            IndexerError::Database(_) => IndexerErrorClass::Retriable,
            IndexerError::Redis(_) => IndexerErrorClass::Retriable,
            IndexerError::Rpc(_) => IndexerErrorClass::Retriable,
            IndexerError::DependencyMissing(_) => IndexerErrorClass::Retriable,
            IndexerError::ConnectionPool(_) => IndexerErrorClass::Retriable,
            IndexerError::Io(_) => IndexerErrorClass::Retriable,
            IndexerError::Serialization(_) => IndexerErrorClass::Fatal,
            IndexerError::Config(_) => IndexerErrorClass::Fatal,
            IndexerError::ReorgDetected(_) => IndexerErrorClass::Fatal,
            IndexerError::LeaderElection(_) => IndexerErrorClass::Fatal,
            IndexerError::Projection(_) => IndexerErrorClass::Fatal,
            IndexerError::InvalidEventData(_) => IndexerErrorClass::Fatal,
            IndexerError::EventDecoding(_) => IndexerErrorClass::Fatal,
            IndexerError::Metrics(_) => IndexerErrorClass::Fatal,
            IndexerError::Other(_) => IndexerErrorClass::Fatal,
        }
    }

    pub fn is_dependency_error(&self) -> bool {
        matches!(self, IndexerError::DependencyMissing(_))
    }

    #[deprecated(note = "Use classify() for exhaustive error classification")]
    pub fn is_retriable(&self) -> bool {
        matches!(self.classify(), IndexerErrorClass::Retriable)
    }

    pub fn is_deadlock(&self) -> bool {
        if let IndexerError::Database(db_err) = self {
            let msg = db_err.to_string().to_lowercase();
            msg.contains("deadlock") || msg.contains("lock_not_available")
        } else {
            false
        }
    }
}

pub type Result<T> = std::result::Result<T, IndexerError>;

#[deprecated(note = "Use IndexerError::is_dependency_error() instead")]
pub fn is_dependency_error(err: &IndexerError) -> bool {
    err.is_dependency_error()
}

#[deprecated(note = "Use IndexerError::is_retriable() instead")]
pub fn is_retriable_error(err: &IndexerError) -> bool {
    #[allow(deprecated)]
    err.is_retriable()
}

#[deprecated(note = "Use IndexerError::is_deadlock() instead")]
pub fn is_deadlock_error(err: &IndexerError) -> bool {
    err.is_deadlock()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_retriable_variants() {
        assert_eq!(
            IndexerError::Database(sqlx::Error::PoolClosed).classify(),
            IndexerErrorClass::Retriable
        );
        assert_eq!(
            IndexerError::Rpc("timeout".into()).classify(),
            IndexerErrorClass::Retriable
        );
        assert_eq!(
            IndexerError::DependencyMissing("redis".into()).classify(),
            IndexerErrorClass::Retriable
        );
        assert_eq!(
            IndexerError::ConnectionPool("exhausted".into()).classify(),
            IndexerErrorClass::Retriable
        );
    }

    #[test]
    fn classify_fatal_variants() {
        assert_eq!(
            IndexerError::Config("bad".into()).classify(),
            IndexerErrorClass::Fatal
        );
        assert_eq!(
            IndexerError::InvalidEventData("corrupt".into()).classify(),
            IndexerErrorClass::Fatal
        );
        assert_eq!(
            IndexerError::EventDecoding("bad hex".into()).classify(),
            IndexerErrorClass::Fatal
        );
        assert_eq!(
            IndexerError::ReorgDetected(100).classify(),
            IndexerErrorClass::Fatal
        );
        assert_eq!(
            IndexerError::Projection("failed".into()).classify(),
            IndexerErrorClass::Fatal
        );
    }

    #[test]
    #[allow(deprecated)]
    fn is_retriable_delegates_to_classify() {
        assert!(IndexerError::Database(sqlx::Error::PoolClosed).is_retriable());
        assert!(!IndexerError::Config("bad".into()).is_retriable());
    }

    #[test]
    fn is_dependency_error_only_matches_dependency_missing() {
        assert!(IndexerError::DependencyMissing("svc".into()).is_dependency_error());
        assert!(!IndexerError::Database(sqlx::Error::PoolClosed).is_dependency_error());
    }
}
