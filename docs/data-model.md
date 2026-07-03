# Data model

Intuition Core uses two local databases:

- **Postgres-KG** (`intuition_kg`) stores the queryable knowledge graph:
  accounts, atoms, triples, predicates, enrichment artifacts, adjacency, and API
  keys.
- **TimescaleDB** (`intuition`) stores chain events and market projections:
  event-store rows, typed event tables, vaults, positions, signals,
  leaderboards, and protocol stats.

The two databases are intentionally separate. The KG can be used without chain
indexing, while Timescale projections can replay onchain events and write the
derived atoms/triples into the KG.

## Connection cheat sheet

When running the default Docker Compose stack:

```bash
# Knowledge graph
psql postgresql://intuition:intuition@localhost:5432/intuition_kg

# Chain event store and market read models
psql postgresql://intuition:intuition@localhost:5433/intuition
```

Useful helpers:

```bash
make explore      # guided KG snapshot
make smoke        # API/workers/triples smoke test
make smoke-index  # bounded public testnet indexing smoke test
```

## Relationship map

```mermaid
erDiagram
  KG_ACCOUNTS ||--o{ KG_NODES : creates
  KG_ACCOUNTS ||--o{ KG_TRIPLES : creates
  KG_ACCOUNTS ||--o{ KG_API_KEYS : owns
  KG_NODES ||--o{ KG_ARTIFACTS : has
  KG_NODES ||--o{ KG_NODE_URLS : exposes
  KG_NODES ||--o| KG_NODE_STATS : summarizes
  KG_PREDICATES ||--o{ KG_TRIPLES : labels
  KG_TRIPLES ||--o{ KG_ADJACENCY : projects
  KG_TRIPLES ||--o| KG_TRIPLE_PATTERN_STATS : aggregates
  KG_PREDICATES ||--o| KG_PREDICATE_STATS : aggregates
  TS_EVENT_STORE ||--o{ TS_TYPED_EVENTS : normalizes
  TS_EVENT_STORE ||--o{ TS_PROJECTION_CHECKPOINTS : advances
  TS_TYPED_EVENTS ||--o{ TS_TERM : creates
  TS_TYPED_EVENTS ||--o{ TS_VAULT : updates
  TS_TYPED_EVENTS ||--o{ TS_POSITION : updates
  TS_TERM ||--o| TS_TERM_SUMMARY : summarizes
  TS_VAULT ||--o{ TS_SHARE_PRICE_HISTORY : records
  TS_POSITION ||--o{ TS_POSITION_CHANGE : records
  TS_ACCOUNT ||--o{ TS_POSITION : holds
  TS_ACCOUNT ||--o{ TS_LEADERBOARD_CACHE : ranks
  TS_TERM ||..|| KG_NODES : "atom term_id maps to node id"
  TS_TERM ||..|| KG_TRIPLES : "triple term_id maps to triple id"
```

## Postgres-KG tables

### `kg.accounts` and `kg.account_stats`

`kg.accounts` is keyed by wallet address. API-key writes and indexed onchain
writes attribute created atoms/triples through `created_by`.

`kg.account_stats` stores denormalized counts such as created atom count,
created triple count, deposits, withdrawals, and last activity timestamps.

### `kg.nodes`

Atoms live in `kg.nodes`. Important columns:

- `id`: deterministic protocol atom id.
- `raw_type`: one of `string`, `json`, `http_uri`, or `ipfs_uri`.
- `data`, `data_hex`, `data_resolved`: original and resolved atom payloads.
- `status`, `visibility`: public API reads only serve `active` + `public`.
- `created_by`: KG account that created the row, when known.
- `is_onchain`: whether the atom was observed from the chain.
- `parse_status`, `classification_status`, `enrichment_status`: worker state
  machines with `pending`, `processing`, `completed`, `failed`, or `skipped`.
- `classification_type`: normalized atom type used by API filtering.
- `processing_meta`, `*_attempts`, `*_error`, `*_lease_expires_at`: worker
  retry, lease, and error state.
- `search_text`: denormalized search text used by the read API.

Indexes cover public created-at scans, raw payload de-duplication, creator
history, classification filters, and stale worker lease recovery.

### `kg.triples`

Triples are claims between terms. Important columns:

- `id`: deterministic protocol triple id.
- `subject_id`, `predicate_id`, `object_id`: referenced term ids.
- `subject_type`, `predicate_type`, `object_type`: `node` or `triple`.
- `status`, `visibility`, `created_by`, `is_onchain`: same role as on atoms.
- `is_counter_triple`, `sibling_triple_id`: counter-claim relationship.
- `edge_kind`, `source`, `source_uri`, `confidence`, `inferred`: provenance
  and confidence metadata.
- `provenance`, `metadata`: structured extension points.

The table has six hexastore indexes (`SPO`, `SOP`, `PSO`, `POS`, `OSP`, `OPS`)
plus direct subject, predicate, and object indexes. That is why
`GET /api/atoms/:id/triples` can find claims where an atom appears in any
position.

### `kg.predicates` and `kg.predicate_stats`

`kg.predicates` is the semantic predicate registry. The seed set includes 14
baseline predicates such as `references`, `follows`, `has-tag`, and
`trusted-in-the-context-of`.

Each row has a unique `slug`, human `label`, optional inverse predicate, and
semantic flags (`is_transitive`, `is_symmetric`, `is_hierarchical`,
`is_social`, `is_market`).

`kg.predicate_stats` stores aggregate counts, distinct subject/object counts,
average degrees, and selectivity scores.

### `kg.adjacency`

`kg.adjacency` is the denormalized traversal index. Each triple can produce
source -> neighbor rows in a direction, with predicate ref, neighbor ref,
`triple_id`, and optional `weight`, `market_weight`, and `social_weight`.

Use this table for neighborhood queries instead of scanning all triples.

### `kg.artifacts`

`kg.artifacts` stores outputs from classification and enrichment providers.
Rows are keyed by artifact id and include:

- `node_id`: owning atom.
- `artifact_kind` and `artifact_version`: provider/output identity.
- `status`: artifact processing state.
- `source_uri`, `source_hash`: provenance and de-duplication helpers.
- `data`, `extracted`, `error`: provider payload and normalized fields.
- `created_by_account_id`: account attribution, when available.

### `kg.node_urls`

`kg.node_urls` indexes URL evidence extracted for an atom. The primary key is
`(node_id, url)`, with precomputed `domain`, `source`, optional `artifact_id`,
`is_primary`, and metadata. A partial unique index allows at most one primary
URL per atom.

### `kg.events`

`kg.events` is an append-only KG event log with `event_time`, `actor_id`,
`entity_kind`, `entity_id`, `event_type`, optional chain coordinates, and JSON
payload. Migrations convert it to a Timescale hypertable and define
`kg.events_hourly` for hourly rollups.

### `kg.api_keys`

`kg.api_keys` is operator-managed API auth for the query API:

- `id`: display key id, such as `key_...`.
- `key_hash`: SHA-256 hash of the plaintext `ik_...` key.
- `name`, `account_id`, `can_write`, `rate_limit_rpm`.
- `created_at`, `revoked_at`, `last_used_at`.

Plaintext keys are printed once by the key script and are never stored.

## TimescaleDB tables

### `projection_checkpoints`

Projection workers use `projection_checkpoints` for resumability. Each row is
unique by `(projection_name, sink_name)` and stores the last processed sequence
number and block number.

### `event_store`

`event_store` is the canonical append-only chain event log. Important columns:

- `sequence_number`: ingestion order.
- `block_number`, `block_timestamp`, `block_hash`.
- `transaction_hash`, `log_index`: event identity.
- `event_type`, `event_data`: decoded event payload.
- `term_id`, `entity_id`: optional derived identifiers for fast lookups.
- `is_canonical`: reorg/canonicality marker.

The primary key includes `block_timestamp` for Timescale compatibility. Indexes
cover sequence, block number, event type, term id, and entity id.

### Typed event tables

Typed event tables normalize common MultiVault events:

- `atom_created_events`
- `triple_created_events`
- `deposited_events`
- `redeemed_events`
- `share_price_changed_events`
- `protocol_fee_accrued_events`

These tables keep block metadata, transaction identity, creator/sender fields,
term and curve identifiers, amounts/shares, and sequence numbers in queryable
columns.

### Normalized fact tables

The `event`, `deposit_fact`, `redemption_fact`, and `fee_transfer_fact` tables
store stable fact rows keyed by `event_id`. They are designed for market
analytics and account/term aggregation.

### Terms and summaries

`term` stores onchain atom/triple terms:

- Atom terms use `term_type = 'atom'` and carry `atom_data` / `atom_data_hex`.
- Triple terms use subject, predicate, and object ids.

`term_summary`, `term_market_cap_history`, `predicate_object_summary`, and
`subject_predicate_summary` store market-cap and relationship rollups.

### Vaults, positions, and signals

`vault` is keyed by `(term_id, curve_id)` and stores current shares, assets,
share price, market cap, and holder counts. `share_price_history` records
time-series share price changes.

`position` is keyed by `(account_id, term_id, curve_id)`. `position_change`
records deposit/redeem deltas, and `position_cumulative_hourly` is an hourly
rollup.

`signal` records account/term/curve signal deltas by type.

### Accounts and PnL

Timescale `account` rows track account identity and first/last seen times.
`active_vault_position`, `dirty_account`, `account_stats`, `account_pnl_state`,
and `account_pnl_snapshot` support account analytics, recomputation queues, and
PnL history.

### Leaderboards and protocol stats

`leaderboard_cache` and `leaderboard_cache_version` hold versioned leaderboard
rows so projections can compute a new cache before making it active.

`stats` stores singleton protocol totals. `stats_history` records time-series
snapshots of those totals.

## Cross-database relationships

The bridge is deterministic ids:

- An onchain atom term becomes a KG node whose `kg.nodes.id` matches the
  protocol atom id / hex term id used by Timescale projections.
- An onchain triple term becomes a KG triple whose `kg.triples.id` matches the
  protocol triple id / hex term id used by Timescale projections.
- Timescale projections can replay `event_store` rows, update market read
  models, and ensure the corresponding atom/triple rows exist in Postgres-KG.

There is no built-in cross-database foreign key. Compare ids by running queries
against each database separately, or use a local FDW/export if you need a single
ad-hoc SQL session.

## Drizzle and Timescale caveats

The generated Timescale schema files model the tables used by application code.
Raw SQL migrations also define hypertables, continuous aggregates, compression
policies, SQL views, stored functions, and scheduled jobs that Drizzle cannot
represent directly.

If a Timescale relation is not exported from `packages/database-timescale`, read
the SQL migration before depending on it from TypeScript.
