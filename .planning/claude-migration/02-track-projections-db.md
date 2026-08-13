# Track 2 — Projections & Database Schema

**Owner:** 1 engineer (Rust + Drizzle/SQL)
**Repo:** `intuition-core`
**Mission:** projections materialize identifier atoms and on-chain URIs into `term`, `kg.nodes`, and `kg.node_urls`; the kg schema gains identifier columns and the extended `raw_type`; all Drizzle/Timescale schema mirrors and manifests are regenerated.

**Depends on:** Track 1's `atom_context_registered_events` table shape (agree at standup — don't block, the shape is one table). Coordinate `raw_type` value and identifier column names with Track 3.

## 1. KG Postgres schema (`packages/database-kg`)

- `src/schemas/kg/nodes.ts:16` —
  - Extend the `raw_type` CHECK (line 89: `IN ('string','json','http_uri','ipfs_uri')`) with `'intuition_identifier'` (per decision D-2).
  - Add nullable columns `identifier_scheme TEXT` and `identifier_value TEXT` (promoted by the parse worker; also directly settable by projections for bare `int:` payloads). Index on `(identifier_scheme, identifier_value)` — this is the future `iid → [atomId]` equivalence key (spec D7), so make it a plain (non-unique) btree index now.
- `src/schemas/kg/node_urls.ts` — add `'onchain'` to the `source` enum/values. On-chain URIs land here (one row per URI, `is_primary=false`).
- New Drizzle migration (after `drizzle/0000_kg_core_init.sql` + 2 successors) via `src/migrate.ts` — remember the `raw_type` CHECK lives in generated SQL too.
- `src/actions/nodes.ts` / `src/actions/processing.ts` — `completeNodeProcessingStage` promoted-fields path must accept `identifierScheme`/`identifierValue` (Track 3's parse worker writes them).
- Predicate seeds (`src/seeds/predicates.ts`): no change required for the sprint (equivalence predicates like `sameAs`/`differentFrom` are the follow-up project — park unless trivially cheap).

## 2. Timescale schema (`packages/database-timescale` + `migrations/timescale`)

- Track 1 owns the new `atom_context_registered_events` migration; you own its Drizzle mirror: add the table to `src/schemas/timescale/`, regenerate `schemas/timescale/manifest.json` + `compat-inventory.json` (generation code `src/timescale-generation/`), fix `packages/database-timescale/tests/`.
- `term` table (`migrations/timescale/006_create_term_table.sql`, mirror `src/schemas/timescale/terms.ts:20-23`): **recommendation — no new columns.** `term` keeps `atom_data`/`atom_data_hex` as-is (the identifier *is* the atom data); URIs live in kg (`node_urls`) and the typed event table. Only add term columns if the API/explorer team (Track 6) makes a case at standup.

## 3. Projections (`crates/projections`)

- `src/event/typed_reader.rs:41-48` — extend the union SQL to also read `atom_context_registered_events` (new event kind flowing to the projection loop).
- `src/projection/dual/core_entities.rs` — the central atom materializer:
  - On `AtomCreated` (existing path, `build_atom_ops_typed` line 181): after `decode_atom_data_hex` (line 111), detect the `int:` prefix on the decoded UTF-8 string. If it validates shape-wise (cheap check: `^int:[a-z0-9-]{1,32}:.{1,220}$` — full canonical validation stays in TS workers), set `raw_type='intuition_identifier'` and populate `identifier_scheme`/`identifier_value` on the `kg.nodes` insert (lines 360–410) instead of the default `'string'`. Doc comment at line 34 (raw_type refinement contract with the parse worker) needs updating.
  - New handler for `AtomContextRegistered`: decode each hex URI to UTF-8 (lossy-tolerant; skip+log undecodable entries) and insert into `kg.node_urls` (`node_id=termId`, `source='onchain'`) — idempotent on conflict (event replay). Also record in `kg.events` (line 439 pattern) if other event kinds do.
  - Ordering note: the context event arrives after `AtomCreated` in the same tx, so the node row exists by the time you project it within a block batch — but make the insert order-independent anyway (upsert semantics), since batch boundaries aren't guaranteed.
- `src/projection/surreal/atom.rs` — mirror the raw_type/identifier handling in the Surreal projection (same decode path, lines 30–130).

## 4. Interfaces to agree at standup

- `raw_type` value string (D-2: `'intuition_identifier'`) — shared with Track 3 (parser, worker, API `detectRawType`) and Track 6 (API serialization, explorer).
- Identifier column names (`identifier_scheme`/`identifier_value`) — Track 3 writes them from the parse stage; Track 6 serializes them.
- Division of validation: projections do **shape** detection only; canonical validation/quarantine is the parse worker (Track 3). Rationale: don't port 25 canonicalizers to Rust for the sprint.
- What happens to a `uris` entry that is itself an IID (D-1): sprint answer — it still lands in `node_urls` as an opaque string with `source='onchain'`; Track 3+ may later promote secondary identifiers. Keep projections dumb.

## 5. Definition of done

- [ ] Fresh-stack migration run green (Timescale + kg Drizzle), plus migration on a datastore with existing rows.
- [ ] Devnet atom with data `int:isrc:USSM10007459` + 2 URIs ⇒ `kg.nodes` row with `raw_type='intuition_identifier'`, scheme/value populated, 2 `kg.node_urls` rows with `source='onchain'`; `term` row unchanged in shape.
- [ ] Legacy JSON-LD and `ipfs://` atoms project exactly as before (regression: rerun `scripts/smoke-index.sh` block window).
- [ ] Event replay (re-run projections over the same range) is idempotent — no duplicate node_urls.
- [ ] Manifest/compat-inventory regenerated; `database-timescale` and `database-kg` tests pass.

## 6. Out of scope

- The `iid → [atomId]` unique-index clustering/equivalence layer (follow-up project; you're only laying the index).
- Rust-side canonical IID validation (TS workers own it).
- Backfilling `identifier_*` for legacy atoms (Q5 backfill project).
