//! Shared utility functions for projection workers.

use std::sync::atomic::{AtomicU64, Ordering};

/// Cheap pseudo-random u64 for jitter — no external crate needed.
///
/// Combines a monotonic counter with nanosecond timestamps and applies
/// a xorshift-style mixing function. Not cryptographically secure, but
/// sufficient for backoff jitter.
pub fn rand_u64() -> u64 {
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let tick = COUNTER.fetch_add(1, Ordering::Relaxed);
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let mut x = tick.wrapping_mul(6364136223846793005).wrapping_add(nanos);
    x ^= x >> 30;
    x = x.wrapping_mul(0xbf58476d1ce4e5b9);
    x ^= x >> 27;
    x
}
