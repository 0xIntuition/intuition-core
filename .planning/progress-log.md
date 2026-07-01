# Intuition Core — Build Progress Log

Reverse-chronological. Companion to `intuition-core-open-source-spec.md`.

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
