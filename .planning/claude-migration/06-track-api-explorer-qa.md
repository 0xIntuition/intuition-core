# Track 6 — API Surface, Explorer, Devnet & End-to-End QA

**Owner:** 1 engineer (full-stack; ideally the lead — this track integrates everyone else's work and owns the final green checklist)
**Repo:** `intuition-core`
**Mission:** identifier atoms are visible and correct through the API and explorer; devnet/acceptance/smoke tooling exercises the new `createAtomsWithUris` path end-to-end; docs reflect the new model.

## 1. API (`services/api`)

- Serialization: atom responses expose `identifierScheme`, `identifierValue`, and on-chain URIs (join `kg.node_urls where source='onchain'`, or via the existing node serialization if node_urls are already included). Routes: `GET /api/atoms`, `/api/atoms/:id`, `/api/atoms/:id/artifacts`.
- `GET /api/schema` introspects live kg schema (`src/schema.ts`) — auto-reflects Track 2's new columns; verify, don't assume.
- `detectRawType` update itself is Track 3 (must match parser semantics); you own the `POST /api/atoms` offchain-create flow around it (app.ts:237/259) accepting a bare `int:` string.
- Filtering: add `identifier_scheme` as a query filter on `/api/atoms` if cheap (nice-to-have, enables "all ISRC atoms" queries in QA).
- Docs: `docs/openapi.yaml`, `docs/api-reference.md`, `docs/example-queries.md`. Tests: `services/api/tests/{schema,pipeline-stats}.test.ts` + new serialization cases.

## 2. Explorer (`apps/explorer`)

- `src/routes/{atoms.index,atoms.$atomId,triples.$tripleId,index}.tsx`, `src/components/term-chip.tsx`, `src/lib/api.ts`:
  - Render `intuition_identifier` raw_type: scheme badge (e.g. `isrc`) + canonical IID, monospace.
  - Unenriched P0 anchor (decision D-5): show IID + "resolving…" state; post-enrichment, show the promoted display name from `data_resolved`.
  - Atom detail: list on-chain URIs (linkified when they parse as URLs).
- Keep it modest — this is operator tooling, not product UI.

## 3. Devnet & deploy acceptance (`packages/contracts`)

- `src/deploy/acceptance.ts:50` — extend beyond the current `createAtoms([toHex('devnet-atom-…')])`:
  1. keep the legacy plain-string atom (regression),
  2. add `createAtomsWithUris` with atom data `toHex('int:isrc:USSM10007459')` (use a real ISRC so enrichment QA can reuse it) and 2 URIs (e.g. a Spotify track URL + a Wikipedia URL),
  3. assert both `AtomCreated` and `AtomContextRegistered` logs via `parseEventLogs` (additive ABI — existing assertions won't break, but pin the new event explicitly).
- `src/multivault.ts` helper + `__tests__/multivault.test.ts`: add a `createAtomsWithUris` wrapper (Track 5's future mint tooling and QA scripts both want it).
- CLI (`src/deploy/cli.ts:156`) — flag or default to include the identifier atom.
- Confirm devnet contract build/address includes commit `a402fad` (`devnet/deployments-devnet.json`, `docker/Dockerfile.devnet`, compose `devnet-deploy`); if the devnet image pins an older contracts build, updating it is a **day-1 blocker to escalate immediately**.

## 4. Smoke & scripts

- `scripts/smoke-index.sh` — currently replays public-testnet blocks 9030416–9030916 (50 legacy atoms) and asserts counts via the API. Keep as the **legacy regression**. Add a devnet-based smoke (or extend `scripts/smoke-test.sh`) asserting the new path: create identifier atom with URIs → poll API until `parse=completed`, `classification_type=MusicRecording`, `enrichment_status=completed` (or `skipped` if the environment lacks Spotify creds — assert either, gated on env), URIs present.
- `scripts/scope-dry-run.ts` — verify scheme→domain scoping (Track 3's D-9 mapping) picks up identifier atoms in `music`/`podcast` scopes.
- `scripts/explore-data.sh` — spot-check output includes identifier columns.

## 5. The final integration checklist (day 2 afternoon — the sprint's exit criteria)

Run on a fresh local stack (`docker-compose` full pipeline, Spotify creds set):

- [ ] `devnet-deploy` acceptance green, incl. `createAtomsWithUris` + both events asserted.
- [ ] Timescale: rows in `atom_created_events` + `atom_context_registered_events` (Track 1).
- [ ] kg: node `raw_type='intuition_identifier'`, scheme/value populated, 2 `node_urls` rows `source='onchain'` (Track 2).
- [ ] Parse worker: `parse_status=completed`, `canonicalId` = the IID, search_text fallback set (Track 3).
- [ ] Classification: `classification_type='MusicRecording'`, status `recognized`, no network call in logs (Track 3).
- [ ] Enrichment: Spotify/MusicBrainz artifacts for the real ISRC; display name promoted to search_text/data_resolved (Track 4).
- [ ] API: atom serialized with scheme/value/URIs; OpenAPI updated; `POST /api/atoms` accepts a bare IID (Track 6).
- [ ] Explorer: renders scheme badge, then enriched name after pipeline completes (Track 6).
- [ ] Regressions: `smoke-index.sh` legacy window still green; a JSON-LD atom and an `ipfs://` atom created on devnet still flow the old path unchanged.
- [ ] Seed proof (Track 5, in intuition-v2 against this stack): one music-lane batch written; seeded nodes indistinguishable in shape from the devnet-minted identifier atom.
- [ ] Invalid-IID case: `int:bogus:xyz` atom lands quarantined (`parse failed`, no classification), doesn't wedge any worker.

## 6. Docs sweep (parallelizable filler between integration runs)

`docs/architecture.md`, `docs/data-model.md`, `docs/classification-taxonomy.md`, `docs/enrichment-providers.md`, `docs/contracts.md` (new event + function), `docs/indexing-scope.md`, `docs/local-devnet.md` (new acceptance atom), crate READMEs touched by Tracks 1–2, `docs/writing-a-classification-plugin.md` / `writing-an-enrichment-plugin.md` (identifier input shape, with Tracks 3–4).

## 7. Out of scope

- Product frontend work outside `apps/explorer`.
- `atom-rules-engine` identifier rules (external consumers — ticket for app teams).
- Performance/load validation of enrichment API quotas at seed scale (Track 5 rate configs cover the sprint).
