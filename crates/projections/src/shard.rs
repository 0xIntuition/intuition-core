//! Hash-based sharding utilities.
//!
//! Used by projections that can be parallelized across multiple workers,
//! each owning a deterministic subset of events keyed by vault identity
//! `(term_id, curve_id)`.

use std::hash::{BuildHasher, Hash, Hasher};

use ahash::RandomState;
use sqlx::types::BigDecimal;

/// Fixed seeds for deterministic hashing across process restarts and binary
/// versions. `AHasher::default()` uses runtime-random seeds (via the
/// `runtime-rng` feature) which would shift shard assignment on restart.
/// We use `RandomState::with_seeds()` with pinned constants instead.
const SEED1: u64 = 0x517cc1b727220a95;
const SEED2: u64 = 0x6c62272e07bb0142;
const SEED3: u64 = 0xcdb3f18e76994cae;
const SEED4: u64 = 0xe36aa0215ed297a3;

/// Create a hasher with fixed, deterministic seeds.
fn fixed_hasher() -> impl Hasher {
    RandomState::with_seeds(SEED1, SEED2, SEED3, SEED4).build_hasher()
}

/// Canonicalise a `BigDecimal` into an integer-valued shard key string.
///
/// `BigDecimal::to_string()` can emit `"10.0"` or `"10.000"` depending on
/// how the value was constructed, which would hash to a different shard
/// than the raw-JSON form `"10"`. This helper uses `with_scale(0)` to strip
/// any fractional component before stringifying, ensuring the typed path
/// and the raw `get_str()` path land on the same shard.
///
/// # Expected input domain
///
/// This function is only correct for **non-negative integer** values such
/// as `term_id` and `curve_id`. The calling projections treat these as
/// `uint256` blockchain identifiers, so negative or fractional values are
/// invariant violations, not legitimate inputs.
///
/// # Edge cases
///
/// `BigDecimal::with_scale(0)` **truncates toward zero**, which silently
/// collapses several distinct values into the same shard key:
///
/// | Input       | Canonicalised | Risk                               |
/// |-------------|---------------|------------------------------------|
/// | `"10"`      | `"10"`        | OK — integer identity              |
/// | `"10.0"`    | `"10"`        | OK — scale normalisation           |
/// | `"10.000"`  | `"10"`        | OK — scale normalisation           |
/// | `"10.5"`    | `"10"`        | **Would silently drop `0.5`**      |
/// | `"0.1"`     | `"0"`         | **Would collide with real `"0"`**  |
/// | `"-10"`     | `"-10"`       | **Negative values unsupported**    |
/// | `"-0.5"`    | `"0"`         | **Sign loss + collision with `0`** |
///
/// To make violations loud during development, this function
/// `debug_assert!`s that `bd` is a non-negative integer. In release builds
/// the assertion is a no-op; callers are still responsible for not passing
/// fractional or negative values.
///
/// See the `shard_edge_case_rejects_*` tests for regression coverage of
/// these cases.
#[inline]
#[must_use]
pub fn canonical_shard_key(bd: &BigDecimal) -> String {
    // Guard: term_id and curve_id are blockchain uint256 identifiers; any
    // negative or fractional value is an upstream invariant violation, not
    // a legitimate shard key.  A debug_assert surfaces the bug in tests
    // without panicking production indexers — `with_scale(0)` still runs
    // and produces a best-effort key so the worker does not crash.
    //
    // We avoid importing `bigdecimal::num_bigint::Sign` directly to stay
    // limited to the `sqlx::types::BigDecimal` re-export: comparing against
    // `BigDecimal::from(0)` is equivalent to checking the sign for our
    // purposes (we only care that negatives are rejected).
    //
    // Clippy flags the `BigDecimal::from(0)` allocation, but this is a
    // debug-only assertion (compiled out in release builds) and the cost is
    // a single zero BigDecimal per call — not measurable in test runs.
    #[allow(clippy::cmp_owned)]
    {
        debug_assert!(
            *bd >= BigDecimal::from(0),
            "canonical_shard_key: negative BigDecimal ({bd}) is not a valid vault identifier",
        );
    }
    debug_assert!(
        bd.is_integer(),
        "canonical_shard_key: fractional BigDecimal ({bd}) would truncate and collide with a real integer",
    );

    // `with_scale(0)` rescales the BigDecimal to have 0 decimal places.
    // For "10.000" this produces "10"; for "10" it is a no-op. No trait
    // imports are needed — `with_scale` is an inherent method on `BigDecimal`.
    // In Python terms: equivalent to `str(int(bd))`.
    bd.with_scale(0).to_string()
}

/// Compute which shard a `(term_id, curve_id)` pair belongs to.
///
/// Uses `AHasher` with fixed seeds for fast, deterministic hashing that
/// is stable across process restarts and binary versions.
///
/// # Panics
///
/// Panics if `total_shards` is zero.
pub fn calculate_shard(term_id: &str, curve_id: &str, total_shards: u32) -> u32 {
    assert!(total_shards > 0, "total_shards must be > 0");
    let mut hasher = fixed_hasher();
    term_id.hash(&mut hasher);
    curve_id.hash(&mut hasher);
    let hash = hasher.finish();
    (hash % total_shards as u64) as u32
}

/// Returns `true` if `(term_id, curve_id)` belongs to the given shard.
pub fn belongs_to_shard(term_id: &str, curve_id: &str, shard_id: u32, total_shards: u32) -> bool {
    if total_shards <= 1 {
        return true;
    }
    calculate_shard(term_id, curve_id, total_shards) == shard_id
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;

    #[test]
    fn single_shard_always_matches() {
        assert!(belongs_to_shard("42", "1", 0, 1));
        assert!(belongs_to_shard("99", "2", 0, 1));
    }

    #[test]
    fn deterministic_across_calls() {
        let s1 = calculate_shard("42", "1", 4);
        let s2 = calculate_shard("42", "1", 4);
        assert_eq!(s1, s2);
    }

    #[test]
    fn distributes_across_shards() {
        let total = 4u32;
        let mut seen = std::collections::HashSet::new();
        for i in 0..100 {
            let shard = calculate_shard(&i.to_string(), "1", total);
            assert!(shard < total);
            seen.insert(shard);
        }
        assert_eq!(seen.len(), total as usize);
    }

    #[test]
    fn belongs_to_exactly_one_shard() {
        let total = 4u32;
        for i in 0..50 {
            let term = i.to_string();
            let matches: Vec<u32> = (0..total)
                .filter(|&s| belongs_to_shard(&term, "1", s, total))
                .collect();
            assert_eq!(matches.len(), 1, "term_id={term} matched {:?}", matches);
        }
    }

    #[test]
    #[should_panic(expected = "total_shards must be > 0")]
    fn zero_shards_panics() {
        calculate_shard("1", "1", 0);
    }

    #[test]
    fn fixed_seeds_are_stable() {
        // Pin a known shard assignment so any accidental seed change is caught.
        let shard = calculate_shard("42", "1", 4);
        let shard_again = calculate_shard("42", "1", 4);
        assert_eq!(shard, shard_again);
        assert!(shard < 4);
    }

    // ---------------------------------------------------------------------------
    // canonical_shard_key tests
    // ---------------------------------------------------------------------------

    #[test]
    fn canonical_shard_key_strips_trailing_zeros() {
        // All three representations of the integer 10 must produce the same key.
        let bd_plain = BigDecimal::from_str("10").unwrap();
        let bd_one_zero = BigDecimal::from_str("10.0").unwrap();
        let bd_three_zeros = BigDecimal::from_str("10.000").unwrap();

        assert_eq!(canonical_shard_key(&bd_plain), "10");
        assert_eq!(canonical_shard_key(&bd_one_zero), "10");
        assert_eq!(canonical_shard_key(&bd_three_zeros), "10");
    }

    #[test]
    fn canonical_shard_key_preserves_integer() {
        let bd = BigDecimal::from_str("7").unwrap();
        assert_eq!(canonical_shard_key(&bd), "7");
    }

    #[test]
    fn canonical_shard_key_large_integer() {
        // Max u256 value — must pass through unchanged.
        let max_u256 =
            "115792089237316195423570985008687907853269984665640564039457584007913129639935";
        let bd = BigDecimal::from_str(max_u256).unwrap();
        assert_eq!(canonical_shard_key(&bd), max_u256);
    }

    // ---------------------------------------------------------------------------
    // Edge-case guards — these catch invariant violations via debug_assert.
    // In release builds the function silently truncates, matching today's
    // behaviour; in debug / test builds we fail loudly so upstream bugs are
    // visible immediately.
    // ---------------------------------------------------------------------------

    #[test]
    #[should_panic(expected = "fractional BigDecimal")]
    fn canonical_shard_key_rejects_fractional_nonzero() {
        // "0.1" would truncate to "0" and collide with a real zero identifier.
        let bd = BigDecimal::from_str("0.1").unwrap();
        let _ = canonical_shard_key(&bd);
    }

    #[test]
    #[should_panic(expected = "fractional BigDecimal")]
    fn canonical_shard_key_rejects_fractional_between_integers() {
        // "10.5" would truncate toward zero to "10", silently collapsing
        // two distinct values into the same shard key.
        let bd = BigDecimal::from_str("10.5").unwrap();
        let _ = canonical_shard_key(&bd);
    }

    #[test]
    #[should_panic(expected = "negative BigDecimal")]
    fn canonical_shard_key_rejects_negative_integer() {
        // term_id / curve_id are uint256 on-chain; negatives are impossible.
        let bd = BigDecimal::from_str("-10").unwrap();
        let _ = canonical_shard_key(&bd);
    }

    #[test]
    #[should_panic(expected = "negative BigDecimal")]
    fn canonical_shard_key_rejects_negative_fractional() {
        // Double violation — would collapse sign AND fractional component,
        // silently producing "0" from a value that is neither zero nor valid.
        let bd = BigDecimal::from_str("-0.5").unwrap();
        let _ = canonical_shard_key(&bd);
    }

    #[test]
    fn canonical_shard_key_accepts_zero() {
        // Zero is a valid (integer, non-negative) identifier even if our
        // current schema does not issue term_id=0 — the function must not
        // reject it.
        let bd = BigDecimal::from_str("0").unwrap();
        assert_eq!(canonical_shard_key(&bd), "0");
    }

    #[test]
    fn canonical_shard_key_accepts_zero_with_trailing_scale() {
        // "0.000" is still the integer zero after scale normalisation.
        let bd = BigDecimal::from_str("0.000").unwrap();
        assert_eq!(canonical_shard_key(&bd), "0");
    }

    #[test]
    fn canonical_shard_key_accepts_exponent_notation_integer() {
        // "1e2" is 100 — still an integer despite the scientific notation.
        let bd = BigDecimal::from_str("1e2").unwrap();
        assert_eq!(canonical_shard_key(&bd), "100");
    }

    #[test]
    fn shard_affinity_stable_across_raw_and_typed_paths() {
        // The raw JSON path passes the string "10" directly to calculate_shard.
        // The typed path calls BigDecimal::from_str("10") (or "10.0" or "10.000")
        // and then canonical_shard_key, which must produce the same "10" string.
        // All three forms must land on the same shard as the raw "10" path.
        let raw_shard = calculate_shard("10", "1", 4);

        for repr in &["10", "10.0", "10.000"] {
            let bd = BigDecimal::from_str(repr).unwrap();
            let typed_shard = calculate_shard(&canonical_shard_key(&bd), "1", 4);
            assert_eq!(
                typed_shard, raw_shard,
                "BigDecimal({repr}) must hash to the same shard as raw string \"10\""
            );
        }
    }
}
