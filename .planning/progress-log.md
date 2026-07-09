# Intuition Core — Build Progress Log

Reverse-chronological. Companion to `intuition-core-open-source-spec.md`.

---

## 2026-07-09 (later) — Testnet instance deployed + chain-agnostic deployer

**A fresh, self-owned Intuition protocol instance is LIVE on Intuition Sepolia (13579)**, deployed
entirely from the npm package via the generalized viem deployer (`bun run testnet:deploy`):
MultiVault proxy `0x8e90C0acb6D1d673Ee77d569E1f4f3BDd8A45662` (deploy block 9359242), full system
(23 contracts + wiring, canonical WTRUST `0xDE80…0fe35` reused), createAtoms acceptance PASSED
onchain (block 9359248). Total cost ≈ 0.105 tTRUST. Full address set:
`devnet/deployments-testnet.json` (untracked — commit if this instance should be shared).

### What it took (two real-network lessons now encoded in the deployer)
1. **Intuition Sepolia enforces EIP-170** (verified: canonical MultiVault impl there is 23,926 B)
   — the npm package's production optimizer_runs=10000 bytecode (27,666–30,926 B runtimes) is
   rejected at eth_estimateGas. Fix: vendored **size-fit build** (`MultiVaultSizeFit.json`,
   optimizer_runs=200, runtime 24,033 B, verified onchain) compiled from the package's own src
   (regen-vendored.sh stage 2: OZ 5.4.0 + solady 0.1.26). MigrationMode doesn't fit even at 200
   runs → EIP-170 targets deploy plain MultiVault as the impl (the old forge devnet's exact
   approach). Local anvil keeps byte-identical production bytecode (`eip170: false`).
2. **CoreEmissionsController reverts when startTimestamp < block.timestamp at init** — the anvil
   +100s epoch offset gets consumed by real-network receipt waits (run 2 failed exactly there).
   Testnet profile uses +3600s.

### Deployer generalization (packages/contracts)
- `deploy/config.ts`: `DeployConfig` + `DeployTarget` profiles (`anvil`, `intuition-sepolia` w/
  canonical SetupScript NETWORK_INTUITION_SEPOLIA parameters — 2wk epochs, 75M/26 emissions);
  `system.ts`/`acceptance.ts` chain-agnostic via `targetChain()`; CLI has per-target preflight
  (chain-id, balance w/ faucet hint, PRIVATE_KEY required off-anvil), reuses canonical WTRUST
  (`TRUST_TOKEN=fresh` overrides), prints the indexer `.env` block. Anvil path re-verified.

### Also this session
- README: hero dashboard screenshot + "Run everything — chain → indexer → API → explorer" section
  (full-loop recipe, port/CORS notes, explorer intro, testnet-deploy pointer) with three explorer
  screenshots committed under docs/assets/. CORS fix: user's .env allowlist lacked :3100 — container
  recreated with shell-env override (durable fix = user adds :3100 to API_ALLOWED_ORIGINS in .env).
- Session shut down cleanly: compose stack + explorer dev server stopped (volumes kept — devnet
  chain state and DBs persist), Docker Desktop off.
- Explorer dashboard fix: user's browser hit a stale dev process defaulting VITE_API_URL to :3000
  (alpha-beta's vite server on this machine) → skeletons/empty. Killed strays; explorer runs on
  :3100 with VITE_API_URL=http://localhost:3200 (compose api on API_HOST_PORT=3200 because :3000
  is occupied). Worker health ports 4110-4112 now published in docker-compose → all 7 services
  green in the health grid.
- Deployer key for the testnet instance was provided in-session (admin/deployer
  `0x54C15B56800235F273bb659aea820c9D3112B3FD`) — treat as dev-grade; it is also this instance's
  admin + MIGRATOR, so keep it or plan an admin rotation.

## 2026-07-09 — apps/explorer: dashboard data explorer + API read-model extensions

`apps/explorer` (@0xintuition/explorer): TanStack Start app on :3100 — the operational dashboard
and the **reference consumer of the public API** (self-contained: no private workspace packages,
per the auth-free boundary; the experimental app's portable patterns were re-implemented clean).

### Shipped
- **API read-model extensions** (services/api): `GET /api/atoms/:id/artifacts`, `GET /api/events`
  (entity_kind/event_type/entity_id filters), `GET /api/stats/pipeline` (per-stage status counts,
  extracted `aggregatePipelineStats` + tests), `?expand=terms` on all triple reads (3 aliased node
  joins → `{id,data,classificationType,rawType}` per S/P/O), `stats` (node_stats) embedded in atom
  detail. docs/api-reference.md + openapi.yaml updated (12 paths, validated).
- **Explorer app**: dashboard (stat cards, pipeline bars, live service-health grid via a Start
  server route `/api/status` probing health ports server-side — no CORS), atoms table
  (search/classification filters in URL state) + rich atom detail (raw/resolved data, artifact
  gallery w/ image extraction, position-highlighted triples, graph degree, per-atom events),
  triples as linked S→P→O chips + detail, predicates, events feed, live schema viewer, and a
  **write playground** (create atom/triple, localStorage API key, live curl-equivalent panel).
- **Foundations**: typed zod-validated REST client (`src/lib/api.ts`, doubles as API usage docs),
  dark-first Tailwind v4 token system, workspace integration (`apps/*` added to workspaces,
  package-level turbo.json for `.output/**`, biome ignores for routeTree.gen.ts + tailwind css),
  process-compose `explorer` process in the standard profile.
- Versions exact-pinned to the alpha-proven matrix (react-start 1.167.16, router 1.168.10,
  vite 7.3.2, react 19.1.0, query 5.96.2, table 8.21.3); Tailwind v4 via @tailwindcss/vite.
  NOTE: port 3100 (3001 collides with the alpha API dev server on this machine).

### Verified (live, against the docker devnet stack on API_HOST_PORT=3200)
- All 7 routes SSR 200; production build (nitro) clean; typecheck 14/14, biome 521 files, tests
  16/16 tasks, ABI gate, supply-chain guard.
- **Every client endpoint exercised through the app's own zod-validated client**: stats, pipeline
  (60 atoms · 2 enriched), q-search finds the SoftwareSourceCode atom, artifacts (favicon:active),
  expanded triples resolve S/O labels (null predicate term exercised the fallback-chip path by
  design), events feed, 13 schema tables.
- **Write path**: minted key → createAtom created:true → idempotent re-post created:false →
  readback pending in pipeline. 401 without key surfaces cleanly (playground shows it).
- /api/status grid live: api/atom-services/indexer/projections ok; docker workers show
  unreachable from host (health ports not published — accurate; defaults target native dev).
- Machine quirks: host ports 3000+3001 are held by alpha-beta dev servers → explorer on **3100**,
  compose api override `API_HOST_PORT=3200` for this session. `bun --filter` is broken on
  bun 1.3.11 (repo pins 1.3.3) → `make keys` fails; ran services/api keys:create directly.
  Start 1.167 uses default client/server entries + conventional `tanstackStart()` (the
  experimental app's custom ssr.tsx/client.tsx shapes are for an older API — do not copy).

## 2026-07-08 — Contracts as an npm dependency: `@0xintuition/contracts-v2` end-to-end

The clone+forge devnet is gone. The protocol now enters the repo exactly once, as the
pinned npm package `@0xintuition/contracts-v2@1.0.0-alpha.0` (built from upstream `94bddae`
= main; `gitHead` + source-hash verified).

### Shipped
- **`packages/contracts`** (`@0xintuition/contracts`): re-exported viem-typed ABIs, network
  address book (13579 testnet entry), vendored artifacts the package doesn't ship
  (OZ 5.4.0 TransparentUpgradeableProxy/TimelockController/UpgradeableBeacon + AtomWarden +
  WrappedTrust, compiled from the package's own `./src/*` export — `scripts/regen-vendored.sh`),
  and a **viem deployer** replicating `IntuitionDeployAndSetup.s.sol` (anvil branch) with the
  createAtoms→AtomCreated acceptance test. Idempotent CLI: `bun run devnet:deploy`.
- **Production-faithful devnet**: published bytecode is the `optimizer_runs=10000` production
  build; MultiVault runtime = 27,666 B > EIP-170, so anvil now runs `--disable-code-size-limit`
  (mirrors the raised cap on the Intuition L3). The old devnet rebuilt at 200 runs — different
  bytecode than prod; the new one is byte-identical. Real MultiVaultMigrationMode used as the
  proxy impl (as prod does), no more plain-MultiVault size workaround.
- **Infra swap**: `docker/Dockerfile.devnet` → bun-only one-shot (no foundry/git/python; volume
  `devnet_contracts` dropped, state bind-mounted to `devnet/deployments-devnet.json`);
  deleted `devnet/setup.sh` + `devnet-deploy.sh`; `make devnet`; Process Compose overlay
  `.process-compose/devnet.yaml` + `dev-local.sh --devnet` flag (composable with `indexing`).
- **ABI single source of truth**: `scripts/sync-abis.ts` generates
  `crates/rindexer-ingestion/abi/MultiVault.json` from the package (`abis:sync`/`abis:check`);
  CI drift gate wired into ci.yml. ABI bumped 4b4ee8e→94bddae: **events 26/26 identical**
  (indexer-safe); function diffs are the ref bump.
- **Supply-chain policy**: bunfig `minimumReleaseAgeExcludes = ["@0xintuition/contracts-v2"]`
  (first-party, exact-pinned); guard script now enforces a reviewed allowlist
  (`APPROVED_RELEASE_AGE_EXCLUDES`) instead of rejecting all excludes.

### Verified
- Native e2e: fresh anvil → deploy (34 txs, ~2 s) → acceptance passed; re-run idempotent.
  **MultiVault proxy deterministic at the SAME address as before**
  (`0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f`) — docs/example.env stayed valid.
- Docker e2e: `--profile devnet up --build` → acceptance passed in-container, state file on host,
  restart skips deploy. Drift gate proven (perturb → fail → sync → pass).
  Workspace green: typecheck 13/13, biome, guard.
- **FULL LOOP PROVEN on docker devnet** (`--profile devnet --profile indexing`): cast createAtoms
  ("https://github.com/0xIntuition/intuition-core") → indexed in seconds → /api/stats 57→58 →
  /api/atoms shows it parsed + classified `SoftwareSourceCode` → **deterministic-ID parity**:
  `kgAtomId()` locally == onchain-indexed id (`0x85ec2459…`). Note: first Rust image build is slow
  (~1 h cold, and one wedged BuildKit run needed a client restart); subsequent builds are cached.

### Upstream follow-ups (contracts-v2 alpha.1 — we maintain the package)
Export AtomWarden + WrappedTrust; ship OZ infra bytecodes or a deploy module; add a
`deployments` (address book) export. Then delete `packages/contracts/vendored/`.

---

## 2026-07-02 (evening) — Rate limiting, provider docs, local devnet

**Docker workflow note:** Kames shuts Docker Desktop down manually between uses (machine slowdown).
Daemon-down is the normal state — batch ALL Docker-dependent validation into single planned sessions.

### Shipped (static-verified: typecheck 12/12, tests 14/14, biome, 67 md link-clean; committed)
- **Rate limiting** (`a5160e8`): per-key fixed-window limiter, API_RATE_LIMIT_RPM default 120,
  per-key `rate_limit_rpm` override (migration 0002 authored, NOT yet applied to local DB),
  keys:create --rate-limit, 429 + headers, unit tests.
- **Provider docs** (`a5160e8`): docs/enrichment-providers.md (keyless table + 13 keyed providers
  with acquisition steps, env names verified from code) + docs/writing-an-enrichment-plugin.md.
  **Fixed compose bug: only 6/16 provider keys were passed through to containers.**
- **Local devnet** (latest): devnet/ (vendored devnet-deploy.sh + pinned-ref setup.sh @ 4b4ee8e1),
  compose `--profile devnet` (anvil + one-shot deployer), docs/local-devnet.md, example.env block.
  Deploy sequence PROVEN natively (2× fresh-anvil runs, AtomCreated acceptance): MultiVault
  deterministic at 0xa85233C63b9Ee964Add6F2cffe00Fd84eb32338f, ~40s cold. Event signatures verified
  == indexer ABI. Docker-side (image build, compose run) NOT yet validated.

### ⚡ NEXT DOCKER SESSION — run this batch, then Docker can go down again
1. `docker compose up -d postgres-kg` → `bun --filter @0xintuition/database-kg run db:migrate`
   (applies 0002 rate_limit_rpm) → quick live rate-limit check (mint key --rate-limit 3, hit 4×,
   expect 429).
2. **Containerized full-stack run** (task 11): `docker compose down -v` then
   `docker compose --profile indexing up --build -d` with testnet chain env → verify: migrations,
   234 events, kg.nodes populated, workers process, API serves (the outsider experience; also
   rebuilds bun images with the API-key/rate-limit/write-path code — current api image is STALE).
   Note: Rust images already built earlier; --build refreshes bun layers fast. Keep builds
   sequential — parallel heavy builds destabilized the daemon before.
3. **Devnet validation** (task 13): `docker compose --profile devnet up -d anvil devnet-deploy` →
   watch acceptance pass → flip .env to anvil/31337/0xa85233… → `--profile devnet --profile
   indexing up` → create atom via cast → confirm it lands in /api/atoms classified.

### Remaining after that (publish mechanics, mostly user-side)
- GitHub org: repo, core-maintainers team, branch protection, gitleaks org license; squash-fresh
  history at flip. Marketing copy alignment. Logo/social image + terminal GIF. GHCR-published
  images + v0.1.0 tag (turns 15-min first-run builds into a pull).

---

## 2026-07-02 (later) — Developer verbs complete: write path, API keys, atom-services, seeds, docs

All three community verbs now verified live: **index atoms** (chain + local write path),
**classify URLs**, **fetch enrichment metadata**.

### Shipped + live-verified
- **API-key system** (user request): `kg.api_keys` (SHA-256 hashes only, account-bound) + drizzle
  migration 0001; bearer middleware (bad key → 401 immediately); `API_AUTH=open|public-read|gated`
  (default public-read); keys CLI (`keys:create/list/revoke`, `--read-only`). Verified live:
  no key → 401, valid key → 201 with `created_by` attribution, bogus key → 401.
- **Write path**: `POST /api/atoms` ({input} → deterministic ID via kgAtomId, idempotent 201/200) and
  `POST /api/triples` (kgTripleId restored — **parity-locked by known-answer test** against
  @0xintuition/ids vector 0x57946a02…; ensureTripleWithCreation action added). Verified live:
  posted github.com/oven-sh/bun → 0x951d…; full pipeline: parse ✅ classify **SoftwareSourceCode** ✅
  enrich ✅ (3 keyless artifacts: opengraph, favicon, github-repo); attributed triple created and
  read back via hexastore. Chain atoms' enrichment = `skipped` ×53 (plain strings — correct).
- **atom-services** wired into default compose (:4010) + Dockerfile. Verified live keyless:
  /v1/classify github URL → github/repo @0.97; /v1/process wikipedia URL → 5 artifacts (opengraph,
  jsonld, icons, wikipedia extract, wikidata entity); npm plugin 404 degraded gracefully.
  NOTE: /v1/process payload key is `rawInput`, /v1/classify takes `input`.
- **Baseline predicate seed** (14) vendored — enshrined trusted-in-the-context-of IPFS atom id
  inlined as identity-locked literal (0x0840db…2c07); auto-seeds in migrate. Verified live.
- **Fixed real upstream bug**: migration 039 declared `refresh_trending_topics(job_id BIGINT,…)` but
  TimescaleDB invokes custom jobs as (INTEGER, JSONB) → job failed every 15min. Fixed migration +
  live DB. **Flag to alpha/prod — same bug exists there.**
- **docs/**: run-your-own-node.md, architecture.md, configuration.md, troubleshooting.md (tzdata
  landmine, CHAIN_ID-at-runtime, port conflicts, docker-crash recovery).
- API unit tests added (auth helpers known-vector, detectRawType). **14/14 test tasks green**,
  typecheck 11/11, biome 460 files, guard passing.

### Still open
- Rust Docker images building (background); then the containerized `--profile indexing` run.
- Plugin-authoring guide (needs the example-plugin package vendored) — community extensibility doc.
- GitHub org mechanics: repo creation, branch protection, core-maintainers team, gitleaks org license.
- Marketing copy alignment (node→core, datastores wording).

---

## 2026-07-02 — FULL PIPELINE PROVEN ON REAL CHAIN DATA + SurrealDB dropped

### The smoke test (task 7) — every stage verified live
Bounded run against the **public keyless testnet RPC** (`https://testnet.rpc.intuition.systems/http`,
chain 13579, MultiVault `0xeBc49d…843ec`, blocks 9030416→9032416):

1. **indexer** (native binary): 234 events indexed in **691ms** — 53 AtomCreated, 58 Deposited,
   61 SharePriceChanged, 62 ProtocolFeeAccrued; respected `end_block` and exited. ✅
2. **projections** (PG-only): ~20 checkpointed workers fanned out → vault 54, term 53, position 55,
   signal 58, event 234 read models; **core_entities wrote 53 atoms into our extracted `kg.nodes`**
   (+2 creator accounts; 0 triples = 0 TripleCreated in window; exact parity). ✅
3. **workers** (kg-parse + kg-classification, 25s each): all 53 chain atoms → `completed/completed`. ✅
4. **query API**: `/api/stats` `{"atoms":53,"triples":0,"accounts":2}`; real atoms ("joji",
   "winning", "losing") with deterministic hex IDs and `onchain:true` served over REST. ✅

**Architecture decision (CTO): SurrealDB is OUT.** Core = Postgres-KG + TimescaleDB + Redis.
The code already supported it: projections' `connect_surreal_if_needed` swaps in a **NoopSink when
`SURREAL_DB_URL` is empty** ("retired in greenfield environments" — i.e. how staging/prod run).
Removed the surrealdb service/volume/image, SURREAL_* env, README references; compose `projections`
sets `SURREAL_DB_URL: ""` explicitly.

### Landmines found + fixed this session
- **Corrupt Docker layer** from the earlier disk-full: timescaledb-ha's zoneinfo files were
  right-size but **zero-filled** → Postgres rejected `SET TimeZone='UTC'` (only 25 zones parsed, all
  Africa/*). sqlx sets TimeZone=UTC at connect → indexer hard-fail. Fix: `docker rmi` + re-pull
  (fresh image 4.35GB vs corrupt 2.67GB); 1198 zones after. **postgres-js never trips this** (no
  startup param) — worth a troubleshooting-doc entry.
- **Generated `networks.rs` reads `CHAIN_ID` from env directly** (panics if unset) — chain env is
  needed at *runtime*, not only at manifest render. Compose already passes it; documented here.
- SurrealDB v2 vs Rust SDK v3 subprotocol mismatch discovered en route (moot now — surreal dropped).
- Docker Desktop crashed again mid-run (all containers exited 255); volumes survived, re-up clean.
- TimescaleDB job noise: migration schedules `refresh_trending_topics` job but the function doesn't
  exist (errors every 15min in logs). Nonfatal; clean up in migration curation fast-follow.
- Native-run gotchas: indexer needs cwd with `./abi/` + rendered manifest; API port 3000 was taken
  by an unrelated local process (use another port for local runs).

### Remaining before flip-public (all known, none blocking the proof)
1. **Rust Docker images unbuilt** — the two `docker build`s (ingestion, projections) were killed
   twice mid-build; the smoke ran native binaries + compose datastores. Config is identical; build
   the images and do one full `docker compose --profile indexing up` run.
2. Commit everything; squash-fresh history at publish per security gate.
3. `docs/` (run-your-own-node, architecture, config table, troubleshooting incl. the tzdata landmine).
4. Migration curation fast-follow (product-analytics tables, trending-topics job).
5. Marketing copy alignment: "four datastores"/SurrealDB → two Postgres + Redis; `node` → `core`.

---

## 2026-07-01 — Phases 3+4 push: Rust pipeline extracted + P0 hygiene + fresh read-only API

Sprint toward publish. P0 hygiene done; Rust indexing pipeline extracted and compiling; fresh
minimal query API written. TS atom-libs + workers extraction delegated (in flight).

### P0 publish hygiene ✅
- `.github/workflows/ci.yml`: frozen install, supply-chain guard, typecheck, biome, tests, compose
  config validation + gitleaks over full history.
- `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `.github/CODEOWNERS`.
- `scripts/guard-supply-chain-policy.mjs` + `enforce-bun-install.mjs` ported; preinstall wired; passing.
- gitleaks: **history clean**; tree findings are only the local gitignored `.env` (dev creds — never commit).

### Rust workspace extracted ✅ (`cargo check --workspace` exit 0, 2m07s)
- `crates/`: `shared`, `rindexer-ingestion`, `projections`, vendored `curves` (path-dep fixed to
  `../curves`). Embeddings crates deliberately excluded (Search tier, later).
- Root `Cargo.toml` workspace with alpha's `[workspace.dependencies]` table.
- **Scrubbed:** deleted 4 diagnostic bins (hardcoded internal RPC) + their `[[bin]]` entries; deleted
  a leftover **rendered manifest containing a live partner RPC key** (caught by inspection, confirmed
  by gitleaks after); removed the `rpc.intuition.systems` fallback in main.rs (INTUITION_RPC_URL now
  required); stripped all 21 ENG- refs; scrubbed internal paths from the yaml template header.
- **Bounded indexing:** rindexer supports `end_block`; entrypoint.sh now renders an optional
  `end_block` line from `MULTIVAULT_END_BLOCK` (unset → sync to head). In example.env.
- **Migrations:** all 49 event-store SQL migrations → `migrations/timescale/` (secret-scanned,
  ENG-stripped; product-analytics tables kept for numbering integrity — curation is a fast-follow).
- **Docker:** fresh `docker/Dockerfile.{ingestion,projections,timescale-migrations}` for the repo-root
  context (same proven multi-stage caching pattern); `.dockerignore` added.
- **Compose:** `timescale-migrate` one-shot in default profile; `indexer` + `projections` under
  `--profile indexing` (need chain config; default `docker compose up` stays green without it).
  Projections default `DISABLED_PROJECTIONS=funnel_tracker,user_activity_batch` (product analytics).

### services/api written (verify pending)
Fresh ~350-line Hono read-only API (spec §6 Option A) instead of slicing alpha's 82-file auth-coupled
api: `/health`, `GET /api/atoms` (+ `:id`, `:id/triples` via hexastore), `GET /api/triples` (+ filters,
`:id`), `/api/predicates`, `/api/stats`. Public read model only (`active`+`public`). Deps: database-kg +
hono only. `docker/Dockerfile.api` + compose `api` service in the default profile. Typecheck/install
deferred until the TS-extraction agent finishes (lockfile race).

### In flight
- Background agent extracting: atom-parser/classification/enrichment/rules-engine/types/graph-flags →
  `packages/`, workers (kg-path only) + atom-services → `services/`, plus the database-kg **actions
  subset** workers need (processing lease machinery). Must pass typecheck/biome/guard.

### Next
- Integrate agent output → full `bun install` + repo-wide typecheck + biome.
- Task 7: live smoke — bounded index (START+~500 blocks) against testnet RPC → rows in event_store →
  projections fan-out → query via API. Testnet params from the (deleted) rendered manifest: chain_id
  13579, MultiVault 0xeBc49d356B7f64D888130D85CC6D17114a6843ec, start_block 9030416; RPC endpoint via
  local .env only.
- Then: workers wired into compose, README/docs refresh, commit.

---

## 2026-07-01 — Tests green (incl. vs dev DBs) + `events_hourly` ships (parallel session)

Ran concurrently with the "one button" validation below (two sessions worked the repo at once —
changes reconciled, merged state re-verified: migrate idempotent, 12 tables + cagg present).

### Done
- **Shipped the deferred `kg.events_hourly` continuous aggregate** —
  `migrations/post/0002_events_hourly.sql`. Definition read from the **live dev DB** and mirrored
  exactly: hourly `time_bucket` by `entity_kind`+`event_type`, `materialized_only=true`, refresh
  policy every 15min over a 3h window, `if_not_exists` throughout (post files re-run every migrate).
  Verified live on local postgres-kg: insert → `refresh_continuous_aggregate` → rollup row returned.
  Note: `kg.events.id` is `text NOT NULL` with no default **on dev too** — worker-supplied
  deterministic event IDs, not a lost bigserial.
- **timescale tests: 5-fail → 9/9 green.** (a) Parser tests read migration SQL from the private
  monorepo's `backend/migrations/` — vendored the two fixtures into `tests/fixtures/migrations/`
  (secret-scanned). (b) DB-backed tests threw at module load without `DATABASE_TIMESCALE_URL` — now
  `describe.skip` cleanly: hermetic by default, opt-in via env. (c) **Real verifier bug**:
  `verifyTimescaleSchema` scanned every live table in `public` and crashed on column types outside
  its normalizer (`inet` on an admin table Core doesn't own). Now scopes the scan to the manifest's
  33 tables (curated-subset semantics: extra live tables aren't drift) and reports unknown live
  column types as drift instead of throwing.
- **Verified against the dev databases** (the copied-over `.env`): all 9 tests pass live, including
  the e2e hypertable/cagg queries against real indexed data. The drift verifier passing proves the
  checked-in manifest matches dev **exactly** for all 33 tables. Dev KG (PG 17.5, `kg` schema live,
  14 tables = Core's 12 + `account_auth_links` + `events_hourly`), dev Timescale, and SurrealDB
  testnet-dev (`/health` 200) all reachable.
- **Env plumbing**: `turbo.json` `test` task now declares `DATABASE_KG_URL`/`DATABASE_TIMESCALE_URL`
  (Turbo v2 strict mode stripped them). Gotcha: bun's auto-loaded root `.env` does NOT reliably reach
  turbo-spawned package tasks — `set -a; source .env; set +a` first when running DB tests.
- Manifest-staleness worry from 06-30 resolved: `manifest.json` matches `layout.ts` exactly (33/33);
  it was never stale table-wise. `compat-inventory.json` still unregenerated (harmless).
- The "no space left" below was real, not phantom: the timescaledb-ha pulls filled the host to 100%
  and the Docker VM went read-only. Recovered via Docker Desktop restart + `docker builder prune -af`
  (33.6 GB reclaimed). Host disk remains tight — cleanup outside this repo advisable.

---

## 2026-07-01 — Live validation: the "one button" works end-to-end ✅

Docker available. Ran the migrate path live and **verified against a real database**. (A Docker
crash/restart mid-session caused some transient flakiness — a phantom "no space left," a half-init
postgres volume — resolved by `docker compose down -v` + a clean re-run.)

### Verified live (queried the running DB)
- `docker compose up migrate` → **exit 0**: bun install in-container, drizzle DDL applied, post
  migration applied (timescaledb extension + hypertable).
- **12 KG tables** created (nodes, triples, accounts, predicates, artifacts, node_urls, adjacency,
  events + account/node/predicate/triple_pattern stats).
- **`kg.events` is a real TimescaleDB hypertable** (1 time dimension) — the custom post-migration works.
- **6 hexastore permutation indexes** on triples; **3 worker-recovery indexes** on nodes; **55 indexes,
  125 constraints** total in the `kg` schema.
- All four datastores healthy: postgres-kg, timescale, redis, surrealdb.

### Fixed this session
- **Self-referential delimiter bug** in the migration runner: the post-SQL *comment* contained the
  literal `--> statement-breakpoint`, and `splitStatements` split on it as a substring → a statement
  starting with a backtick → `syntax error at position 1`. Fixed the splitter to match the marker only
  on its own line (`/^[ \t]*-->[ \t]*statement-breakpoint[ \t]*$/m`) and reworded the comment.
- **SurrealDB `Exited(1)`** on a fresh named volume: the image's default non-root user can't create the
  RocksDB dir. Added `user: root` to the datastores compose (local dev datastore). Now healthy.

### Environment note
- Host disk was critically low at one point (228 MB free on `/`); recovered to ~10 GB after the Docker
  restart. Worth watching — the timescaledb-ha image is large.

### Not yet in the repo (answering "limit the indexer to a few blocks")
The **indexer is not extracted yet** — `rindexer-ingestion` (Rust) still lives only in `alpha`. When we
bring it over, bounded indexing is env/config-driven: `MULTIVAULT_START_BLOCK` already exists, and
rindexer's contract config takes an **end block** too — so we expose `START_BLOCK`/`END_BLOCK` to index
a small window (e.g. a few hundred blocks) instead of the full history. That's the cheap-test path.

### Next
1. **Extract the indexer** (Rust: `rindexer-ingestion` + `shared` + vendored `curves` crate; Cargo
   workspace; scrub hardcoded RPC/keys) with a bounded START/END block for cheap local runs — then
   `docker compose up` indexes a handful of events into the schema we just validated.
2. Or **`services/api`** first (read-only REST over the graph) — the piece the community touches first.

---

## 2026-06-30 — Migration system: schema actually stands up (the "one button", step 2)

Built the migration system for the KG. **Verified offline** (Docker daemon was unavailable: daemon
down + image pulls blocked). Everything that doesn't need a live DB is proven; the single live-apply
step is flagged.

### Done
- **Generated + committed KG migration** via `drizzle-kit generate` → `drizzle/0000_kg_core_init.sql`.
  Inspected the SQL: 12 tables, `kg` schema, **all 6 hexastore indexes**, **3 worker-recovery
  indexes**, the partial-unique primary-URL index, **22 check constraints** — all preserved.
- **Found + fixed a real bug:** `account_stats` used `.default(BigInt(0))`, which crashes
  `drizzle-kit generate` (`Do not know how to serialize a BigInt`). Switched the 4 columns to
  `.default(sql\`0\`)` → emits correct `DEFAULT 0`. `generate` earned its keep before any DB existed.
- **Authored the TimescaleDB SQL Drizzle can't express:** `migrations/post/0001_events_hypertable.sql`
  — `create_extension timescaledb` + `create_hypertable('kg.events','event_time')`, idempotent.
- **Wrote the migration runner** `src/migrate.ts`: applies the drizzle journal, then the post `*.sql`
  (split on `--> statement-breakpoint`, autocommit per statement). **Detects timescaledb and skips the
  hypertable step on plain Postgres**, so the schema applies on either engine. Typechecks; verified it
  loads drizzle+postgres and executes to the DB-connection boundary.
- **Wired scripts:** `db:generate`, `db:migrate`, `db:push` (+ resolved a `dotenv-cli` install hiccup).
- **Top-level `docker-compose.yml` = the "one button":** `include`s the datastores and adds a one-shot
  `migrate` service (depends_on `postgres-kg` healthy, container-network DSN, host `node_modules`
  masked, calls the runner directly — no dotenv in-container). `docker compose config` validates the
  merge offline.
- README quickstart updated to the real flow. Whole-repo `typecheck` ✅, `biome check` ✅ (53 files).

### Deliberate deferrals
- **`kg.events_hourly` continuous aggregate** — deferred to the Timescale-migration slice where it can
  be validated against a live DB. Continuous aggregates have finicky transaction semantics; shipping an
  untested one that could fail-close the whole migration is the wrong trade. Hypertable (bulletproof)
  ships now; the rollup follows.
- **Live `docker compose up` apply** — unverified pending a Docker daemon. The runner is verified to
  the connection boundary; the compose merge is validated. First action when Docker is available:
  `docker compose up` and confirm the schema applies end-to-end.

### Next
1. **Validate live** once Docker is up: `docker compose up` → confirm migrate applies KG schema +
   hypertable; then add the `events_hourly` continuous aggregate and verify it.
2. **Timescale package migrations** — it uses a custom generator (`src/timescale-generation/*`, scripts
   not yet brought over) for hypertables/continuous-aggregates/compression. Bring those scripts, wire a
   `db:migrate` for timescale, add it to the compose `migrate` job.
3. **Protocol slices** (`market`, `projection`) into database-kg.
4. **Graph-core actions**, then **`services/api`**.

---

## 2026-06-30 — Extracted the graph core: `@0xintuition/database-kg`

Extracted the **knowledge-graph schema** — the heart of the stack. Curated to the graph core,
verified `bun install` ✅, `turbo typecheck` ✅ (both packages), `biome check` ✅ (52 files, boundary
guard satisfied).

### What came over (the graph core, in `src/schemas/kg/`)
- **nodes** (atoms) — deterministic text PK; full parse→classify→enrich **lease-based worker state
  machine** (attempts/status/started/lease-expiry/error/result per stage) with dedicated recovery
  indexes; `data_resolved` jsonb, `search_text`; enum check constraints. Plus `node_stats`
  (in/out-degree, neighbor/predicate counts).
- **triples** (claims) — full **hexastore**: all 6 SPO permutation indexes for any-direction
  traversal; node|triple ref types (meta-triples); counter-triple + sibling modeling; confidence /
  inferred / provenance. Plus `triple_pattern_stats` (selectivity scores for query planning).
- **accounts** (wallet-keyed) + `account_stats`; **predicates** (+ inverse/transitive/symmetric flags,
  `predicate_stats`); **artifacts**; **node_urls** (denormalized eTLD+1 domain, partial-unique primary
  URL); **adjacency** (materialized edges w/ market/social weights); **events** (graph mutation log);
  **refs** (KgRefType). `client.ts` (PgBouncer-safe `prepare:false`), `client-env.ts`, `drizzle.config.ts`.

### First-principles decisions made
- **Dropped `account_auth_links`** — it bridges Supabase auth UUIDs → wallet accounts purely to join
  the private auth/social layer. Removed it, trimmed the `accounts.authLinks` relation, removed the
  barrel export. This is the auth boundary made concrete.
- **postgres-kg container → `timescaledb-ha`** (was plain pgvector). `kg.events` is a TimescaleDB
  hypertable and the Search tier needs pgvector; the -ha image bundles both. Caught before it could
  fail at migration time.
- **Deferred** the action layer (~30 files, many product-coupled), `seeds/predicates.ts` (imports the
  private `@0xintuition/stacks`), and `pg-vector.ts` (no vector columns in the kg core — arrives with
  the Search tier). Kept this slice to **schema + client only**: zero private coupling, deps are just
  `drizzle-orm` + `postgres`.
- **Scrubbed** Linear refs (ENG-10893 in node_urls) and an internal infra path (gcp-deployment) in the
  client comment, preserving the behavioral intent.

### Next
1. **Wire migrations** — `db:generate` the KG + Timescale DDL, then author the custom SQL the ORM
   can't express: `create_hypertable('kg.events','event_time')`, the `events_hourly` continuous
   aggregate, and Timescale hypertables on the timescale package's event/market tables. Add a one-shot
   `migrate` service to the compose so `docker compose up` auto-applies them (the "one button" step 2).
2. **Protocol slices** — bring `schemas/market` (vaults) + `schemas/projection` into database-kg with
   the same rigor (they're protocol, not product).
3. **Graph-core actions** — curate the clean subset (nodes, triples, predicates, accounts, artifacts,
   processing, ids, pagination) out of the ~30 action files; drop the social/product ones.
4. Then scaffold `services/api` on top of these schemas.

---

## 2026-06-30 — Foundation laid + first package extracted

### Done
- **Monorepo foundation** (Bun + Turborepo + TS 5.9 + Biome, mirrored from the private monorepo so
  extraction is copy-paste): `package.json` (workspaces `packages/*`, `services/*`, `tooling/*`),
  `turbo.json`, `tsconfig.json`, `bunfig.toml` (14-day supply-chain release-age guard), `biome.json`,
  `.gitignore`, `.nvmrc`, `LICENSE` (MIT), `README.md`.
- **Auth-free boundary enforced in lint:** `biome.json` `noRestrictedImports` errors on any import of
  `@0xintuition/authentication | database-auth | stripe | email | email-brevo`. The boundary can't rot.
- **Shared tsconfig package** `@0xintuition/tsconfig` at `tooling/typescript/` (base + compiled-package).
- **Datastores "one button":** `docker-compose.datastores.yml` — Postgres-KG (pgvector pg17, :5432),
  TimescaleDB (timescaledb-ha pg17, :5433), SurrealDB (v2, :8000), Redis (7, :6379), all healthchecked.
- **Env template:** `example.env` (placeholders only, no auth/stripe). NOTE: the harness blocks writing
  any `.env*` path, so we use `example.env` + `cp example.env .env`. If we want a literal `.env.example`,
  the user must create it or relax the permission.
- **First package extracted: `@0xintuition/database-timescale`** (MIT, self-contained — only deps are
  `drizzle-orm` + `postgres`). **Curated to indexer/market core**, dropping product/growth/admin tables
  (verified no functional code references them — only the generated barrel did):
  - Kept: `accounts, events, leaderboard, positions, signals, stats, terms, vaults` + continuous-aggregate
    wrappers (`timescale-wrappers.ts`) + verification/relations/generation tooling.
  - Dropped: `experiments, funnels, user-activity, user-retention, user-topic-affinity, admin-audit`.
- **Verified:** `bun install` ✅ and `bun run typecheck` (database-timescale) ✅ exit 0.

### Deliberate follow-ups (left intentionally)
- `src/schemas/timescale/compat-inventory.json` and `manifest.json` are **stale** — still list the
  dropped tables. They're generated metadata for the schema-generation/verification tooling, which we
  aren't running yet. Regenerate (or delete with the tooling) when we wire migrations.
- The original package's `scripts/` dir (check-connection, generate, verify, smoke) was **not** copied;
  the corresponding `db:*` scripts were removed from `package.json`. Re-add with a `drizzle.config.ts`
  when we wire migrations + the `docker compose` auto-migrate step.
- Tests needing a live DB / generation are present but not in CI yet.

### Next
1. Extract **`@0xintuition/database-kg`**, curated to the graph core `schemas/kg/`
   (accounts, account_auth_links, adjacency, artifacts, events, node_urls, nodes, predicates, refs,
   triples) + `schemas/market/`. Drop the product layer (`schemas/intuition/`, `social`, `rec`, `search`).
   Watch its workspace deps: `@0xintuition/ids` + `@0xintuition/predicates` are **published npm packages**
   (depend on them from npm); `@0xintuition/stacks` is private — trim that coupling.
2. Wire **migrations + auto-migrate** into the datastores compose (the "one button" step 2).
3. Scaffold **`services/api`** — clean read-only REST over the graph (no auth/tRPC), per spec §6 Option A.
4. Add CI: typecheck + biome + the secret-scan gate (gitleaks/trufflehog) before any publish.
