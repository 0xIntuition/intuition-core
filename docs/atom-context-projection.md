# Atom Context Projection Runbook

`atom_context:dual` projects the protocol's `AtomContextRegistered` events into
the KG database without changing an atom's identity or payload. It is an
append-only evidence projection: it stores every URI byte value in contract
order and appends an associated `kg.events` row.

The projection does not fetch a URI, normalize its text, infer a scheme, or
assign trust. Consumers must treat `uri_hex` as canonical. `uri_text` is a
nullable convenience rendering populated only when the bytes are valid UTF-8
and contain no NUL byte.

## Data and checkpoint contract

- `kg.node_contexts` has one row per URI. Its primary key is
  `(node_id, transaction_hash, log_index, ordinal)`, so duplicates at different
  ordinals and original order are preserved.
- `kg.events` receives one `atom_context_registered` row per contract event.
- `kg.nodes.data`, `kg.nodes.data_hex`, and the atom ID are never updated.
- Node lookup is exact: event `term_id = kg.nodes.id`.
- If the node does not exist yet, the KG transaction fails with a retryable
  dependency error. The batch rolls back and its checkpoint does not advance.
- The generic PostgreSQL worker stores the independent cursor as
  `projection_name = 'atom_context:dual'`, `sink_name = 'pg'`. An absent row
  reads as sequence `0`, which makes first enablement a complete backfill.
- URI rows and evidence use `ON CONFLICT DO NOTHING`, making replay after a
  checkpoint-write failure idempotent.

## Deployment order

1. Deploy KG migrations through `0004_add-node-contexts.sql`. Migration `0003`
   must run first because it adds IID support to `kg.nodes`.
2. Deploy the Timescale/rindexer migration that creates and fills
   `atom_context_registered_events`.
3. Deploy a projections image containing the typed
   `AtomContextRegistered` reader and this projection.
4. Confirm `DATABASE_KG_URL` is set. Without it, the service intentionally does
   not spawn `atom_context:dual`; it never runs a no-op that could discard data.
5. Add `atom_context:dual` to `ENABLED_PROJECTIONS` when an allowlist is in use.
   Keep `core_entities` enabled until all referenced atom nodes are present.
6. Observe the backfill from sequence zero, then run the verification queries
   below before promoting the image.

Example:

```dotenv
DATABASE_KG_URL=postgresql://...
USE_TYPED_READER=true
ENABLED_PROJECTIONS=core_entities,atom_context:dual
```

## Verification

Run the checkpoint query against the event-store/Timescale database:

```sql
SELECT projection_name, sink_name, last_sequence_number, last_block_number,
       last_updated_at
FROM projection_checkpoints
WHERE projection_name = 'atom_context:dual' AND sink_name = 'pg';
```

Run the remaining queries against the KG database:

```sql
-- URI rows retain their per-event order.
SELECT node_id, transaction_hash, log_index, ordinal, uri_hex, uri_text
FROM kg.node_contexts
ORDER BY event_sequence, ordinal
LIMIT 100;

-- Every stored context remains attached to an existing canonical node.
SELECT count(*) AS orphan_contexts
FROM kg.node_contexts c
LEFT JOIN kg.nodes n ON n.id = c.node_id
WHERE n.id IS NULL;

-- Evidence exists without atom-payload mutation.
SELECT event_time, id, actor_id, entity_id, event_type, payload
FROM kg.events
WHERE event_type = 'atom_context_registered'
ORDER BY event_time DESC
LIMIT 100;

-- Duplicated URI bytes at distinct ordinals are retained intentionally.
SELECT node_id, transaction_hash, log_index, uri_hex, count(*)
FROM kg.node_contexts
GROUP BY node_id, transaction_hash, log_index, uri_hex
HAVING count(*) > 1;
```

Expected results: `orphan_contexts = 0`; checkpoint sequence increases during
backfill; URI ordinals are zero-based and contiguous per event; evidence
`entity_id` exactly matches the associated `node_id`.

## Failure and rollback

- Repeated `RowNotFound` errors mean context registration has caught up to an
  atom that `core_entities` has not written. Check the `core_entities`
  checkpoint and KG-node row. Do not bypass the join or manually insert context.
- Malformed/non-hex URI input pins the checkpoint to avoid silent byte loss.
  Repair the upstream typed event only from authoritative chain data.
- To halt context projection, remove `atom_context:dual` from the allowlist (or
  add it to `DISABLED_PROJECTIONS`) and restart projections. Existing rows are
  append-only and need no rollback.
- Re-enabling resumes from the independent checkpoint. A controlled replay from
  zero is safe because both tables use deterministic keys and conflict-ignore
  inserts; changing or deleting a production checkpoint still requires normal
  database-change approval.
