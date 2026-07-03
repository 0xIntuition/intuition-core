# Example queries

These examples are ready to run against the default local Docker Compose
databases.

```bash
# Knowledge graph
psql postgresql://intuition:intuition@localhost:5432/intuition_kg

# Chain event store and market read models
psql postgresql://intuition:intuition@localhost:5433/intuition
```

Queries marked **indexing profile** need `docker compose --profile indexing up`
or `make smoke-index` data. KG-only queries work after `scripts/bootstrap.sh`
and become more interesting after you create atoms through the API.

## Graph queries

### 1. Public graph counts

```sql
SELECT 'nodes' AS table_name, count(*)::bigint AS rows
FROM kg.nodes
WHERE status = 'active' AND visibility = 'public'
UNION ALL
SELECT 'triples', count(*)::bigint
FROM kg.triples
WHERE status = 'active' AND visibility = 'public'
UNION ALL
SELECT 'predicates', count(*)::bigint FROM kg.predicates
UNION ALL
SELECT 'accounts', count(*)::bigint FROM kg.accounts
ORDER BY table_name;
```

Output shape: `table_name`, `rows`.

Use this as a quick sanity check after bootstrapping, writing atoms, or indexing
chain data.

### 2. Recent public atoms

```sql
SELECT
  created_at,
  id,
  raw_type,
  classification_type,
  parse_status,
  classification_status,
  enrichment_status,
  left(coalesce(nullif(data, ''), data_hex, ''), 120) AS data_preview
FROM kg.nodes
WHERE status = 'active' AND visibility = 'public'
ORDER BY created_at DESC, id DESC
LIMIT 25;
```

Output shape: atom id, raw type, worker statuses, and a short payload preview.

Use this after `POST /api/atoms` to watch workers move an atom from `pending` to
`completed` or `skipped`.

### 3. Classification mix

```sql
SELECT
  classification_type,
  raw_type,
  count(*)::bigint AS nodes,
  min(created_at) AS first_seen_at,
  max(created_at) AS last_seen_at
FROM kg.nodes
WHERE status = 'active' AND visibility = 'public'
GROUP BY classification_type, raw_type
ORDER BY nodes DESC;
```

Output shape: one row per `classification_type` and `raw_type`.

Use this to see what kinds of atoms your node is collecting.

### 4. Recent claim details

```sql
SELECT
  t.created_at,
  t.id,
  t.edge_kind,
  t.confidence,
  t.subject_id,
  left(coalesce(s.data, s.data_hex, ''), 80) AS subject_preview,
  t.predicate_id,
  p.slug AS predicate_slug,
  t.object_id,
  left(coalesce(o.data, o.data_hex, ''), 80) AS object_preview
FROM kg.triples t
LEFT JOIN kg.nodes s ON t.subject_type = 'node' AND t.subject_id = s.id
LEFT JOIN kg.nodes o ON t.object_type = 'node' AND t.object_id = o.id
LEFT JOIN kg.predicates p ON t.predicate_type = 'node' AND t.predicate_id = p.id
WHERE t.status = 'active' AND t.visibility = 'public'
ORDER BY t.created_at DESC, t.id DESC
LIMIT 25;
```

Output shape: triple id, predicate slug, subject/object ids, and previews.

Use this to inspect human-readable claim rows after creating triples.

### 5. Top predicates by live triple count

```sql
SELECT
  t.predicate_type,
  t.predicate_id,
  p.slug,
  p.label,
  count(*)::bigint AS triple_count
FROM kg.triples t
LEFT JOIN kg.predicates p ON t.predicate_type = 'node' AND t.predicate_id = p.id
WHERE t.status = 'active' AND t.visibility = 'public'
GROUP BY t.predicate_type, t.predicate_id, p.slug, p.label
ORDER BY triple_count DESC
LIMIT 25;
```

Output shape: predicate id/slug/label plus live triple count.

Use this to find the relationships most represented in the local graph.

### 6. Highest-degree atoms

```sql
SELECT
  ns.node_id,
  n.classification_type,
  ns.in_degree,
  ns.out_degree,
  ns.neighbor_kind_counts,
  ns.predicate_counts,
  ns.updated_at
FROM kg.node_stats ns
JOIN kg.nodes n ON n.id = ns.node_id
ORDER BY ns.in_degree + ns.out_degree DESC
LIMIT 25;
```

Output shape: atom id, degrees, JSON count maps, and stats update time.

Use this when stats have been populated and you want hubs in the graph.

### 7. Neighborhood around the newest public atom

```sql
WITH seed AS (
  SELECT id
  FROM kg.nodes
  WHERE status = 'active' AND visibility = 'public'
  ORDER BY created_at DESC
  LIMIT 1
)
SELECT
  a.source_id,
  a.direction,
  a.predicate_id,
  p.slug AS predicate_slug,
  a.neighbor_type,
  a.neighbor_id,
  a.weight,
  a.market_weight,
  a.social_weight,
  a.triple_id
FROM kg.adjacency a
JOIN seed s ON a.source_type = 'node' AND a.source_id = s.id
LEFT JOIN kg.predicates p ON a.predicate_type = 'node' AND a.predicate_id = p.id
ORDER BY a.created_at DESC
LIMIT 50;
```

Output shape: adjacency rows for one atom.

Use this when adjacency projections have run and you want fast local traversal
without scanning all triples.

## Pipeline queries

### 8. Parse/classify/enrich status counts

```sql
SELECT stage, status, count(*)::bigint AS nodes
FROM (
  SELECT 'parse' AS stage, parse_status AS status FROM kg.nodes
  UNION ALL
  SELECT 'classification', classification_status FROM kg.nodes
  UNION ALL
  SELECT 'enrichment', enrichment_status FROM kg.nodes
) s
GROUP BY stage, status
ORDER BY stage, status;
```

Output shape: `stage`, `status`, `nodes`.

Use this first when workers appear idle or an atom has not finished processing.

### 9. Oldest pending worker rows

```sql
SELECT stage, id, attempts, created_at, updated_at
FROM (
  SELECT 'parse' AS stage, id, parse_attempts AS attempts, created_at, updated_at
  FROM kg.nodes
  WHERE parse_status = 'pending'
  UNION ALL
  SELECT 'classification', id, classification_attempts, created_at, updated_at
  FROM kg.nodes
  WHERE classification_status = 'pending'
  UNION ALL
  SELECT 'enrichment', id, enrichment_attempts, created_at, updated_at
  FROM kg.nodes
  WHERE enrichment_status = 'pending'
) q
ORDER BY created_at ASC
LIMIT 50;
```

Output shape: pending atom ids by stage.

Use this to find rows waiting longest for a worker lease.

### 10. Active and expired worker leases

```sql
SELECT
  stage,
  id,
  worker_id,
  run_id,
  lease_expires_at,
  lease_expires_at < now() AS expired
FROM (
  SELECT
    'parse' AS stage,
    id,
    processing_meta->>'parseWorkerId' AS worker_id,
    processing_meta->>'parseRunId' AS run_id,
    parse_lease_expires_at AS lease_expires_at
  FROM kg.nodes
  WHERE parse_status = 'processing'
  UNION ALL
  SELECT
    'classification',
    id,
    processing_meta->>'classificationWorkerId',
    processing_meta->>'classificationRunId',
    classification_lease_expires_at
  FROM kg.nodes
  WHERE classification_status = 'processing'
  UNION ALL
  SELECT
    'enrichment',
    id,
    processing_meta->>'enrichmentWorkerId',
    processing_meta->>'enrichmentRunId',
    enrichment_lease_expires_at
  FROM kg.nodes
  WHERE enrichment_status = 'processing'
) q
ORDER BY expired DESC, lease_expires_at ASC
LIMIT 50;
```

Output shape: active lease owner and whether the lease is expired.

Use this to identify stuck `processing` rows that should be picked up after
lease recovery.

### 11. Failure codes by stage

```sql
SELECT
  stage,
  err->>'code' AS error_code,
  (err->>'retriable')::boolean AS retriable,
  count(*)::bigint AS failures
FROM (
  SELECT 'parse' AS stage, parse_error AS err
  FROM kg.nodes
  WHERE parse_error IS NOT NULL
  UNION ALL
  SELECT 'classification', classification_error
  FROM kg.nodes
  WHERE classification_error IS NOT NULL
  UNION ALL
  SELECT 'enrichment', enrichment_error
  FROM kg.nodes
  WHERE enrichment_error IS NOT NULL
) q
GROUP BY stage, error_code, retriable
ORDER BY failures DESC;
```

Output shape: error code, retryability, and count.

Use this to distinguish bad input from transient provider/API failures.

### 12. Retryable failed rows

```sql
SELECT
  stage,
  id,
  attempts,
  updated_at,
  err->>'code' AS code,
  err->>'message' AS message
FROM (
  SELECT 'parse' AS stage, id, parse_status AS status, parse_attempts AS attempts,
    updated_at, parse_error AS err
  FROM kg.nodes
  UNION ALL
  SELECT 'classification', id, classification_status, classification_attempts,
    updated_at, classification_error
  FROM kg.nodes
  UNION ALL
  SELECT 'enrichment', id, enrichment_status, enrichment_attempts,
    updated_at, enrichment_error
  FROM kg.nodes
) q
WHERE status = 'failed' AND (err->>'retriable')::boolean IS TRUE
ORDER BY updated_at ASC
LIMIT 50;
```

Output shape: failed atom ids with retryable error metadata.

Use this before manually deciding whether to retry or inspect provider health.

### 13. Stage duration percentiles

```sql
SELECT
  stage,
  count(*)::bigint AS completed,
  percentile_cont(0.5) WITHIN GROUP (ORDER BY completed_at - started_at) AS p50_duration,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY completed_at - started_at) AS p95_duration
FROM (
  SELECT 'parse' AS stage, parse_started_at AS started_at, parsed_at AS completed_at
  FROM kg.nodes
  UNION ALL
  SELECT 'classification', classification_started_at, classified_at
  FROM kg.nodes
  UNION ALL
  SELECT 'enrichment', enrichment_started_at, enriched_at
  FROM kg.nodes
) q
WHERE started_at IS NOT NULL AND completed_at IS NOT NULL
GROUP BY stage
ORDER BY stage;
```

Output shape: completed count plus p50/p95 durations per stage.

Use this to spot slow parsers, classifiers, or enrichment providers.

## Artifact queries

### 14. Artifact status by kind/version

```sql
SELECT
  artifact_kind,
  artifact_version,
  status,
  count(*)::bigint AS artifacts,
  max(updated_at) AS last_updated_at
FROM kg.artifacts
GROUP BY artifact_kind, artifact_version, status
ORDER BY artifacts DESC;
```

Output shape: artifact kind/version/status counts.

Use this to confirm enrichment providers are producing artifacts.

### 15. Recent artifacts with atom context

```sql
SELECT
  a.updated_at,
  a.id,
  a.node_id,
  n.classification_type,
  a.artifact_kind,
  a.artifact_version,
  a.status,
  left(coalesce(a.source_uri, ''), 120) AS source_uri
FROM kg.artifacts a
JOIN kg.nodes n ON n.id = a.node_id
ORDER BY a.updated_at DESC
LIMIT 25;
```

Output shape: recent artifact rows with the owning atom type.

Use this after creating URL atoms to inspect OpenGraph, favicon, GitHub, or
other provider outputs.

### 16. Failed artifacts

```sql
SELECT
  updated_at,
  id,
  node_id,
  artifact_kind,
  artifact_version,
  error->>'code' AS error_code,
  error->>'message' AS error_message
FROM kg.artifacts
WHERE status = 'failed' OR error IS NOT NULL
ORDER BY updated_at DESC
LIMIT 50;
```

Output shape: failed artifact rows and provider error details.

Use this to debug provider configuration or upstream failures.

### 17. URL/domain coverage from artifacts

```sql
SELECT
  domain,
  count(DISTINCT node_id)::bigint AS nodes,
  count(*)::bigint AS urls,
  count(*) FILTER (WHERE is_primary)::bigint AS primary_urls,
  min(created_at) AS first_seen_at,
  max(created_at) AS last_seen_at
FROM kg.node_urls
GROUP BY domain
ORDER BY nodes DESC
LIMIT 50;
```

Output shape: domain, distinct atom count, URL count, and first/last seen time.

Use this to understand which domains dominate local URL-backed atoms.

## Indexing and market queries

### 18. Canonical event store summary

**Indexing profile.**

```sql
SELECT
  event_type,
  count(*)::bigint AS events,
  min(block_number) AS first_block,
  max(block_number) AS last_block,
  min(block_timestamp) AS first_seen_at,
  max(block_timestamp) AS last_seen_at,
  max(sequence_number) AS max_sequence_number
FROM public.event_store
WHERE is_canonical = true
GROUP BY event_type
ORDER BY max_sequence_number DESC;
```

Output shape: event counts and indexed block range per event type.

Use this after `make smoke-index` or `docker compose --profile indexing up`.

### 19. Projection checkpoint lag

**Indexing profile.**

```sql
WITH maxes AS (
  SELECT
    coalesce(max(sequence_number), 0) AS max_sequence_number,
    coalesce(max(block_number), 0) AS max_block_number
  FROM public.event_store
  WHERE is_canonical = true
)
SELECT
  pc.projection_name,
  pc.sink_name,
  pc.last_sequence_number,
  maxes.max_sequence_number,
  maxes.max_sequence_number - pc.last_sequence_number AS sequence_lag,
  pc.last_block_number,
  maxes.max_block_number - pc.last_block_number AS block_lag,
  pc.last_updated_at
FROM public.projection_checkpoints pc
CROSS JOIN maxes
ORDER BY sequence_lag DESC, block_lag DESC;
```

Output shape: projection checkpoint, sequence lag, block lag, update time.

Use this to see whether projections caught up to the indexed event store.

### 20. Atom/triple creation by hour

**Indexing profile.**

```sql
SELECT hour, event_type, count(*)::bigint AS events
FROM (
  SELECT date_trunc('hour', block_timestamp) AS hour, 'AtomCreated' AS event_type
  FROM public.atom_created_events
  UNION ALL
  SELECT date_trunc('hour', block_timestamp), 'TripleCreated'
  FROM public.triple_created_events
) q
GROUP BY hour, event_type
ORDER BY hour DESC, event_type;
```

Output shape: hourly onchain atom/triple creation counts.

Use this to inspect protocol activity in the indexed window.

### 21. Top terms by market cap

**Indexing profile.**

```sql
SELECT
  ts.term_id,
  t.term_type,
  t.creator,
  left(coalesce(t.atom_data, t.atom_data_hex, ''), 100) AS term_preview,
  ts.total_assets,
  ts.total_market_cap,
  ts.total_holder_count,
  ts.updated_at
FROM public.term_summary ts
LEFT JOIN public.term t ON t.term_id = ts.term_id
ORDER BY ts.total_market_cap DESC
LIMIT 25;
```

Output shape: term id, type, preview, market cap, holders, update time.

Use this to find the most valuable local terms after market projections run.

### 22. Top vaults

**Indexing profile.**

```sql
SELECT
  term_id,
  curve_id,
  total_shares,
  current_share_price,
  total_assets,
  total_deposits,
  total_redemptions,
  market_cap,
  holder_count,
  updated_at
FROM public.vault
ORDER BY market_cap DESC
LIMIT 25;
```

Output shape: vault balances, price, market cap, holder count.

Use this to inspect current vault state by term and curve.

### 23. Seven-day net flows by term

**Indexing profile.**

```sql
WITH d AS (
  SELECT term_id, sum(assets_after_fees) AS deposit_assets
  FROM public.deposit_fact
  WHERE ts >= now() - interval '7 days'
  GROUP BY term_id
),
r AS (
  SELECT term_id, sum(assets) AS redemption_assets
  FROM public.redemption_fact
  WHERE ts >= now() - interval '7 days'
  GROUP BY term_id
)
SELECT
  coalesce(d.term_id, r.term_id) AS term_id,
  coalesce(d.deposit_assets, 0::numeric) AS deposit_assets,
  coalesce(r.redemption_assets, 0::numeric) AS redemption_assets,
  coalesce(d.deposit_assets, 0::numeric) - coalesce(r.redemption_assets, 0::numeric) AS net_assets
FROM d
FULL JOIN r USING (term_id)
ORDER BY net_assets DESC
LIMIT 25;
```

Output shape: term id, deposit assets, redemption assets, net assets.

Use this for market flow analysis over recent indexed data.

### 24. Active leaderboard cache

**Indexing profile.**

```sql
SELECT
  lc.period,
  lc.sort_key,
  lc.rank,
  lc.account_id,
  lc.account_label,
  lc.total_pnl_formatted,
  lc.pnl_pct,
  lc.total_volume_formatted,
  lc.current_equity_value_formatted,
  lc.computed_at
FROM public.leaderboard_cache lc
JOIN public.leaderboard_cache_version lcv
  ON lcv.period = lc.period
  AND lcv.sort_key = lc.sort_key
  AND lcv.active_version = lc.cache_version
ORDER BY lc.period, lc.sort_key, lc.rank
LIMIT 100;
```

Output shape: active leaderboard rows by period and sort key.

Use this when leaderboard projections and cache versioning are enabled.

## Cross-database checks

There is no built-in cross-database foreign key. Run these in separate `psql`
sessions and compare ids, or wire your own FDW/export for ad-hoc joins.

### 25. Timescale atom terms to compare with KG nodes

**Indexing profile. Run against TimescaleDB.**

```sql
SELECT
  term_id,
  term_type,
  left(coalesce(atom_data, atom_data_hex, ''), 120) AS atom_preview,
  block_number,
  block_timestamp
FROM public.term
WHERE term_type = 'atom'
ORDER BY block_timestamp DESC
LIMIT 25;
```

Output shape: Timescale atom term ids and previews.

Compare `term_id` values with `kg.nodes.id`.

### 26. KG nodes to compare with indexed atom terms

Run against Postgres-KG.

```sql
SELECT
  id,
  is_onchain,
  raw_type,
  classification_type,
  left(coalesce(data, data_hex, ''), 120) AS data_preview,
  created_at
FROM kg.nodes
WHERE is_onchain = true
ORDER BY created_at DESC
LIMIT 25;
```

Output shape: onchain KG atom ids and previews.

Use this with query 25 to verify indexed atom terms were projected into the KG.

### 27. Timescale triple terms to compare with KG triples

**Indexing profile. Run against TimescaleDB.**

```sql
SELECT
  term_id,
  subject_id,
  predicate_id,
  object_id,
  block_number,
  block_timestamp
FROM public.term
WHERE term_type = 'triple'
ORDER BY block_timestamp DESC
LIMIT 25;
```

Output shape: Timescale triple term ids and component ids.

Compare `term_id` with `kg.triples.id`, and compare component ids with KG
subject/predicate/object columns.

### 28. KG triples created from indexed terms

Run against Postgres-KG.

```sql
SELECT
  id,
  is_onchain,
  subject_id,
  predicate_id,
  object_id,
  created_at
FROM kg.triples
WHERE is_onchain = true
ORDER BY created_at DESC
LIMIT 25;
```

Output shape: onchain KG triple ids and component ids.

Use this with query 27 to verify triple projection into the KG.

## Admin queries

### 29. API key audit

```sql
SELECT
  id,
  name,
  account_id,
  can_write,
  rate_limit_rpm,
  created_at,
  revoked_at,
  last_used_at
FROM kg.api_keys
ORDER BY created_at DESC
LIMIT 50;
```

Output shape: key metadata only. The plaintext `ik_...` key is not stored.

Use this to review local operator-managed API keys.

### 30. Recently active write accounts

```sql
SELECT
  a.id AS account_id,
  a.created_at,
  a.last_seen_at,
  count(DISTINCT n.id)::bigint AS created_nodes,
  count(DISTINCT t.id)::bigint AS created_triples
FROM kg.accounts a
LEFT JOIN kg.nodes n ON n.created_by = a.id
LEFT JOIN kg.triples t ON t.created_by = a.id
GROUP BY a.id, a.created_at, a.last_seen_at
ORDER BY greatest(
  coalesce(max(n.created_at), a.created_at),
  coalesce(max(t.created_at), a.created_at)
) DESC
LIMIT 25;
```

Output shape: account id, account timestamps, created node/triple counts.

Use this to see which local accounts have written graph data.

### 31. Predicate registry

```sql
SELECT
  slug,
  label,
  inverse_predicate_id,
  is_transitive,
  is_symmetric,
  is_hierarchical,
  is_social,
  is_market,
  updated_at
FROM kg.predicates
ORDER BY slug;
```

Output shape: seeded predicate registry and semantic flags.

Use this when choosing a predicate id for `POST /api/triples`.
