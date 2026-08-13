# Track 1 — Chain Ingestion (Rust): ABI + `AtomContextRegistered`

**Owner:** 1 engineer (Rust, comfortable with rindexer codegen)
**Repo:** `intuition-core`
**Mission:** the indexer decodes the new `AtomContextRegistered` event and lands URIs in Timescale, with the updated MultiVault ABI flowing through the whole provenance chain. `AtomCreated` handling is untouched (the event did not change — only its payload *content* shifts to `int:` strings, which is opaque bytes at this layer).

## 1. Contract facts you're building against

- New event (the only URI carrier; not stored on-chain):
  `AtomContextRegistered(bytes32 indexed termId, address indexed registrant, bytes[] uris)`
  topic0 `0x006dfca493b1686f1cc639fa9675dbd6f4a694a9d3230c346f3879d925382097`
- Emitted at most once per atom, only from `createAtomsWithUris`, only when the atom's URI list is non-empty, same tx **after** that batch's `AtomCreated`/`Deposited` events. `registrant` == `AtomCreated.creator`.
- Limits: ≤5 URIs/atom, ≤700 bytes each (defaults; `AtomUriConfigUpdated(uint32,uint32)` exists but doesn't need indexing for the sprint).
- URIs are write-once — no update event will ever arrive for an existing atom.
- Nothing else changed: `AtomCreated`, `TripleCreated`, `Deposited`, `Redeemed` are byte-identical; atom ID formula unchanged.

## 2. Work items (in order)

### 2.1 ABI provenance chain

The ABI flows: `@0xintuition/contracts-v2` npm →  `packages/contracts/src/abis.ts` (`MultiVaultAbi`) → `scripts/sync-abis.ts` → `crates/rindexer-ingestion/abi/MultiVault.json` (CI-gated by `abis:check`).

1. Bump the `@0xintuition/contracts-v2` pin in `packages/contracts/package.json` to the version containing commit `a402fad` (upstream regenerated `abis/MultiVault.ts` in that commit). *Fallback if unpublished:* hand-patch `crates/rindexer-ingestion/abi/MultiVault.json` with the `AtomContextRegistered` event + `createAtomsWithUris` function and leave a TODO to re-sync.
2. `bun run abis:sync`, verify `abis:check` passes.
3. Confirm `AtomContextRegistered` is present in `crates/rindexer-ingestion/abi/MultiVault.json`.

### 2.2 rindexer typings + handler

- Regenerate rindexer bindings → `crates/rindexer-ingestion/src/rindexer_lib/typings/be_v_3_indexer/events/multi_vault_abi_gen.rs` and `.../events/multi_vault.rs` gain `AtomContextRegistered{Data,Result,Event}` alongside the existing `AtomCreated*` types (enum around line 1006).
- `crates/rindexer-ingestion/src/handlers.rs` — add `register_atom_context_registered_handler` next to `register_atom_created_handler` (line 154). Payload: `{ term_id, registrant, uris }` with each URI hex-encoded the same way `atomData` is (line 182) — URIs are `bytes`, not guaranteed UTF-8; decode to string at projection time.
- Register the handler wherever the existing handlers are wired (same module).
- `crates/rindexer-ingestion/rindexer.yaml` — confirm/update contract address + start block env vars for the redeployed contract.

### 2.3 Storage (Timescale)

- New migration in `migrations/timescale/` (append after 039): `atom_context_registered_events` table mirroring `atom_created_events` (`migrations/timescale/002_create_typed_event_tables.sql:10`) — `term_id NUMERIC`, `registrant TEXT`, `uris TEXT[]` (hex-encoded entries), plus the standard block/tx/log metadata columns of the other typed tables.
  - *Why a new table, not a column on `atom_created_events`:* it's a distinct event with its own log index; joining by `term_id` at projection time is trivial and keeps ingestion append-only.
- `crates/rindexer-ingestion/src/storage.rs` — add `insert_atom_context_registered_events` modeled on `insert_atom_created_events` (line 301): write both to `event_store` (JSON payload) and the typed table (like line 341).

### 2.4 Shared event model (`crates/shared`)

- `crates/shared/src/models.rs:139` — new `AtomContextRegisteredRecord { term_id, registrant, uris: Vec<String>, … }` next to `AtomCreatedRecord`. Leave `AtomCreatedRecord` alone.
- `crates/shared/src/parsed_event.rs:111` — new `ParsedEvent::AtomContextRegistered` variant + reserialization arm (line 361) + fixtures. Existing fixtures with `"atom_data": "ipfs://QmFoo"` stay valid; add sibling fixtures with `atom_data` = hex of `int:isrc:USSM10007459` and a matching context event.
- `crates/shared/src/types.rs:33` — `EventType::AtomContextRegistered`.
- `crates/shared/src/test_utils.rs:150` + `crates/shared/src/proptest_invariants.rs:197` — fixture + proptest strategy for the new event.

## 3. Interfaces to agree at standup

- **Typed table shape** (`atom_context_registered_events` columns) — Track 2 reads it in `typed_reader.rs`.
- **Hex vs UTF-8 for stored URIs** — recommendation: store hex in Timescale (faithful to bytes), decode in projections (Track 2), same division of labor as `atom_data`/`decode_atom_data_hex`.

## 4. Definition of done

- [ ] `abis:check` green; `AtomContextRegistered` in the synced ABI JSON.
- [ ] Rust workspace compiles; shared-crate tests + proptests pass with new fixtures.
- [ ] Timescale migration applies cleanly on a fresh datastore (`docker-compose` migrate services).
- [ ] On devnet: a `createAtomsWithUris` tx (coordinate with Track 6, who is updating the acceptance script) produces rows in both `atom_created_events` and `atom_context_registered_events` with matching `term_id`.
- [ ] An atom created via plain `createAtoms` (no URIs) still indexes exactly as before — no regression.

## 5. Explicitly out of scope

- Interpreting URI contents (IID vs URL) — Track 2/3.
- `AtomUriConfigUpdated` indexing, FeeProxy `createAtomsWithUrisVia` call-level indexing (log-level capture already covers the URIs).
- Historical log backfill tooling (only needed if real `createAtomsWithUris` traffic predates handler deploy — flag to lead if so).
