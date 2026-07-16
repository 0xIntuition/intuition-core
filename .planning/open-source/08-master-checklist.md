# 08 — Master Checklist

> The execution to-do list, by phase. `[ ]` todo · `[/]` in progress · `[x]` done. Keep this current;
> it is the program's single source of "where are we."

---

## Phase 0 — Foundations & Alignment
- [ ] CTO/stakeholder review of `00-vision-and-value.md`
- [ ] Resolve **D1** (repo topology) — sign-off
- [ ] Resolve **D2** (reconciliation + deploy source) — CTO + platform sign-off
- [ ] Confirm D3 (MIT), D4 (naming + marketing), D5 (embeddings optional), D6 (both parsers), D7, D8
- [ ] Create `0xIntuition/node` (private), branch protection, CODEOWNERS
- [ ] Stand up security gate in CI: gitleaks + trufflehog + `guard:supply-chain`, fail-closed
- [ ] Build reconciliation tooling skeleton: `scripts/oss-sync/{sync,scrub,gate}.sh`
- [ ] Draft `RECONCILIATION.md` (canonical-where / frozen / review model)
- [ ] Assign workstream owners (WS-A…F); set up program board
- [ ] Name WS-F (Security & Reconciliation) owner

## Phase 1 — Atom Intelligence Libraries (→ `0xIntuition/packages`)
- [ ] Extract `@0xintuition/atom-parser` (TS lib)
- [ ] Extract `@0xintuition/atom-classification` (+ verify 15 plugins, provider keys optional)
- [ ] Extract `@0xintuition/atom-classification-example-plugin`
- [ ] Extract `@0xintuition/atom-enrichment` (provider plugins degrade gracefully)
- [ ] Extract `@0xintuition/atom-rules-engine`
- [ ] Extract shareable subset of `@0xintuition/types`
- [ ] Per-package READMEs; update root README package table + add "Atom intelligence" layer
- [ ] Update `CONTRIBUTING.md` boundary table + `docs/release.md` publish order
- [ ] Extend hackathon-quickstart: parse → classify → enrich end-to-end
- [ ] Security gate pass; publish `@alpha` per validation gate

## Phase 2 — Node Skeleton & Data Layer (→ `0xIntuition/node`)
- [ ] Move `database-kg`, `database-timescale`, `database-surreal` into `node/packages`
- [ ] Author `docker-compose.datastores.yml` (Postgres+Timescale, Postgres-KG, SurrealDB, Redis)
- [ ] Wire migrations + surreal setup; "bring up the databases" quickstart
- [ ] Scrub indexer: remove hardcoded `rpc.intuition.systems` fallback + diagnostics URLs
- [ ] Remove dev Alchemy key + Caldera URL from `.env.example` → placeholders
- [ ] Parameterize contract address / chain ID / start block (env-only)
- [ ] Vendor `curves` crate into `node/crates` (resolve path-dep)
- [ ] Resolve or document single→dual DB-pool split
- [ ] Strip internal Linear refs from Rust comments/READMEs
- [ ] Indexer + projections build clean in the public layout

## Phase 3 — Indexing + Recommendation
- [ ] Publish `indexer` (rindexer-ingestion) + verify against Intuition chain
- [ ] Publish `projections` (17 workers); checkpoint/recovery verified
- [ ] Feature-gate embeddings; add provider seam; OpenAI default-off; document
- [ ] Publish `recommendation-service`
- [ ] Begin D2 deploy-source cut-over **planning** with platform (don't flip prod)
- [ ] Independent-reconstruction spike: indexer output vs hosted view on a sample range

## Phase 4 — API, Services, Workers + Full Stack
- [ ] Publish `api`: add README, make Stripe/billing optional, document OAuth + protocol coupling, confirm `/api/test` gated
- [ ] Publish `atom-services` (classify/enrich HTTP)
- [ ] Publish `atom-warden` (EIP-712 signing; signer keys via env)
- [ ] Publish `workers` (workspace-copy Dockerfile pattern)
- [ ] Author top-level `docker-compose.yml` (full stack, tiered config)
- [ ] Verify minimal tier boots with **zero paid third-party accounts**
- [ ] Write `docs/run-your-own-node.md`, `docs/architecture.md`, service docs
- [ ] Write plugin-authoring guides (classification + enrichment) on the example plugin

## Phase 5 — Hardening & Launch
- [ ] External-eyes security review; **full-history** secret scan on all published paths
- [ ] Documentation acceptance gate: outsider reaches a queried graph unaided
- [ ] Independent-reconstruction check passes (proof of credible neutrality)
- [ ] `SECURITY.md`, `CODE_OF_CONDUCT.md`, CODEOWNERS, branch protection on all repos
- [ ] Flip repos public
- [ ] Launch content: announcement blog (Phase arc), FAQ, demo recording
- [ ] Coordinate flip timing with application launch + marketing
- [ ] Instrument success metrics (npm downloads, stars/forks, plugin contributions, triage time)
- [ ] Schedule/execute D2 deploy-source cut-over (fast-follow OK)

## Fast-follows (post-launch)
- [ ] Publish `curves` / split `shared` public primitives-events crates to crates.io (D8)
- [ ] Publish `database-*` packages to npm if demand (D7)
- [ ] Complete D2 Phase B cut-over for all services
- [ ] First community plugin merged (leading adoption indicator)
