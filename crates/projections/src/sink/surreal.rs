use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
// `Client` is still referenced in the `RwLockReadGuard<Option<Surreal<Client>>>` type
// returned by `get_connection()`.  The engine types (Ws, Wss) and `Root` moved into
// `connection_manager` where `connect_surreal` lives.
use surrealdb::engine::remote::ws::Client;
use surrealdb::Surreal;
use tracing::{debug, warn};

use crate::error::ProjectionError;
use crate::resilience::connection_manager::{ReconnectingSurreal, SurrealConfig};
use crate::sink::{ProjectionSink, RecordId, SinkOperation};

// ---------------------------------------------------------------------------
// SurrealQL literal serialization
// ---------------------------------------------------------------------------

/// Escape a raw string so it can be embedded inside single-quoted SurrealQL
/// string literals.  The only characters that need escaping inside `'...'`
/// are the backslash and the single-quote itself.
fn escape_surreal_string(s: &str) -> String {
    // Pre-allocate a slightly larger buffer to avoid repeated reallocs.
    let mut out = String::with_capacity(s.len() + 4);
    for ch in s.chars() {
        match ch {
            '\\' => out.push_str(r"\\"),
            '\'' => out.push_str(r"\'"),
            // Newlines / carriage returns inside string literals are legal in
            // SurrealQL, but escaping them keeps the generated statement on
            // one line which makes debugging easier.
            '\n' => out.push_str(r"\n"),
            '\r' => out.push_str(r"\r"),
            other => out.push(other),
        }
    }
    out
}

/// Serialize a `serde_json::Value` to its SurrealQL literal representation.
///
/// # Record-link detection
///
/// If a `Value::String` has the form `"<table>:<id>"` where neither segment
/// is empty, it is emitted as a bare `type::record('<table>', '<id>')` call
/// so that SurrealDB treats it as a record-link rather than a plain string.
///
/// All other strings are wrapped in single quotes with internal escaping.
fn value_to_surql(v: &Value) -> String {
    match v {
        Value::Null => "NONE".to_string(),
        Value::Bool(b) => if *b { "true" } else { "false" }.to_string(),

        // Small integers and floats render as plain numeric literals.  Large
        // integers (common for blockchain wei amounts) are emitted as SurrealQL
        // decimals via `<decimal>'...'` cast to avoid overflowing SurrealDB's
        // i64 parser.
        Value::Number(n) => {
            if n.as_i64().is_some() || n.as_f64().is_some() && n.as_u64().is_none() {
                // Fits in i64, or is a floating-point value — safe as plain literal.
                n.to_string()
            } else {
                // u64 > i64::MAX — use decimal cast.
                format!("<decimal>'{n}'")
            }
        }

        Value::String(s) => {
            // Detect the `decimal:` sentinel used by `decimal_value` /
            // `neg_decimal_value` to carry exact numeric strings.
            if let Some(raw) = s.strip_prefix(crate::projection::DECIMAL_PREFIX) {
                format!("<decimal>'{}'", escape_surreal_string(raw))
            }
            // Detect the `datetime:` sentinel used by `datetime_value`.
            else if let Some(raw) = s.strip_prefix(crate::projection::DATETIME_PREFIX) {
                format!("type::datetime('{}')", escape_surreal_string(raw))
            }
            // Detect `table:id` record-link pattern.
            else if let Some((table, id)) = parse_record_link(s) {
                format!(
                    "type::record('{}', '{}')",
                    escape_surreal_string(table),
                    escape_surreal_string(id),
                )
            } else {
                format!("'{}'", escape_surreal_string(s))
            }
        }

        Value::Array(arr) => {
            let items: Vec<String> = arr.iter().map(value_to_surql).collect();
            format!("[{}]", items.join(", "))
        }

        Value::Object(obj) => {
            let pairs: Vec<String> = obj
                .iter()
                .map(|(k, v)| format!("{}: {}", k, value_to_surql(v)))
                .collect();
            format!("{{{}}}", pairs.join(", "))
        }
    }
}

/// Return `Some((table, id))` when `s` matches the `"table:id"` pattern
/// (both parts non-empty, no additional colons in the table segment).
///
/// This is intentionally conservative: we only treat the value as a record
/// link when the table part looks like a bare identifier.
/// Tables that are valid record-link targets in our SurrealDB schema.
/// Only strings matching `<known_table>:<id>` are coerced to
/// `type::record(...)`. All other `word:stuff` patterns (e.g.
/// `spotify:track:...`, `mailto:user@...`) are emitted as plain strings.
const KNOWN_RECORD_TABLES: &[&str] = &[
    "account", "atom", "triple", "vault", "position", "deposit", "withdraw",
];

fn parse_record_link(s: &str) -> Option<(&str, &str)> {
    // Find the *first* colon — SurrealDB record ids may themselves contain
    // colons (e.g. complex IDs), so we split on the first occurrence only.
    let colon = s.find(':')?;
    let table = &s[..colon];
    let id = &s[colon + 1..];

    if table.is_empty() || id.is_empty() {
        return None;
    }

    // Only coerce to a record-link if the table part matches a known
    // SurrealDB table in our schema. This prevents false positives on
    // user-supplied data like `spotify:track:...` or `urn:isbn:...`.
    if !KNOWN_RECORD_TABLES.contains(&table) {
        return None;
    }

    // Reject URI-like patterns (e.g. `ipfs://...`, `https://...`) where the
    // "id" part starts with `//`.
    if id.starts_with("//") {
        return None;
    }

    Some((table, id))
}

/// Render a `HashMap<String, Value>` as a `{ key: literal, ... }` SurrealQL
/// object literal suitable for use with `MERGE` / `CONTENT`.
fn fields_to_surql_object(fields: &HashMap<String, Value>) -> String {
    if fields.is_empty() {
        return "{}".to_string();
    }
    let pairs: Vec<String> = fields
        .iter()
        .map(|(k, v)| format!("{k}: {}", value_to_surql(v)))
        .collect();
    format!("{{{}}}", pairs.join(", "))
}

// ---------------------------------------------------------------------------
// Schema-aware field coercion
// ---------------------------------------------------------------------------

/// Return true when `raw` is a simple decimal string:
/// `-?\d+(\.\d+)?`.
fn is_decimal_literal(raw: &str) -> bool {
    let body = raw.strip_prefix('-').unwrap_or(raw);
    if body.is_empty() {
        return false;
    }

    let mut parts = body.split('.');
    let whole = parts.next().unwrap_or_default();
    let frac = parts.next();
    let extra = parts.next();

    if extra.is_some() {
        return false;
    }

    if whole.is_empty() || !whole.chars().all(|c| c.is_ascii_digit()) {
        return false;
    }

    match frac {
        None => true,
        Some(f) => !f.is_empty() && f.chars().all(|c| c.is_ascii_digit()),
    }
}

fn coerce_record_field(value: &Value, target_table: &str) -> Value {
    match value {
        Value::String(raw) => {
            if parse_record_link(raw).is_some() {
                Value::String(raw.clone())
            } else {
                Value::String(format!("{target_table}:{raw}"))
            }
        }
        _ => value.clone(),
    }
}

fn coerce_record_array_field(value: &Value, target_table: &str) -> Value {
    match value {
        Value::Array(items) => Value::Array(
            items
                .iter()
                .map(|item| coerce_record_field(item, target_table))
                .collect(),
        ),
        _ => coerce_record_field(value, target_table),
    }
}

fn coerce_decimal_field(value: &Value) -> Value {
    match value {
        Value::String(raw) => {
            if raw.starts_with(crate::projection::DECIMAL_PREFIX) {
                Value::String(raw.clone())
            } else if is_decimal_literal(raw) {
                Value::String(format!("{}{}", crate::projection::DECIMAL_PREFIX, raw))
            } else {
                Value::String(raw.clone())
            }
        }
        _ => value.clone(),
    }
}

fn coerce_int_field(value: &Value) -> Value {
    match value {
        Value::String(raw) => {
            if let Ok(parsed) = raw.parse::<i64>() {
                Value::Number(parsed.into())
            } else {
                Value::String(raw.clone())
            }
        }
        _ => value.clone(),
    }
}

fn coerce_datetime_field(value: &Value) -> Value {
    match value {
        Value::String(raw) => {
            if raw.starts_with(crate::projection::DATETIME_PREFIX) {
                Value::String(raw.clone())
            } else {
                Value::String(format!("{}{}", crate::projection::DATETIME_PREFIX, raw))
            }
        }
        _ => value.clone(),
    }
}

fn normalize_node_field(table: &str, field: &str, value: &Value) -> Value {
    match (table, field) {
        // account
        ("account", "deposited" | "withdrawn" | "net") => coerce_decimal_field(value),

        // atom
        ("atom", "createdBy") => coerce_record_field(value, "account"),
        ("atom", "vault") => coerce_record_field(value, "vault"),

        // triple
        ("triple", "createdBy") => coerce_record_field(value, "account"),
        ("triple", "subject" | "predicate" | "object") => coerce_record_field(value, "atom"),
        ("triple", "vault") => coerce_record_field(value, "vault"),

        // artifact
        ("artifact", "createdBy") => coerce_record_field(value, "account"),

        // vault
        ("vault", "createdBy") => coerce_record_field(value, "account"),
        ("vault", "deposited" | "price") => coerce_decimal_field(value),
        ("vault", "bondingCurve") => coerce_int_field(value),

        // position
        ("position", "account") => coerce_record_field(value, "account"),
        ("position", "vault") => coerce_record_field(value, "vault"),
        ("position", "amount") => coerce_decimal_field(value),

        // stack
        ("stack", "forkedFrom") => coerce_record_field(value, "stack"),
        ("stack", "root") => coerce_record_field(value, "atom"),
        ("stack", "contains") => coerce_record_array_field(value, "atom"),

        _ => value.clone(),
    }
}

fn normalize_edge_field(edge_table: &str, field: &str, value: &Value) -> Value {
    match (edge_table, field) {
        // artifact_link
        ("artifact_link", "createdBy") => coerce_record_field(value, "account"),

        // opinion
        ("opinion", "rating") => coerce_int_field(value),

        // deposit / withdraw
        ("deposit" | "withdraw", "amount") => coerce_decimal_field(value),
        ("deposit" | "withdraw", "curveId" | "blockNumber") => coerce_int_field(value),
        ("deposit" | "withdraw", "updatedAt") => coerce_datetime_field(value),

        // tag
        ("tag", "createdBy") => coerce_record_field(value, "account"),

        _ => value.clone(),
    }
}

fn normalize_increment_field(table: &str, field: &str, value: &Value) -> Value {
    match (table, field) {
        ("account", "deposited" | "withdrawn" | "net") => coerce_decimal_field(value),
        ("position", "amount") => coerce_decimal_field(value),
        ("vault", "deposited" | "price") => coerce_decimal_field(value),
        _ => value.clone(),
    }
}

fn normalize_node_fields(table: &str, fields: &HashMap<String, Value>) -> HashMap<String, Value> {
    fields
        .iter()
        .map(|(k, v)| (k.clone(), normalize_node_field(table, k, v)))
        .collect()
}

fn normalize_edge_fields(
    edge_table: &str,
    fields: &HashMap<String, Value>,
) -> HashMap<String, Value> {
    fields
        .iter()
        .map(|(k, v)| (k.clone(), normalize_edge_field(edge_table, k, v)))
        .collect()
}

fn normalize_increment_fields(
    table: &str,
    increments: &HashMap<String, Value>,
) -> HashMap<String, Value> {
    increments
        .iter()
        .map(|(k, v)| (k.clone(), normalize_increment_field(table, k, v)))
        .collect()
}

// ---------------------------------------------------------------------------
// SurrealQL statement builders
// ---------------------------------------------------------------------------

/// `UPSERT type::record('<table>', '<id>') MERGE { fields };`
fn build_upsert_node(id: &RecordId, fields: &HashMap<String, Value>) -> String {
    let normalized_fields = normalize_node_fields(&id.table, fields);
    format!(
        "UPSERT type::record('{}', '{}') MERGE {};",
        escape_surreal_string(&id.table),
        escape_surreal_string(&id.id),
        fields_to_surql_object(&normalized_fields),
    )
}

/// Build the edge record-id string.
///
/// Without suffix: `edge_table:⟨from_id_to_id⟩`  (a SurrealDB array-based ID)
/// With suffix:    `edge_table:[from_id, to_id, suffix]`
///
/// Using a composite array ID makes edge deduplication deterministic: relating
/// the same two nodes again simply overwrites the existing edge record.
fn build_edge_id(
    edge_table: &str,
    from: &RecordId,
    to: &RecordId,
    id_suffix: Option<&str>,
) -> String {
    let from_lit = format!("'{}'", escape_surreal_string(&from.id));
    let to_lit = format!("'{}'", escape_surreal_string(&to.id));

    match id_suffix {
        None => format!("{}:[{}, {}]", edge_table, from_lit, to_lit,),
        Some(suffix) => format!(
            "{}:[{}, {}, '{}']",
            edge_table,
            from_lit,
            to_lit,
            escape_surreal_string(suffix),
        ),
    }
}

/// Build a `RELATE` via LET variables to avoid inline `type::record()` calls
/// which SurrealDB v3's parser rejects inside RELATE paths.
///
/// Emits three statements: `LET $from = ...; LET $to = ...; RELATE $from->edge->$to ...;`
fn build_upsert_edge(
    from: &RecordId,
    edge_table: &str,
    to: &RecordId,
    id_suffix: Option<&str>,
    fields: &HashMap<String, Value>,
) -> String {
    let normalized_fields = normalize_edge_fields(edge_table, fields);
    let from_expr = format!(
        "type::record('{}', '{}')",
        escape_surreal_string(&from.table),
        escape_surreal_string(&from.id),
    );
    let to_expr = format!(
        "type::record('{}', '{}')",
        escape_surreal_string(&to.table),
        escape_surreal_string(&to.id),
    );
    let edge_id = build_edge_id(edge_table, from, to, id_suffix);

    let relate = if normalized_fields.is_empty() {
        format!("RELATE $from->{edge_id}->$to;")
    } else {
        format!(
            "RELATE $from->{edge_id}->$to CONTENT {};",
            fields_to_surql_object(&normalized_fields),
        )
    };

    format!("LET $from = {from_expr};\nLET $to = {to_expr};\n{relate}")
}

// ---------------------------------------------------------------------------
// Reconcile Triple Draft
// ---------------------------------------------------------------------------

/// Edge tables that may reference a draft triple and need rewriting when the
/// on-chain record replaces the draft.
const TRIPLE_EDGE_REWRITES: &[(&str, &str)] = &[
    ("artifact_link", "in"),
    ("bookmark", "out"),
    ("tag", "out"),
    ("post_refers_item", "out"),
    ("comment_on", "out"),
];

/// Build the SurrealQL statements for draft triple reconciliation.
///
/// Strategy:
/// 1. `LET $drafts` = find **all** triples with matching SPO but a different
///    ID (no LIMIT).  Multiple drafts can exist when the same SPO triple is
///    created offline before the on-chain event lands.
/// 2. `FOR $d IN $drafts` → rewrite every edge reference from that draft to
///    the on-chain record, then DELETE the draft.
/// 3. `UPSERT` the on-chain triple with the provided fields.
/// 4. Preserve `draftedBy` from the first draft (if any) so the authorship
///    attribution set during pre-chain creation is not lost.
///
/// The entire block runs inside the caller's `BEGIN TRANSACTION` wrapper.
fn build_reconcile_triple_draft(
    id: &RecordId,
    subject: &str,
    predicate: &str,
    object: &str,
    fields: &HashMap<String, Value>,
) -> String {
    let normalized_fields = normalize_node_fields(&id.table, fields);

    let table_esc = escape_surreal_string(&id.table);
    let id_esc = escape_surreal_string(&id.id);
    let subj_esc = escape_surreal_string(subject);
    let pred_esc = escape_surreal_string(predicate);
    let obj_esc = escape_surreal_string(object);

    // Sanity-check: the top-level SPO args must agree with what was stored in
    // the fields map.  A mismatch would produce a mis-targeted reconciliation
    // query that silently leaves the wrong drafts alive.  Only active in debug
    // builds — zero overhead in release.
    debug_assert!(
        fields.get("subject").and_then(|v| v.as_str()) == Some(subject),
        "ReconcileTripleDraft: top-level subject must match fields[\"subject\"]"
    );
    debug_assert!(
        fields.get("predicate").and_then(|v| v.as_str()) == Some(predicate),
        "ReconcileTripleDraft: top-level predicate must match fields[\"predicate\"]"
    );
    debug_assert!(
        fields.get("object").and_then(|v| v.as_str()) == Some(object),
        "ReconcileTripleDraft: top-level object must match fields[\"object\"]"
    );

    let mut s = String::with_capacity(1024);

    // 0. Ensure the `triple` table exists before querying it.  On a fresh
    //    SurrealDB instance the table won't exist until the first UPSERT, but
    //    the SELECT below runs *before* that UPSERT.  Without this guard the
    //    SELECT errors with "The table 'triple' does not exist", which rolls
    //    back the entire transaction.  `IF NOT EXISTS` is a no-op when the
    //    table is already defined, so this is safe for established databases.
    s.push_str("DEFINE TABLE IF NOT EXISTS triple SCHEMALESS;\n");
    for (edge_table, _) in TRIPLE_EDGE_REWRITES {
        s.push_str(&format!(
            "DEFINE TABLE IF NOT EXISTS {edge_table} SCHEMALESS TYPE RELATION;\n"
        ));
    }

    // 1. Find ALL draft triples with the same SPO but a different ID.
    //    No LIMIT — there may be more than one pre-chain draft for the same
    //    relationship (e.g. duplicate offline writes before on-chain finality).
    //    We select only the two fields we actually use to keep the query lean.
    //    The `draftedBy != NONE` guard ensures we only touch actual UI-created
    //    drafts — not other on-chain triples that happen to share the same SPO
    //    (e.g. from chaos event injection or cross-chain replays).
    s.push_str(&format!(
        "LET $drafts = (SELECT id, draftedBy FROM triple WHERE \
         subject = type::record('atom', '{subj_esc}') AND \
         predicate = type::record('atom', '{pred_esc}') AND \
         object = type::record('atom', '{obj_esc}') AND \
         id != type::record('{table_esc}', '{id_esc}') AND \
         draftedBy != NONE);\n"
    ));

    // 2. Loop: for every draft, rewrite edge references to the on-chain record
    //    then delete the draft.  Using FOR instead of a conditional IF handles
    //    the zero-draft case automatically (empty range = no iterations).
    s.push_str("FOR $d IN $drafts {\n");
    for (edge_table, direction) in TRIPLE_EDGE_REWRITES {
        s.push_str(&format!(
            "    UPDATE {edge_table} SET {direction} = type::record('{table_esc}', '{id_esc}') \
             WHERE {direction} = $d.id;\n"
        ));
    }
    s.push_str("    DELETE $d.id;\n");
    s.push_str("};\n");

    // 3. UPSERT the on-chain triple record.
    s.push_str(&format!(
        "UPSERT type::record('{table_esc}', '{id_esc}') MERGE {};\n",
        fields_to_surql_object(&normalized_fields),
    ));

    // 4. Preserve `draftedBy` from the first draft (if any).
    //    The UPSERT above does not carry draftedBy — it was set offline on the
    //    draft, not by the on-chain event.  We copy it across here so the
    //    authorship attribution is not lost when the draft is replaced.
    s.push_str(&format!(
        "IF $drafts[0] != NONE AND $drafts[0].draftedBy != NONE THEN {{\n\
         UPDATE type::record('{table_esc}', '{id_esc}') SET draftedBy = $drafts[0].draftedBy;\n\
         }} END;"
    ));

    s
}

// ---------------------------------------------------------------------------
// Increment Fields
// ---------------------------------------------------------------------------

/// `UPSERT type::record('<table>', '<id>') SET field += val, ...;`
///
/// Using `UPSERT` ensures the record is created with the increment amount as
/// the initial value when it does not yet exist, matching the documented
/// semantics of `IncrementFields`.
fn build_increment_fields(id: &RecordId, increments: &HashMap<String, Value>) -> String {
    let normalized_increments = normalize_increment_fields(&id.table, increments);

    if normalized_increments.is_empty() {
        // Nothing to do; emit a no-op INFO statement so the batch index
        // stays consistent (callers that iterate over response indices rely
        // on statement count == operation count).
        return format!(
            "SELECT * FROM type::record('{}', '{}');",
            escape_surreal_string(&id.table),
            escape_surreal_string(&id.id),
        );
    }

    let sets: Vec<String> = normalized_increments
        .iter()
        .map(|(k, v)| format!("{k} += {}", value_to_surql(v)))
        .collect();

    format!(
        "UPSERT type::record('{}', '{}') SET {};",
        escape_surreal_string(&id.table),
        escape_surreal_string(&id.id),
        sets.join(", "),
    )
}

// ---------------------------------------------------------------------------
// SurrealSink
// ---------------------------------------------------------------------------

/// A [`ProjectionSink`] that writes graph operations to SurrealDB over
/// WebSocket using the official Rust SDK v3.
///
/// All operations in a single [`apply_batch`] call are compiled into one
/// multi-statement SurrealQL string and submitted in a single `.query()` round
/// trip, minimising network overhead.
///
/// The underlying connection is managed by [`ReconnectingSurreal`], which
/// serialises reconnection attempts so that when the WebSocket drops all
/// workers wait for a single reconnect rather than stampeding the server.
pub struct SurrealSink {
    /// Shared reconnecting connection wrapper.  `Arc` allows multiple workers
    /// to hold a reference to the same underlying connection without cloning
    /// the websocket handle.
    db: Arc<ReconnectingSurreal>,
    name: String,
}

/// Return true when a Surreal statement error indicates a retryable write
/// conflict (optimistic transaction contention), not malformed query data.
fn is_retryable_conflict_error(err: &surrealdb::Error) -> bool {
    let msg = err.to_string().to_ascii_lowercase();
    msg.contains("transaction conflict") || msg.contains("resource busy")
}

/// Return true when the aggregated error message indicates a UNIQUE index
/// rejection.  SurrealDB emits messages like:
///
///   "Database index `idx_triple_spo` already contains ..."
///
/// The tighter primary match requires **both** "database index" and "already
/// contains" so that plain strings containing "already contains" (e.g. custom
/// error messages from user queries) are not misclassified.  The secondary
/// branch ("index" + "unique") catches alternative phrasings from future
/// SurrealDB versions.
fn is_unique_constraint_violation(msg: &str) -> bool {
    let lower = msg.to_ascii_lowercase();
    (lower.contains("database index") && lower.contains("already contains"))
        || (lower.contains("index") && lower.contains("unique"))
}

impl SurrealSink {
    /// Open a WebSocket connection to SurrealDB and authenticate.
    ///
    /// # Arguments
    ///
    /// * `url`       - WebSocket URL, e.g. `ws://localhost:8000`
    /// * `user`      - Root username
    /// * `pass`      - Root password
    /// * `namespace` - SurrealDB namespace to select
    /// * `database`  - SurrealDB database to select within the namespace
    ///
    /// # Errors
    ///
    /// Returns [`ProjectionError::Surreal`] if the connection, sign-in, or
    /// namespace/database selection fails.
    pub async fn new(
        url: &str,
        user: &str,
        pass: &str,
        namespace: &str,
        database: &str,
    ) -> Result<Self, ProjectionError> {
        tracing::info!(url, namespace, database, "Connecting to SurrealDB");

        // Delegate all connection/auth/namespace logic to `ReconnectingSurreal`.
        // This also stores the config so reconnection can reproduce the same
        // sequence (connect → signin → use_ns/use_db) automatically.
        let config = SurrealConfig {
            url: url.to_string(),
            user: user.to_string(),
            pass: pass.to_string(),
            namespace: namespace.to_string(),
            database: database.to_string(),
        };
        let db = ReconnectingSurreal::new(config)
            .await
            .map_err(ProjectionError::Surreal)?;

        // Mark connection as healthy immediately — don't wait for the first
        // successful apply_batch, which may not happen for a while if there
        // are no new events of the types this worker handles.
        crate::metrics::set_surreal_connection_state(true);

        debug!(url, namespace, database, "Connected to SurrealDB");

        Ok(Self {
            db,
            name: "surrealdb".to_string(),
        })
    }
}

#[async_trait]
impl ProjectionSink for SurrealSink {
    fn name(&self) -> &str {
        &self.name
    }

    /// Compile all `ops` into a single SurrealQL script and execute it in one
    /// round trip.
    ///
    /// The batch is wrapped in `BEGIN TRANSACTION` / `COMMIT TRANSACTION`
    /// so that either all statements succeed or the entire batch is rolled
    /// back, preventing double-counted increments on retry.
    ///
    /// # Errors
    ///
    /// Returns [`ProjectionError::Surreal`] on transport or protocol errors.
    /// Returns [`ProjectionError::Sink`] if any individual statement inside
    /// the batch is rejected by the server.
    async fn apply_batch(&self, ops: &[SinkOperation]) -> Result<(), ProjectionError> {
        if ops.is_empty() {
            return Ok(());
        }

        let surql = build_batch_query(ops);

        // Obtain a read-lock guard that holds the live `Surreal<Client>`, then
        // immediately clone it and release the lock.  `Surreal<Client>` is
        // `Arc`-backed internally, so cloning is O(1) and incurs no network
        // activity.  Releasing the read-lock before the `.query().await` is
        // important: holding it across an async boundary would block concurrent
        // reconnection attempts for the entire duration of slow queries.
        let conn: Surreal<Client> = {
            let guard = self
                .db
                .get_connection()
                .await
                .map_err(ProjectionError::Surreal)?;
            // `get_connection` always returns `Some` on `Ok`; the `expect` is an
            // invariant assertion, not a recoverable error path.
            guard
                .as_ref()
                .expect("connection is Some after successful get_connection")
                .clone()
            // `guard` is dropped here, releasing the read-lock.
        };

        // Execute the whole batch as one query call and check for per-statement errors.
        execute_and_check_errors(&self.db, conn, &surql).await
    }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/// Compile `ops` into a single `BEGIN TRANSACTION; ...; COMMIT TRANSACTION;`
/// SurrealQL string.
///
/// The transaction wrapper ensures the batch is atomic: either all statements
/// succeed or the entire batch is rolled back, preventing double-counted
/// increments on retry.
fn build_batch_query(ops: &[SinkOperation]) -> String {
    let mut surql = String::with_capacity(ops.len() * 128 + 64);
    surql.push_str("BEGIN TRANSACTION;\n");
    for op in ops {
        let stmt = match op {
            SinkOperation::UpsertNode { id, fields } => build_upsert_node(id, fields),
            SinkOperation::UpsertEdge {
                from,
                edge_table,
                to,
                id_suffix,
                fields,
            } => build_upsert_edge(from, edge_table, to, id_suffix.as_deref(), fields),
            SinkOperation::IncrementFields { id, increments } => {
                build_increment_fields(id, increments)
            }
            SinkOperation::ReconcileTripleDraft {
                id,
                subject,
                predicate,
                object,
                fields,
            } => build_reconcile_triple_draft(id, subject, predicate, object, fields),
        };
        debug!(statement = %stmt, "SurrealDB statement");
        surql.push_str(&stmt);
        surql.push('\n');
    }
    surql.push_str("COMMIT TRANSACTION;\n");
    surql
}

/// Execute `surql` on `conn` and surface any per-statement errors.
///
/// On a transport/protocol error, marks the connection as disconnected and
/// returns [`ProjectionError::Surreal`].  On per-statement errors, logs each
/// one and returns an aggregated [`ProjectionError::Sink`].
async fn execute_and_check_errors(
    db: &Arc<crate::resilience::connection_manager::ReconnectingSurreal>,
    conn: Surreal<Client>,
    surql: &str,
) -> Result<(), ProjectionError> {
    // Execute the whole batch as one query call.
    // `.query()` returns a `Response` whose individual statement results
    // can be inspected, but we only need to know whether *any* failed.
    let mut response = match conn.query(surql).await {
        Ok(r) => {
            crate::metrics::set_surreal_connection_state(true);
            r
        }
        Err(e) => {
            // Mark the connection as broken so the next caller triggers
            // a reconnection rather than repeatedly hitting a dead socket.
            db.mark_disconnected();
            crate::metrics::set_surreal_connection_state(false);
            return Err(ProjectionError::Surreal(e));
        }
    };

    // `take_errors` removes and returns all per-statement errors from the
    // response object.  If any statement failed the server still executed
    // the rest (SurrealDB does not roll back on statement error by default
    // unless the query is wrapped in a `BEGIN TRANSACTION` block).
    let errors = response.take_errors();
    if errors.is_empty() {
        return Ok(());
    }

    // Log every individual statement error for observability, then
    // surface a single aggregated error to the caller.
    //
    // Known retryable transaction-conflict errors are emitted at debug
    // level because worker-level retry logs already report them as
    // transient; keeping them as warnings can create noisy false alarms.
    for (idx, err) in &errors {
        if is_retryable_conflict_error(err) {
            debug!(
                statement_index = idx,
                error = %err,
                "SurrealDB transient statement conflict"
            );
        } else {
            warn!(statement_index = idx, error = %err, "SurrealDB statement error");
        }
    }

    let messages: Vec<String> = errors.into_values().map(|e| e.to_string()).collect();
    let joined = messages.join("; ");

    // Detect UNIQUE index violations (e.g. `idx_triple_spo`).  SurrealDB
    // reports these as "Database index ... already contains ..." or similar
    // index+unique phrasing.  Return a dedicated Fatal variant so the worker
    // dead-letters the event instead of retrying forever.
    if is_unique_constraint_violation(&joined) {
        return Err(ProjectionError::UniqueConstraintViolation(format!(
            "SurrealDB batch contained {} unique-constraint error(s): {}",
            messages.len(),
            joined,
        )));
    }

    Err(ProjectionError::Sink(format!(
        "SurrealDB batch contained {} error(s): {}",
        messages.len(),
        joined,
    )))
}

// ---------------------------------------------------------------------------
// Unit tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    // -- escape_surreal_string -----------------------------------------------

    #[test]
    fn test_escape_plain_string() {
        assert_eq!(escape_surreal_string("hello world"), "hello world");
    }

    #[test]
    fn test_escape_single_quote() {
        assert_eq!(escape_surreal_string("it's"), r"it\'s");
    }

    #[test]
    fn test_escape_backslash() {
        assert_eq!(escape_surreal_string(r"a\b"), r"a\\b");
    }

    #[test]
    fn test_escape_newline_and_cr() {
        assert_eq!(escape_surreal_string("a\nb\rc"), r"a\nb\rc");
    }

    // -- parse_record_link ---------------------------------------------------

    #[test]
    fn test_parse_record_link_valid() {
        assert_eq!(parse_record_link("atom:0xabc"), Some(("atom", "0xabc")));
    }

    #[test]
    fn test_parse_record_link_empty_id() {
        assert_eq!(parse_record_link("atom:"), None);
    }

    #[test]
    fn test_parse_record_link_empty_table() {
        assert_eq!(parse_record_link(":0xabc"), None);
    }

    #[test]
    fn test_parse_record_link_url_with_dots_rejected() {
        // URLs with dots in the scheme/host are rejected by the identifier
        // check on the table segment.
        assert_eq!(parse_record_link("some.thing:value"), None);
        assert_eq!(parse_record_link("foo.bar:baz"), None);
    }

    #[test]
    fn test_parse_record_link_uri_scheme_rejected() {
        // URI-like strings such as `ipfs://...` or `https://...` must not be
        // treated as record links even though the scheme is alphanumeric.
        assert_eq!(
            parse_record_link("ipfs://bafkreiduzz3uwm5jq5tkhkfl4bsizd4e3brm54rfhwy2nzzynfuj2v4gsa"),
            None
        );
        assert_eq!(parse_record_link("https://example.com"), None);
    }

    #[test]
    fn test_parse_record_link_no_colon() {
        assert_eq!(parse_record_link("justaplainstring"), None);
    }

    // -- value_to_surql ------------------------------------------------------

    #[test]
    fn test_value_null() {
        assert_eq!(value_to_surql(&Value::Null), "NONE");
    }

    #[test]
    fn test_value_bool_true() {
        assert_eq!(value_to_surql(&json!(true)), "true");
    }

    #[test]
    fn test_value_bool_false() {
        assert_eq!(value_to_surql(&json!(false)), "false");
    }

    #[test]
    fn test_value_integer() {
        assert_eq!(value_to_surql(&json!(42)), "42");
    }

    #[test]
    fn test_value_large_integer_uses_decimal() {
        // Wei amounts like 10^18 exceed i64::MAX when negated, and some
        // u256 values exceed u64::MAX.  Verify they get the decimal cast.
        let big: u64 = 10_000_000_000_000_000_000; // 10^19, > i64::MAX
        let v = Value::Number(serde_json::Number::from(big));
        assert_eq!(value_to_surql(&v), format!("<decimal>'{big}'"));
    }

    #[test]
    fn test_value_float() {
        assert_eq!(value_to_surql(&json!(2.5)), "2.5");
    }

    #[test]
    fn test_value_decimal_string() {
        // The `decimal:` sentinel from `decimal_value` should emit a <decimal> cast.
        let v = json!("decimal:12345678901234567890");
        assert_eq!(value_to_surql(&v), "<decimal>'12345678901234567890'");
    }

    #[test]
    fn test_value_neg_decimal_string() {
        // The `decimal:` sentinel from `neg_decimal_value` should emit a negated <decimal>.
        let v = json!("decimal:-980000");
        assert_eq!(value_to_surql(&v), "<decimal>'-980000'");
    }

    #[test]
    fn test_value_datetime_string() {
        let v = json!("datetime:2026-03-03T17:35:20Z");
        assert_eq!(value_to_surql(&v), "type::datetime('2026-03-03T17:35:20Z')",);
    }

    #[test]
    fn test_value_plain_string() {
        assert_eq!(value_to_surql(&json!("hello")), "'hello'");
    }

    #[test]
    fn test_value_string_with_quote() {
        assert_eq!(value_to_surql(&json!("it's")), r"'it\'s'");
    }

    #[test]
    fn test_value_record_link() {
        assert_eq!(
            value_to_surql(&json!("atom:0xdeadbeef")),
            "type::record('atom', '0xdeadbeef')",
        );
    }

    #[test]
    fn test_value_array() {
        let v = json!([1, "a", true]);
        assert_eq!(value_to_surql(&v), "[1, 'a', true]");
    }

    #[test]
    fn test_value_object() {
        // Object key ordering from serde_json is insertion order.
        let v = json!({"x": 1});
        assert_eq!(value_to_surql(&v), "{x: 1}");
    }

    // -- statement builders --------------------------------------------------

    #[test]
    fn test_build_upsert_node_empty_fields() {
        let id = RecordId::new("atom", "0x01");
        let stmt = build_upsert_node(&id, &HashMap::new());
        assert_eq!(stmt, "UPSERT type::record('atom', '0x01') MERGE {};");
    }

    #[test]
    fn test_build_upsert_node_with_fields() {
        let id = RecordId::new("atom", "0x01");
        let mut fields = HashMap::new();
        fields.insert("label".to_string(), json!("my atom"));
        let stmt = build_upsert_node(&id, &fields);
        assert!(stmt.starts_with("UPSERT type::record('atom', '0x01') MERGE {"));
        assert!(stmt.contains("label: 'my atom'"));
        assert!(stmt.ends_with("};"));
    }

    #[test]
    fn test_build_upsert_edge_no_suffix_no_fields() {
        let from = RecordId::new("account", "alice");
        let to = RecordId::new("atom", "0x01");
        let stmt = build_upsert_edge(&from, "holds", &to, None, &HashMap::new());
        assert!(stmt.contains("LET $from = type::record('account', 'alice');"));
        assert!(stmt.contains("LET $to = type::record('atom', '0x01');"));
        assert!(stmt.contains("RELATE $from->holds:['alice', '0x01']->$to;"));
    }

    #[test]
    fn test_build_upsert_edge_with_suffix() {
        let from = RecordId::new("account", "alice");
        let to = RecordId::new("atom", "0x01");
        let stmt = build_upsert_edge(&from, "holds", &to, Some("extra"), &HashMap::new());
        assert!(stmt.contains("holds:['alice', '0x01', 'extra']"));
    }

    #[test]
    fn test_build_upsert_edge_with_fields() {
        let from = RecordId::new("account", "alice");
        let to = RecordId::new("atom", "0x01");
        let mut fields = HashMap::new();
        fields.insert("weight".to_string(), json!(10));
        let stmt = build_upsert_edge(&from, "holds", &to, None, &fields);
        assert!(stmt.contains("LET $from ="));
        assert!(stmt.contains("RELATE $from->"));
        assert!(stmt.contains("CONTENT {"));
        assert!(stmt.contains("weight: 10"));
    }

    #[test]
    fn test_build_upsert_node_coerces_atom_record_refs() {
        let id = RecordId::new("atom", "0x01");
        let mut fields = HashMap::new();
        fields.insert("createdBy".to_string(), json!("0xcreator"));
        fields.insert("vault".to_string(), json!("42"));

        let stmt = build_upsert_node(&id, &fields);
        assert!(stmt.contains("createdBy: type::record('account', '0xcreator')"));
        assert!(stmt.contains("vault: type::record('vault', '42')"));
    }

    #[test]
    fn test_build_upsert_node_coerces_triple_spo_refs() {
        let id = RecordId::new("triple", "99");
        let mut fields = HashMap::new();
        fields.insert("subject".to_string(), json!("10"));
        fields.insert("predicate".to_string(), json!("20"));
        fields.insert("object".to_string(), json!("30"));

        let stmt = build_upsert_node(&id, &fields);
        assert!(stmt.contains("subject: type::record('atom', '10')"));
        assert!(stmt.contains("predicate: type::record('atom', '20')"));
        assert!(stmt.contains("object: type::record('atom', '30')"));
    }

    #[test]
    fn test_build_upsert_node_coerces_vault_price_to_decimal() {
        let id = RecordId::new("vault", "7");
        let mut fields = HashMap::new();
        fields.insert("price".to_string(), json!("1050000000000000000"));

        let stmt = build_upsert_node(&id, &fields);
        assert!(stmt.contains("price: <decimal>'1050000000000000000'"));
    }

    #[test]
    fn test_build_upsert_node_coerces_position_refs() {
        let id = RecordId::new("position", "0xabc_7");
        let mut fields = HashMap::new();
        fields.insert("account".to_string(), json!("0xabc"));
        fields.insert("vault".to_string(), json!("7"));

        let stmt = build_upsert_node(&id, &fields);
        assert!(stmt.contains("account: type::record('account', '0xabc')"));
        assert!(stmt.contains("vault: type::record('vault', '7')"));
    }

    #[test]
    fn test_build_upsert_edge_coerces_deposit_curve_id_to_int() {
        let from = RecordId::new("account", "alice");
        let to = RecordId::new("vault", "7");
        let mut fields = HashMap::new();
        fields.insert("amount".to_string(), json!("decimal:980000"));
        fields.insert("curveId".to_string(), json!("1"));

        let stmt = build_upsert_edge(&from, "deposit", &to, None, &fields);
        assert!(stmt.contains("curveId: 1"));
        assert!(stmt.contains("amount: <decimal>'980000'"));
    }

    #[test]
    fn test_build_upsert_edge_coerces_deposit_datetimes() {
        let from = RecordId::new("account", "alice");
        let to = RecordId::new("vault", "7");
        let mut fields = HashMap::new();
        fields.insert("onchain".to_string(), json!(true));
        fields.insert(
            "updatedAt".to_string(),
            json!("datetime:2026-03-03T17:35:20Z"),
        );

        let stmt = build_upsert_edge(&from, "deposit", &to, None, &fields);
        assert!(stmt.contains("onchain: true"));
        assert!(stmt.contains("updatedAt: type::datetime('2026-03-03T17:35:20Z')"));
    }

    #[test]
    fn test_build_increment_fields() {
        let id = RecordId::new("stats", "global");
        let mut inc = HashMap::new();
        inc.insert("total_atoms".to_string(), json!(1));
        let stmt = build_increment_fields(&id, &inc);
        assert_eq!(
            stmt,
            "UPSERT type::record('stats', 'global') SET total_atoms += 1;"
        );
    }

    #[test]
    fn test_build_increment_fields_coerces_vault_decimal_string() {
        let id = RecordId::new("vault", "7");
        let mut inc = HashMap::new();
        inc.insert("deposited".to_string(), json!("980000"));
        let stmt = build_increment_fields(&id, &inc);
        assert_eq!(
            stmt,
            "UPSERT type::record('vault', '7') SET deposited += <decimal>'980000';"
        );
    }

    #[test]
    fn test_build_increment_fields_empty() {
        let id = RecordId::new("stats", "global");
        let stmt = build_increment_fields(&id, &HashMap::new());
        // Should be a no-op SELECT, not a SET with empty body.
        assert!(stmt.starts_with("SELECT * FROM type::record("));
    }

    #[test]
    fn test_escape_in_id_and_table() {
        // Verify that apostrophes inside table/id names are safely escaped.
        let id = RecordId::new("my'table", "id'with'quotes");
        let stmt = build_upsert_node(&id, &HashMap::new());
        assert!(stmt.contains(r"my\'table"));
        assert!(stmt.contains(r"id\'with\'quotes"));
    }

    // -- build_reconcile_triple_draft -----------------------------------------

    #[test]
    fn test_reconcile_triple_draft_contains_all_statements() {
        let id = RecordId::new("triple", "0x99");
        let mut fields = HashMap::new();
        fields.insert("subject".to_string(), json!("0x01"));
        fields.insert("predicate".to_string(), json!("0x02"));
        fields.insert("object".to_string(), json!("0x03"));
        fields.insert("onchain".to_string(), json!(true));
        fields.insert("createdBy".to_string(), json!("0xCreator"));

        let stmt = build_reconcile_triple_draft(&id, "0x01", "0x02", "0x03", &fields);

        // 0. DEFINE TABLE guard for fresh databases
        assert!(
            stmt.contains("DEFINE TABLE IF NOT EXISTS triple SCHEMALESS"),
            "must define triple table before querying it"
        );

        // 1. LET $drafts with SELECT id, draftedBy (no SELECT * and no LIMIT 1)
        assert!(stmt.contains("LET $drafts"), "must have LET $drafts");
        assert!(
            stmt.contains("SELECT id, draftedBy FROM triple"),
            "must select only id and draftedBy, not SELECT *"
        );
        assert!(
            stmt.contains("subject = type::record('atom', '0x01')"),
            "must filter by subject"
        );
        assert!(
            stmt.contains("predicate = type::record('atom', '0x02')"),
            "must filter by predicate"
        );
        assert!(
            stmt.contains("object = type::record('atom', '0x03')"),
            "must filter by object"
        );
        assert!(
            stmt.contains("id != type::record('triple', '0x99')"),
            "must exclude on-chain ID"
        );
        assert!(
            stmt.contains("draftedBy != NONE"),
            "must filter to actual drafts — not other on-chain triples with same SPO"
        );
        assert!(
            !stmt.contains("LIMIT"),
            "must not have LIMIT — all drafts must be processed"
        );

        // 2. FOR loop with edge rewrites (replaces the old IF block)
        assert!(
            stmt.contains("FOR $d IN $drafts"),
            "must use FOR loop over $drafts"
        );
        for (edge_table, direction) in TRIPLE_EDGE_REWRITES {
            assert!(
                stmt.contains(&format!("UPDATE {edge_table} SET {direction} =")),
                "must rewrite {edge_table}.{direction}"
            );
            // Edge rewrites must reference $d.id, not $draft[0].id
            assert!(
                stmt.contains(&format!("WHERE {direction} = $d.id")),
                "{edge_table}.{direction} rewrite must reference $d.id"
            );
        }
        assert!(stmt.contains("DELETE $d.id"), "must DELETE via $d.id");

        // 3. UPSERT the on-chain record
        assert!(
            stmt.contains("UPSERT type::record('triple', '0x99') MERGE"),
            "must UPSERT on-chain triple"
        );
        assert!(stmt.contains("onchain: true"), "must include onchain field");

        // 4. draftedBy preservation block
        assert!(
            stmt.contains("$drafts[0].draftedBy"),
            "must preserve draftedBy from first draft"
        );
        assert!(
            stmt.contains("SET draftedBy = $drafts[0].draftedBy"),
            "must SET draftedBy on the on-chain record"
        );
    }

    #[test]
    fn test_reconcile_triple_draft_normalizes_spo_fields() {
        let id = RecordId::new("triple", "0x99");
        let mut fields = HashMap::new();
        // SPO fields without "atom:" prefix — should be coerced by normalize_node_fields
        fields.insert("subject".to_string(), json!("0x01"));
        fields.insert("predicate".to_string(), json!("0x02"));
        fields.insert("object".to_string(), json!("0x03"));
        fields.insert("createdBy".to_string(), json!("0xCreator"));
        fields.insert("vault".to_string(), json!("0x99"));

        let stmt = build_reconcile_triple_draft(&id, "0x01", "0x02", "0x03", &fields);

        // The UPSERT MERGE object should contain coerced record-links
        assert!(
            stmt.contains("subject: type::record('atom', '0x01')"),
            "subject must be coerced to atom record-link in MERGE"
        );
        assert!(
            stmt.contains("createdBy: type::record('account', '0xCreator')"),
            "createdBy must be coerced to account record-link"
        );
    }

    #[test]
    fn test_reconcile_in_batch_query() {
        let ops = vec![SinkOperation::ReconcileTripleDraft {
            id: RecordId::new("triple", "0x99"),
            subject: "0x01".to_string(),
            predicate: "0x02".to_string(),
            object: "0x03".to_string(),
            fields: HashMap::from([
                ("onchain".to_string(), json!(true)),
                ("subject".to_string(), json!("0x01")),
                ("predicate".to_string(), json!("0x02")),
                ("object".to_string(), json!("0x03")),
            ]),
        }];
        let batch = build_batch_query(&ops);
        assert!(batch.starts_with("BEGIN TRANSACTION;"));
        assert!(batch.contains("LET $drafts"));
        assert!(batch.ends_with("COMMIT TRANSACTION;\n"));
    }

    // -- is_unique_constraint_violation ---------------------------------------

    #[test]
    fn test_unique_constraint_violation_already_contains() {
        // The primary pattern requires "database index" + "already contains".
        assert!(is_unique_constraint_violation(
            "Database index `idx_triple_spo` already contains 0x01, 0x02, 0x03"
        ));
    }

    #[test]
    fn test_unique_constraint_violation_already_contains_without_database_index_is_false() {
        // "already contains" alone is no longer sufficient — the caller must
        // also include "database index" to avoid false positives on custom
        // error messages that happen to contain that phrase.
        assert!(!is_unique_constraint_violation(
            "The record already contains a value for this field"
        ));
    }

    #[test]
    fn test_unique_constraint_violation_index_unique() {
        assert!(is_unique_constraint_violation(
            "UNIQUE index violation on triple table"
        ));
    }

    #[test]
    fn test_unique_constraint_violation_normal_error_is_false() {
        assert!(!is_unique_constraint_violation("transaction conflict"));
        assert!(!is_unique_constraint_violation("Connection refused"));
    }

    /// Pin the exact contents of `TRIPLE_EDGE_REWRITES`.
    ///
    /// The same list is duplicated in the TypeScript reconciliation script at
    /// `scripts/reconcile-draft-triples.ts`.  If you add or remove an entry
    /// here, update the TypeScript list and this test simultaneously.
    #[test]
    fn triple_edge_rewrites_pinned() {
        let expected: &[(&str, &str)] = &[
            ("artifact_link", "in"),
            ("bookmark", "out"),
            ("tag", "out"),
            ("post_refers_item", "out"),
            ("comment_on", "out"),
        ];
        assert_eq!(
            TRIPLE_EDGE_REWRITES, expected,
            "TRIPLE_EDGE_REWRITES changed — update scripts/reconcile-draft-triples.ts to match"
        );
    }
}
