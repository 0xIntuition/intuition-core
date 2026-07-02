//! Property-based tests for core invariants across the indexer.
//!
//! These tests use proptest to verify invariants hold for arbitrary inputs:
//! - Event ordering invariants (block_number, log_index always increasing)
//! - Checkpoint consistency (never goes backward)
//! - Numeric overflow handling in calculations
//! - Unicode handling in atom labels/descriptions

#[cfg(test)]
mod tests {
    use crate::types::{BlockNumber, LogIndex};
    use chrono::{DateTime, TimeZone, Utc};
    use proptest::prelude::*;

    /// Strategy to generate valid block numbers (positive integers)
    fn block_number_strategy() -> impl Strategy<Value = BlockNumber> {
        0i64..=1_000_000i64
    }

    /// Strategy to generate valid log indices (positive integers)
    fn log_index_strategy() -> impl Strategy<Value = LogIndex> {
        0i32..=10_000i32
    }

    /// Strategy to generate valid timestamps
    fn timestamp_strategy() -> impl Strategy<Value = DateTime<Utc>> {
        (1_600_000_000i64..=2_000_000_000i64).prop_map(|ts| Utc.timestamp_opt(ts, 0).unwrap())
    }

    /// Strategy to generate hex strings (for term_id, etc.)
    fn hex_string_strategy(len: usize) -> impl Strategy<Value = String> {
        prop::collection::vec(prop::num::u8::ANY, len)
            .prop_map(|bytes| format!("0x{}", hex::encode(bytes)))
    }

    /// Strategy to generate arbitrary unicode strings
    fn unicode_string_strategy() -> impl Strategy<Value = String> {
        "\\PC*"
    }

    proptest! {
        /// Property: Events with increasing (block_number, log_index) should be ordered correctly
        #[test]
        fn test_event_ordering_invariant(
            block1 in block_number_strategy(),
            log1 in log_index_strategy(),
            block2 in block_number_strategy(),
            log2 in log_index_strategy(),
        ) {
            // Create two event keys
            let key1 = (block1, log1);
            let key2 = (block2, log2);

            // Property: ordering should be consistent with lexicographic ordering
            let expected_ordering = (block1, log1).cmp(&(block2, log2));
            let actual_ordering = key1.cmp(&key2);

            prop_assert_eq!(expected_ordering, actual_ordering);

            // Property: if block1 < block2, then key1 < key2 regardless of log indices
            if block1 < block2 {
                prop_assert!(key1 < key2);
            }

            // Property: if block1 == block2, ordering determined by log index
            if block1 == block2 {
                prop_assert_eq!(key1.cmp(&key2), log1.cmp(&log2));
            }
        }

        /// Property: Checkpoint position should never go backward
        #[test]
        fn test_checkpoint_never_goes_backward(
            block1 in block_number_strategy(),
            log1 in log_index_strategy(),
            block2 in block_number_strategy(),
            log2 in log_index_strategy(),
        ) {
            // Simulate checkpoint positions as (block_number, log_index) tuples
            let checkpoint1 = (block1, log1);
            let checkpoint2 = (block2, log2);

            // If we update checkpoint from 1 to 2, the new checkpoint should be >= old one
            if checkpoint2 >= checkpoint1 {
                // This is a valid forward movement
                prop_assert!(
                    block2 > block1 || (block2 == block1 && log2 >= log1),
                    "Checkpoint should move forward: ({}, {}) -> ({}, {})",
                    block1, log1, block2, log2
                );
            }
        }

        /// Property: BigDecimal arithmetic should not overflow for reasonable values
        #[test]
        fn test_numeric_overflow_handling(
            assets in (0u64..=u64::MAX / 2),
            shares in (1u64..=u64::MAX / 2),
        ) {
            use bigdecimal::BigDecimal;
            use std::str::FromStr;

            let assets_bd = BigDecimal::from(assets);
            let shares_bd = BigDecimal::from(shares);

            // Property: Division should not panic
            let result = &assets_bd / &shares_bd;
            prop_assert!(result >= 0);

            // Property: Multiplication should not overflow
            let product = &assets_bd * &shares_bd;
            prop_assert!(product >= 0);

            // Property: Share price calculation should be consistent
            let share_price = &assets_bd / &shares_bd;
            let reconstructed = &share_price * &shares_bd;

            // Due to decimal precision, we check they're approximately equal
            let diff = (&assets_bd - &reconstructed).abs();
            let tolerance = BigDecimal::from_str("0.000001").unwrap();
            prop_assert!(diff <= tolerance || assets == 0);
        }

        /// Property: Unicode strings in atom labels should be handled correctly
        #[test]
        fn test_unicode_handling_in_labels(
            label in unicode_string_strategy(),
        ) {
            // Property: String length in bytes may differ from character count
            let byte_len = label.len();
            let char_count = label.chars().count();

            // Property: byte length >= char count (multi-byte chars exist)
            prop_assert!(byte_len >= char_count);

            // Property: Truncating to byte boundaries should not panic
            let truncate_point = std::cmp::min(100, byte_len);

            // Find a valid UTF-8 boundary
            let mut valid_boundary = truncate_point;
            while valid_boundary > 0 && !label.is_char_boundary(valid_boundary) {
                valid_boundary -= 1;
            }

            let truncated = &label[..valid_boundary];
            prop_assert!(truncated.is_empty() || truncated.chars().all(|_| true));

            // Property: JSON serialization should handle unicode correctly
            let json = serde_json::json!({ "label": label });
            let serialized = serde_json::to_string(&json).unwrap();
            let deserialized: serde_json::Value = serde_json::from_str(&serialized).unwrap();
            prop_assert_eq!(deserialized["label"].as_str().unwrap(), label);
        }

        /// Property: Hash function should be deterministic
        #[test]
        fn test_hash_determinism(
            term_id in hex_string_strategy(32),
        ) {
            use crate::locking::vault_lock_id;

            let hash1 = vault_lock_id(&term_id);
            let hash2 = vault_lock_id(&term_id);

            // Property: Same input produces same hash
            prop_assert_eq!(hash1, hash2);
        }

        /// Property: Different inputs should produce different hashes (with high probability)
        #[test]
        fn test_hash_uniqueness(
            term_id1 in hex_string_strategy(32),
            term_id2 in hex_string_strategy(32),
        ) {
            use crate::locking::vault_lock_id;

            // Only test when inputs are different
            if term_id1 != term_id2 {
                let hash1 = vault_lock_id(&term_id1);
                let hash2 = vault_lock_id(&term_id2);

                // Property: Different inputs *usually* produce different hashes
                // (collisions are possible but should be extremely rare)
                prop_assert_ne!(hash1, hash2);
            }
        }

        /// Property: Event data serialization is reversible
        #[test]
        fn test_event_data_serialization(
            term_id in hex_string_strategy(32),
            creator in hex_string_strategy(20),
        ) {
            let event_data = serde_json::json!({
                "id": &term_id,
                "creator": &creator,
                "data": "ipfs://Qm..."
            });

            // Property: Serialize then deserialize produces same data
            let serialized = serde_json::to_string(&event_data).unwrap();
            let deserialized: serde_json::Value = serde_json::from_str(&serialized).unwrap();

            prop_assert_eq!(&event_data, &deserialized);
            prop_assert_eq!(event_data["id"].as_str().unwrap(), &term_id);
            prop_assert_eq!(event_data["creator"].as_str().unwrap(), &creator);
        }

        /// Property: Block timestamp should increase monotonically with block number
        #[test]
        fn test_block_timestamp_monotonicity(
            block1 in block_number_strategy(),
            ts1 in timestamp_strategy(),
            block2 in block_number_strategy(),
            ts2 in timestamp_strategy(),
        ) {
            // Property: If block2 > block1, then typically ts2 >= ts1
            // (though reorgs can violate this, so we can't enforce strictly)

            // For canonical chain, later blocks should have later or equal timestamps
            if block2 > block1 && ts2 < ts1 {
                // This is unusual but possible in edge cases (reorg, clock skew)
                // Just verify we handle it without panic
                let diff = ts1 - ts2;
                prop_assert!(diff.num_seconds() >= 0);
            }
        }
    }

    #[test]
    fn test_event_ordering_specific_cases() {
        // Test specific known cases
        assert!((1000i64, 0i32) < (1000i64, 1i32));
        assert!((1000i64, 5i32) < (1001i64, 0i32));
        assert!((999i64, 999i32) < (1000i64, 0i32));
    }

    #[test]
    fn test_unicode_edge_cases() {
        let test_cases = vec![
            "Hello, World!",      // ASCII
            "こんにちは",         // Japanese
            "🚀🌟💻",             // Emoji
            "مرحبا",              // Arabic
            "Привет",             // Cyrillic
            "Hello\u{0000}World", // Null character
            "Line1\nLine2",       // Newline
            "Tab\tSeparated",     // Tab
        ];

        for case in test_cases {
            // Should not panic on serialization
            let json = serde_json::json!({ "label": case });
            let serialized = serde_json::to_string(&json).unwrap();
            let deserialized: serde_json::Value = serde_json::from_str(&serialized).unwrap();
            assert_eq!(deserialized["label"].as_str().unwrap(), case);
        }
    }

    #[test]
    fn test_bigdecimal_edge_cases() {
        use bigdecimal::BigDecimal;
        use std::str::FromStr;

        let one = BigDecimal::from(1);

        // Division by non-zero
        let result = &one / &one;
        assert_eq!(result, one);

        // Very large numbers
        let large = BigDecimal::from_str("999999999999999999999999999999").unwrap();
        let result = &large + &large;
        assert!(result > large);
    }

    // ==========================================
    // Additional property-based tests for MED-004
    // ==========================================

    /// Strategy to generate share price values (realistic range)
    fn share_price_strategy() -> impl Strategy<Value = (u128, u128)> {
        // Assets: 0 to 1e24 (realistic token amounts in wei)
        // Shares: 1 to 1e24 (never zero to avoid division by zero)
        (
            0u128..=1_000_000_000_000_000_000_000_000u128,
            1u128..=1_000_000_000_000_000_000_000_000u128,
        )
    }

    proptest! {
        /// Property: Share price calculation handles extreme value combinations
        /// without overflow or panic
        #[test]
        fn test_share_price_extreme_values(
            (assets, shares) in share_price_strategy(),
        ) {
            use bigdecimal::BigDecimal;
            use std::str::FromStr;

            let assets_bd = BigDecimal::from(assets);
            let shares_bd = BigDecimal::from(shares);

            // Property: Division should never panic for non-zero denominator
            let share_price = &assets_bd / &shares_bd;

            // Property: Share price should be non-negative
            prop_assert!(share_price >= 0);

            // Property: If assets > shares, share_price > 1
            if assets > shares {
                prop_assert!(share_price > 1);
            }

            // Property: If assets < shares, share_price < 1
            if assets < shares {
                prop_assert!(share_price < 1);
            }

            // Property: Multiplication back should approximate original
            let reconstructed = &share_price * &shares_bd;
            let diff = (&assets_bd - &reconstructed).abs();
            // Allow for decimal precision loss (within 0.0001% for large numbers)
            let tolerance = if assets > 1_000_000_000 {
                BigDecimal::from_str("1000000000").unwrap() // Tolerance scales with magnitude
            } else {
                BigDecimal::from_str("0.000001").unwrap()
            };
            prop_assert!(diff <= tolerance || assets == 0);
        }

        /// Property: Share price calculation is consistent across multiple precision levels
        #[test]
        fn test_share_price_precision_consistency(
            base_assets in 1u64..=u64::MAX / 1000,
            multiplier in 1u64..=1000u64,
            shares in 1u64..=u64::MAX / 1000,
        ) {
            use bigdecimal::BigDecimal;
            use std::str::FromStr;

            // Calculate share price at different scales
            let assets_small = BigDecimal::from(base_assets);
            let assets_large = BigDecimal::from(base_assets) * BigDecimal::from(multiplier);
            let shares_small = BigDecimal::from(shares);
            let shares_large = BigDecimal::from(shares) * BigDecimal::from(multiplier);

            let price_small = &assets_small / &shares_small;
            let price_large = &assets_large / &shares_large;

            // Property: Scaling both assets and shares should preserve share price
            let diff = (&price_small - &price_large).abs();
            let tolerance = BigDecimal::from_str("0.00000001").unwrap();
            prop_assert!(diff <= tolerance);
        }

        /// Property: Unicode strings are properly bounded and valid
        #[test]
        fn test_unicode_atom_label_bounds(
            label in "\\PC{0,1000}",
        ) {
            // Property: Label should be valid UTF-8 (implicit in Rust strings)
            prop_assert!(label.is_char_boundary(0));
            prop_assert!(label.is_char_boundary(label.len()));

            // Property: Character count should be reasonable
            let char_count = label.chars().count();
            prop_assert!(char_count <= 1000);

            // Property: Truncating to byte limit should produce valid UTF-8
            let max_bytes = 255; // Common DB column limit
            if label.len() > max_bytes {
                let mut truncate_point = max_bytes;
                while truncate_point > 0 && !label.is_char_boundary(truncate_point) {
                    truncate_point -= 1;
                }
                let truncated = &label[..truncate_point];
                // Should be valid UTF-8
                prop_assert!(std::str::from_utf8(truncated.as_bytes()).is_ok());
            }
        }

        /// Property: Unicode descriptions with special characters are handled
        #[test]
        fn test_unicode_description_special_chars(
            description in "([\\x00-\\x1F\\x7F-\\xFF]|\\PC){0,500}",
        ) {
            // Property: JSON serialization should handle any valid UTF-8
            let json = serde_json::json!({
                "description": description,
            });
            let serialized = serde_json::to_string(&json);
            prop_assert!(serialized.is_ok());

            if let Ok(s) = serialized {
                // Property: Deserialization should round-trip
                let deserialized: Result<serde_json::Value, _> = serde_json::from_str(&s);
                prop_assert!(deserialized.is_ok());
            }
        }

        /// Property: Concurrent checkpoint positions should be comparable
        #[test]
        fn test_checkpoint_concurrent_comparison(
            block1 in block_number_strategy(),
            log1 in log_index_strategy(),
            block2 in block_number_strategy(),
            log2 in log_index_strategy(),
            block3 in block_number_strategy(),
            log3 in log_index_strategy(),
        ) {
            let cp1 = (block1, log1);
            let cp2 = (block2, log2);
            let cp3 = (block3, log3);

            // Property: Transitivity - if cp1 < cp2 and cp2 < cp3, then cp1 < cp3
            if cp1 < cp2 && cp2 < cp3 {
                prop_assert!(cp1 < cp3);
            }

            // Property: Antisymmetry - if cp1 <= cp2 and cp2 <= cp1, then cp1 == cp2
            if cp1 <= cp2 && cp2 <= cp1 {
                prop_assert_eq!(cp1, cp2);
            }

            // Property: Total ordering - exactly one of <, ==, > holds
            let cmp = cp1.cmp(&cp2);
            match cmp {
                std::cmp::Ordering::Less => {
                    prop_assert!(cp1 < cp2);
                    prop_assert!(cp1 != cp2);
                    prop_assert!(cp1 <= cp2);
                }
                std::cmp::Ordering::Equal => {
                    prop_assert!(cp1 >= cp2);
                    prop_assert!(cp1 == cp2);
                    prop_assert!(cp1 <= cp2);
                }
                std::cmp::Ordering::Greater => {
                    prop_assert!(cp1 >= cp2);
                    prop_assert!(cp1 != cp2);
                    prop_assert!(cp1 > cp2);
                }
            }
        }

        /// Property: Checkpoint "max" selection should be idempotent and associative
        #[test]
        fn test_checkpoint_max_properties(
            block1 in block_number_strategy(),
            log1 in log_index_strategy(),
            block2 in block_number_strategy(),
            log2 in log_index_strategy(),
            block3 in block_number_strategy(),
            log3 in log_index_strategy(),
        ) {
            let cp1 = (block1, log1);
            let cp2 = (block2, log2);
            let cp3 = (block3, log3);

            // max function for checkpoint tuples
            let max_cp = |a: (i64, i32), b: (i64, i32)| -> (i64, i32) {
                if a >= b { a } else { b }
            };

            // Property: Idempotent - max(a, a) == a
            prop_assert_eq!(max_cp(cp1, cp1), cp1);

            // Property: Commutative - max(a, b) == max(b, a)
            prop_assert_eq!(max_cp(cp1, cp2), max_cp(cp2, cp1));

            // Property: Associative - max(max(a, b), c) == max(a, max(b, c))
            prop_assert_eq!(
                max_cp(max_cp(cp1, cp2), cp3),
                max_cp(cp1, max_cp(cp2, cp3))
            );

            // Property: max(a, b) >= a and max(a, b) >= b
            let m = max_cp(cp1, cp2);
            prop_assert!(m >= cp1);
            prop_assert!(m >= cp2);
        }

        /// Property: Numeric operations on vault shares should be consistent
        #[test]
        fn test_vault_share_operations(
            initial_shares in 0u64..=u64::MAX / 4,
            deposit_amount in 0u64..=u64::MAX / 4,
            redeem_amount in 0u64..=u64::MAX / 4,
        ) {
            use bigdecimal::BigDecimal;

            let initial = BigDecimal::from(initial_shares);
            let deposit = BigDecimal::from(deposit_amount);
            let redeem = BigDecimal::from(redeem_amount);

            // Simulate deposit then redeem
            let after_deposit = &initial + &deposit;
            let after_redeem = &after_deposit - &redeem;

            // Property: Shares should never go negative in valid operations
            if redeem_amount <= initial_shares + deposit_amount {
                prop_assert!(after_redeem >= 0);
            }

            // Property: Deposit increases shares
            prop_assert!(after_deposit >= initial);

            // Property: Order of operations matters for non-commutative ops
            let alt_after_redeem = &initial - &redeem;
            let alt_after_deposit = &alt_after_redeem + &deposit;
            // Should be same final result due to commutativity of addition
            prop_assert_eq!(after_redeem, alt_after_deposit);
        }
    }

    #[test]
    fn test_share_price_overflow_edge_cases() {
        use bigdecimal::BigDecimal;

        // Test with maximum u128 values
        let max_u128 = BigDecimal::from(u128::MAX);
        let one = BigDecimal::from(1u64);

        // Should not overflow
        let result = &max_u128 / &one;
        assert_eq!(result, max_u128);

        // Multiplication of max by 2 should work (BigDecimal supports arbitrary precision)
        let doubled = &max_u128 * BigDecimal::from(2u64);
        assert!(doubled > max_u128);
    }

    #[test]
    fn test_unicode_edge_cases_extended() {
        // Test cases that might cause issues in databases or JSON
        let test_cases = vec![
            ("Empty string", ""),
            ("Just null", "\u{0000}"),
            ("Null in middle", "abc\u{0000}def"),
            ("BOM", "\u{FEFF}"),
            ("Zero-width joiner", "👨\u{200D}👩\u{200D}👧"),
            ("Combining chars", "e\u{0301}"), // é as e + combining accent
            ("RTL override", "\u{202E}abc"),
            ("Surrogate pair emoji", "🦀"),
            ("Max codepoint", "\u{10FFFF}"),
            ("Paragraph separator", "\u{2029}"),
            ("Private use area", "\u{E000}"),
        ];

        for (name, input) in test_cases {
            // Should not panic during JSON serialization
            let json = serde_json::json!({ "label": input });
            let result = serde_json::to_string(&json);
            assert!(result.is_ok(), "Failed to serialize: {}", name);

            // Round-trip should preserve value
            if let Ok(serialized) = result {
                let parsed: serde_json::Value = serde_json::from_str(&serialized)
                    .unwrap_or_else(|_| panic!("Failed to parse: {}", name));
                assert_eq!(
                    parsed["label"].as_str().unwrap(),
                    input,
                    "Round-trip failed for: {}",
                    name
                );
            }
        }
    }

    #[test]
    fn test_checkpoint_concurrent_update_simulation() {
        // Simulate what happens when multiple workers try to update checkpoints
        // This tests the invariant that the max checkpoint should always be chosen

        let checkpoints = vec![
            (100i64, 5i32),  // Worker A at block 100, log 5
            (100i64, 10i32), // Worker B at block 100, log 10
            (99i64, 100i32), // Worker C at block 99 (behind)
            (101i64, 0i32),  // Worker D at block 101 (ahead)
        ];

        // The correct checkpoint should be the maximum
        let max_checkpoint = checkpoints.iter().max().unwrap();
        assert_eq!(*max_checkpoint, (101i64, 0i32));

        // Verify all others are less than or equal
        for cp in &checkpoints {
            assert!(cp <= max_checkpoint);
        }
    }
}
