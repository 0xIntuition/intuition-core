//! Graph feature flags for the SurrealDB -> Postgres migration.
//!
//! Mirrors the TypeScript helpers in `packages/graph-flags/src/graph-flags.ts`.
//! Reads the same environment variables and supports the same formats:
//! - CSV lists: `GRAPH_DB_WRITES_ENABLED=posts,follows`
//! - Wildcards: `GRAPH_DB_READS_ENABLED=*` or `=all`
//! - Booleans: `GRAPH_SEARCH_ENABLED=true`
//!
//! All flags default to `false`. Any parse error or missing env var falls back
//! to `false`.

use std::collections::HashSet;
use std::env;
use std::sync::{LazyLock, OnceLock};

// ---------------------------------------------------------------------------
// Valid value sets
// ---------------------------------------------------------------------------

static GRAPH_ENTITY_KINDS: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    HashSet::from([
        "posts",
        "follows",
        "artifacts",
        "enrichments",
        "social_events",
        "market_events",
    ])
});

static GRAPH_READ_SURFACES: LazyLock<HashSet<&'static str>> = LazyLock::new(|| {
    HashSet::from([
        "post_detail",
        "follow_list",
        "recommendations",
        "search",
        "neighborhood",
        "node_detail",
    ])
});

static EVENT_KINDS: LazyLock<HashSet<&'static str>> =
    LazyLock::new(|| HashSet::from(["social", "market"]));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/// Parse a comma-separated env var value into a set of validated, lowercased tokens.
/// Supports `*` / `all` wildcard to return every valid value.
fn parse_csv_set(raw: &str, valid: &HashSet<&'static str>) -> HashSet<String> {
    let trimmed = raw.trim().to_lowercase();
    if trimmed.is_empty() {
        return HashSet::new();
    }

    if trimmed == "*" || trimmed == "all" {
        return valid.iter().map(|s| (*s).to_string()).collect();
    }

    let mut result = HashSet::new();
    for token in raw.split(',') {
        let t = token.trim().to_lowercase();
        if t.is_empty() {
            continue;
        }
        if valid.contains(t.as_str()) {
            result.insert(t);
        } else {
            tracing::warn!(
                token = %t,
                valid = ?valid,
                "[graph-flags] Unknown token in env var"
            );
        }
    }
    result
}

/// Parse a boolean env var. Returns `false` for any non-truthy value.
fn parse_boolean_env(raw: &str) -> bool {
    matches!(
        raw.trim().to_lowercase().as_str(),
        "1" | "true" | "t" | "yes" | "y" | "on"
    )
}

/// Read an env var, returning an empty string if missing or on error.
fn read_env(key: &str) -> String {
    env::var(key).unwrap_or_default()
}

// ---------------------------------------------------------------------------
// Cached flag state — parsed once at first access, cached for process lifetime
// ---------------------------------------------------------------------------

static CACHED_WRITES: OnceLock<HashSet<String>> = OnceLock::new();
static CACHED_READS: OnceLock<HashSet<String>> = OnceLock::new();
static CACHED_EVENTS: OnceLock<HashSet<String>> = OnceLock::new();
static CACHED_SEARCH: OnceLock<bool> = OnceLock::new();
static CACHED_RECS: OnceLock<bool> = OnceLock::new();

// ---------------------------------------------------------------------------
// Public helpers
// ---------------------------------------------------------------------------

/// Check whether dual-write is enabled for a specific entity family.
///
/// Reads `GRAPH_DB_WRITES_ENABLED` (comma-separated list).
/// The value is cached after first access for the lifetime of the process.
pub fn graph_writes_enabled(entity: &str) -> bool {
    CACHED_WRITES
        .get_or_init(|| parse_csv_set(&read_env("GRAPH_DB_WRITES_ENABLED"), &GRAPH_ENTITY_KINDS))
        .contains(entity)
}

/// Check whether graph DB reads are enabled for a specific surface.
///
/// Reads `GRAPH_DB_READS_ENABLED` (comma-separated list).
/// The value is cached after first access for the lifetime of the process.
pub fn graph_reads_enabled(surface: &str) -> bool {
    CACHED_READS
        .get_or_init(|| parse_csv_set(&read_env("GRAPH_DB_READS_ENABLED"), &GRAPH_READ_SURFACES))
        .contains(surface)
}

/// Check whether search should be routed to the graph DB.
///
/// Reads `GRAPH_SEARCH_ENABLED` (boolean).
/// The value is cached after first access for the lifetime of the process.
pub fn graph_search_enabled() -> bool {
    *CACHED_SEARCH.get_or_init(|| parse_boolean_env(&read_env("GRAPH_SEARCH_ENABLED")))
}

/// Check whether recommendations should use PgGraphCandidateSource.
///
/// Reads `GRAPH_RECOMMENDATIONS_ENABLED` (boolean).
/// The value is cached after first access for the lifetime of the process.
pub fn graph_recommendations_enabled() -> bool {
    *CACHED_RECS.get_or_init(|| parse_boolean_env(&read_env("GRAPH_RECOMMENDATIONS_ENABLED")))
}

/// Check whether event recording is enabled for a specific event kind.
///
/// Reads `GRAPH_EVENT_RECORDING_ENABLED` (comma-separated list).
/// The value is cached after first access for the lifetime of the process.
pub fn graph_event_recording_enabled(event_kind: &str) -> bool {
    CACHED_EVENTS
        .get_or_init(|| parse_csv_set(&read_env("GRAPH_EVENT_RECORDING_ENABLED"), &EVENT_KINDS))
        .contains(event_kind)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

// Tests use the internal parse functions directly (not the cached public API)
// to avoid OnceLock state contamination between tests.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_false_when_empty() {
        assert!(parse_csv_set("", &GRAPH_ENTITY_KINDS).is_empty());
        assert!(parse_csv_set("", &GRAPH_READ_SURFACES).is_empty());
        assert!(!parse_boolean_env(""));
    }

    #[test]
    fn csv_parsing_basic() {
        let result = parse_csv_set("posts,follows", &GRAPH_ENTITY_KINDS);
        assert!(result.contains("posts"));
        assert!(result.contains("follows"));
        assert!(!result.contains("artifacts"));
    }

    #[test]
    fn csv_parsing_wildcard_star() {
        let result = parse_csv_set("*", &GRAPH_ENTITY_KINDS);
        assert!(result.contains("posts"));
        assert!(result.contains("follows"));
        assert!(result.contains("artifacts"));
        assert!(result.contains("enrichments"));
        assert!(result.contains("social_events"));
        assert!(result.contains("market_events"));
    }

    #[test]
    fn csv_parsing_wildcard_all() {
        let result = parse_csv_set("all", &GRAPH_READ_SURFACES);
        assert!(result.contains("post_detail"));
        assert!(result.contains("follow_list"));
        assert!(result.contains("search"));
    }

    #[test]
    fn csv_case_insensitive() {
        let result = parse_csv_set("Posts,FOLLOWS", &GRAPH_ENTITY_KINDS);
        assert!(result.contains("posts"));
        assert!(result.contains("follows"));
    }

    #[test]
    fn csv_ignores_unknown_tokens() {
        let result = parse_csv_set("posts,unknown_thing,follows", &GRAPH_ENTITY_KINDS);
        assert!(result.contains("posts"));
        assert!(result.contains("follows"));
        assert!(!result.contains("unknown_thing"));
    }

    #[test]
    fn csv_handles_whitespace() {
        let result = parse_csv_set(" posts , follows , ", &GRAPH_ENTITY_KINDS);
        assert!(result.contains("posts"));
        assert!(result.contains("follows"));
    }

    #[test]
    fn boolean_parsing_truthy_values() {
        for val in &["true", "1", "yes", "on", "TRUE", "True", "Y", "t"] {
            assert!(parse_boolean_env(val), "Expected true for value: {val}");
        }
    }

    #[test]
    fn boolean_parsing_falsy_values() {
        for val in &["false", "0", "no", "off", "", "nope", "random"] {
            assert!(!parse_boolean_env(val), "Expected false for value: {val}");
        }
    }

    #[test]
    fn event_recording_csv() {
        let result = parse_csv_set("social", &EVENT_KINDS);
        assert!(result.contains("social"));
        assert!(!result.contains("market"));
    }

    #[test]
    fn read_surfaces_parsing() {
        let result = parse_csv_set("post_detail,neighborhood", &GRAPH_READ_SURFACES);
        assert!(result.contains("post_detail"));
        assert!(result.contains("neighborhood"));
        assert!(!result.contains("search"));
    }
}
