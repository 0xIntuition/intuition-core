# 06 — Roadmap, Workstreams, Team & Launch

> The multi-week execution plan, who owns what, how we govern the public repos, and how this lands
> with the application launch.

---

## 1. Phasing principle

Ship in layers, lowest-risk first ([01](./01-goals-principles-metrics.md) P6). Each phase is
independently valuable and gated on the previous one being clean. We never block a clean component on
a coupled one. Embeddings (OpenAI-coupled) and the deploy-source cut-over (prod-touching) are
sequenced *late* on purpose.

## 2. The phases (≈5 weeks + buffer)

### Phase 0 — Foundations & Alignment (Week 0, ~3 days)
**Goal:** decisions locked, repos exist, gates in place. Nothing ships yet.
- CTO/stakeholder review of [00](./00-vision-and-value.md); resolve **D1 (topology)** and
  **D2 (reconciliation/deploy source)** — these gate everything.
- Confirm D3 (MIT), D4 (naming, with marketing), D5 (embeddings optional), D6 (publish both parsers).
- Create `0xIntuition/node` (private first), set branch protection, CODEOWNERS, the security gate
  (gitleaks/trufflehog + supply-chain guard) in CI.
- Build the reconciliation tooling skeleton (`scripts/oss-sync/*`, `RECONCILIATION.md`).
- Stand up the program board and assign workstream owners (§4).

**Exit:** decisions signed off; repos + gates exist; owners assigned.

### Phase 1 — Atom Intelligence Libraries (Week 1)
**Goal:** the plugin-based libraries public on npm `@alpha`. Lowest risk, high developer value,
proves the pipeline end-to-end on small surfaces.
- Extract `atom-parser`, `atom-classification`, `atom-classification-example-plugin`,
  `atom-enrichment`, `atom-rules-engine`, `types` (subset) into `0xIntuition/packages`.
- Ensure all provider keys optional/degrading; scrub; per-package READMEs; root README + release-order
  updates; extend the hackathon example to classify+enrich.
- Publish through the existing validation gate + publish order.

**Exit:** new `@0xintuition/atom-*@alpha` packages installable; example runs; SDK narrative extended.

### Phase 2 — Node Skeleton & Data Layer (Week 2)
**Goal:** the `node` repo can boot the datastores and run migrations; Rust indexer scrubbed.
- Move `database-kg`, `database-timescale`, `database-surreal` into `node/packages`.
- Author `docker-compose.datastores.yml` + migrations + "bring up the databases" quickstart.
- Scrub `rindexer-ingestion` + `projections` (hardcoded RPC/contract/keys, Linear refs); vendor the
  `curves` crate; resolve/document the DB-pool split.

**Exit:** `docker compose -f docker-compose.datastores.yml up` works; migrations apply; indexer/projections build clean.

### Phase 3 — Indexing + Recommendation public (Week 3)
**Goal:** the technical centerpiece — chain → queryable graph — is public and runnable.
- Publish `indexer` + `projections`; verify against the Intuition chain in the public layout.
- Embeddings: feature-gate, add the provider seam, document OpenAI as default-off reference.
- Publish `recommendation-service` (cleanest service; reads Timescale only).
- **Begin the D2 deploy-source cut-over planning** with platform (do not flip prod yet).

**Exit:** an outsider can index the chain and watch the graph populate from the public repo.

### Phase 4 — API, Atom Services, Workers + Full Stack (Week 4)
**Goal:** the full "run your own node" experience.
- Publish `api` (new README, Stripe/OAuth optional, protocol coupling documented), `atom-services`,
  `atom-warden`, `workers` (workspace Dockerfile pattern).
- Author the top-level `docker-compose.yml` wiring the whole stack; tiered config from
  [03 §3](./03-target-architecture.md).
- Write `run-your-own-node.md`, `architecture.md`, plugin-authoring docs.

**Exit:** datastores → indexer → workers → API runs from one compose; minimal tier needs zero paid accounts.

### Phase 5 — Hardening & Launch (Week 5 + buffer)
**Goal:** safe, polished, coordinated public launch.
- External-eyes security review; full-history scan on all published paths.
- **Documentation acceptance gate** ([05 §5](./05-documentation-plan.md)): an outsider reaches a
  queried graph unaided.
- Independent-reconstruction check (indexer output == hosted view on a sample range).
- Flip repos public; coordinate announcement with the app launch + marketing (blog, FAQ, social).
- Execute or schedule the D2 deploy-source cut-over (may extend past launch as a fast-follow).

**Exit:** repos public; launch shipped; success metrics ([01 §4](./01-goals-principles-metrics.md)) instrumented.

## 3. Dependency / sequencing view

```
Phase 0 ─┬─► Phase 1 (libs, npm)  ─────────────┐
         │                                      ├─► Phase 4 (services depend on libs + data) ─► Phase 5
         └─► Phase 2 (data + indexer scrub) ─► Phase 3 (indexer/proj/rec) ─┘
```
Phase 1 and Phase 2 can run in parallel (different teams). Phase 4 needs both. Phase 5 needs all.

## 4. Workstreams & owners (RACI-lite)

| WS | Scope | Lead role | Phases |
|---|---|---|---|
| **WS-A Libraries** | atom-* npm packages into `packages` | SDK/TS engineer | 1, 4 (example) |
| **WS-B Indexing (Rust)** | indexer, projections, embeddings, recommendation, curves | Rust backend engineer | 2, 3 |
| **WS-C API & Services (TS)** | api, atom-services, atom-warden, workers | Backend engineer | 4 |
| **WS-D Data & Infra** | database pkgs, docker-compose, migrations, CI, security gate | Platform/DevOps engineer | 0, 2, 4 |
| **WS-E Docs & DevRel** | READMEs, run-your-own-node, plugin guides, launch content | DevRel + tech writer | all |
| **WS-F Security & Reconciliation** | scrub tooling, secret/history gate, D2 cut-over | Security/lead + platform | 0, 3, 5 |
| **Program** | sequencing, decisions, stakeholder comms | Chief Architect (you) | all |

Small team: one person can hold multiple WS; the point is **named ownership per surface**, not
headcount. WS-F's security gate is a hard dependency for every other WS's "publish" step.

## 5. Governance of the public repos

- **Issue-first contribution** (carry the `packages/CONTRIBUTING.md` model): discuss scope before
  code for anything touching public APIs, deterministic IDs, schema URLs, or release behavior.
- **CODEOWNERS** per directory; maintainers from the owning workstream review.
- **Determinism review** required on any change to classification slugs, predicate keys, parser
  output, or schema URLs (identity-sensitive — P1).
- **Branch protection** + the security gate in required CI on every repo.
- **Support contract:** best-effort, community-first, no SLA. A rotating "OSS triage" duty (a few
  hours/week) keeps issues/PRs from rotting without becoming a burden.
- **Release discipline:** reuse the `packages` release runbook (validation gate, publish order,
  `@alpha` dist-tag, never reuse a published version).

## 6. Launch coordination

- Sequence the public flip to **coincide with the application launch** so the story is one narrative:
  "the app is live, and the whole backend is open — run it yourself."
- DevRel readies: announcement blog (Phase 0→Phase 1→Phase 2 arc), FAQ, the plugin-authoring guide as
  the "here's how you contribute" hook, and a short demo (record a clean `docker compose up` →
  query).
- Marketing aligns repo/product naming (D4) and updates the site to point at the runnable backend.
- Have the **independent-reconstruction demo** ready as proof of credible neutrality — it's the most
  persuasive single artifact for the "verify the graph yourself" claim.

---

Continue to [`07-decisions-and-risks.md`](./07-decisions-and-risks.md).
