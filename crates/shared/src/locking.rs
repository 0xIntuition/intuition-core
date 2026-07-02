use ahash::AHasher;
use sqlx::{Postgres, Transaction};
use std::hash::{Hash, Hasher};

use crate::errors::Result;
use crate::models::StoredEvent;

/// Deterministically hashes a string term_id into a 64-bit integer
/// suitable for pg_advisory_xact_lock.
///
/// Uses AHash instead of SipHash for better performance while maintaining
/// deterministic output within a single process/binary.
pub fn vault_lock_id(term_id: &str) -> i64 {
    let mut hasher = AHasher::default();
    term_id.hash(&mut hasher);
    hasher.finish() as i64
}

/// Acquires a transaction-level advisory lock.
/// This lock automatically releases when the transaction commits or rolls back.
pub async fn acquire_vault_lock(tx: &mut Transaction<'_, Postgres>, term_id: &str) -> Result<()> {
    let lock_id = vault_lock_id(term_id);
    // Use a timeout to fail fast rather than hang indefinitely if something goes wrong
    sqlx::query("SET LOCAL lock_timeout = '5s'")
        .execute(&mut **tx)
        .await?;

    sqlx::query("SELECT pg_advisory_xact_lock($1)")
        .bind(lock_id)
        .execute(&mut **tx)
        .await?;
    Ok(())
}

/// Trait to extract lock keys from generic events without exposing domain logic.
/// Implementations should return all term_ids that the event affects.
pub trait LockableEvent {
    fn affected_resources(&self) -> Vec<String>;
}

impl LockableEvent for StoredEvent {
    fn affected_resources(&self) -> Vec<String> {
        // Return the term_id if present - this is the vault being affected
        match &self.term_id {
            Some(term_id) => vec![term_id.clone()],
            None => vec![],
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_vault_lock_id_consistency() {
        let term_id = "0x64adf3bd860af07a7e627b5cd5b57ca6210545f2a04f5f8b95bbc77c00ea99c5";
        let id1 = vault_lock_id(term_id);
        let id2 = vault_lock_id(term_id);
        assert_eq!(id1, id2, "Same term_id should produce same lock_id");
    }

    #[test]
    fn test_vault_lock_id_different_inputs() {
        let term_id1 = "0x64adf3bd860af07a7e627b5cd5b57ca6210545f2a04f5f8b95bbc77c00ea99c5";
        let term_id2 = "0x0001e21b0f7ab0d32b2363d661cd95b4fb2a05ee75d164fb46920148af54fe3b";
        let id1 = vault_lock_id(term_id1);
        let id2 = vault_lock_id(term_id2);
        assert_ne!(
            id1, id2,
            "Different term_ids should produce different lock_ids"
        );
    }
}
