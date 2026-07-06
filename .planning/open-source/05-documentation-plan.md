# 05 — Documentation Plan

> Open-source code nobody can run is not open-source. Docs are a first-class deliverable, not a
> trailing chore. The bar: a developer who has never met us gets to a queryable graph from the README.

---

## 1. Documentation tiers

| Tier | Question it answers | Owner |
|---|---|---|
| **Front door** | "What is this and should I care?" | DevRel + Architect |
| **Run it** | "How do I stand it up?" | Platform + service owners |
| **Understand it** | "How does it work?" | Service owners |
| **Extend it** | "How do I add my own X?" | Service owners + DevRel |
| **Contribute** | "How do I get a change in?" | Eng lead |

## 2. `0xIntuition/node` — required docs

**Front door**
- `README.md` — the headline. What "running a node" means, the architecture diagram from
  [03](./03-target-architecture.md), the tiered config table, and a **copy-paste quickstart** that
  reaches a queryable graph. Mirror the tone of the `packages` README (concise, builder-facing,
  "Start Here" block).
- `LICENSE` (MIT), `CONTRIBUTING.md` (adapt from `packages/CONTRIBUTING.md`), `SECURITY.md`
  (vuln disclosure), `CODE_OF_CONDUCT.md`.

**Run it**
- `docs/run-your-own-node.md` — the spine. Prereqs (Docker, Rust, Bun), `docker compose up` the
  datastores, run migrations, start the indexer against the Intuition chain (or any EVM MultiVault),
  watch atoms populate, start workers, start the API, run a first query. Each tier from
  [03 §3](./03-target-architecture.md) as an opt-in section.
- `docs/configuration.md` — every env var, what it does, default, and which tier needs it. One table.
- `docs/troubleshooting.md` — the failure modes the audit surfaced (DB pool config, missing OpenAI
  key → search degrades, SurrealDB connection, workspace Dockerfile builds).

**Understand it**
- `docs/architecture.md` — the chain → event_store → projections → graph → API pipeline; the dual
  Timescale + SurrealDB model; checkpointing; the sealed-event design. This is also recruiting collateral.
- `docs/services/<svc>.md` — one per service (indexer, projections, embeddings, recommendation, api,
  atom-services, atom-warden, workers): purpose, inputs/outputs, env, ports, health endpoints.
- `docs/data-model.md` — the schemas (KG / Timescale / SurrealDB) and how they relate, so consumers
  can query directly.

**Extend it** (the differentiator — leans on the plugin architecture)
- `docs/writing-a-classification-plugin.md` — walkthrough built on
  `@0xintuition/atom-classification-example-plugin`. This is the doc that converts the "community
  scales the graph" value prop into reality.
- `docs/writing-an-enrichment-plugin.md`.
- `docs/indexing-another-contract.md` — the indexer is MultiVault-specific by data but generic by
  mechanism; show how to point it at a different deployment.

## 3. `0xIntuition/packages` — additions for the new atom libs

For each new package (`atom-parser`, `atom-classification`, `atom-enrichment`, `atom-rules-engine`,
`atom-classification-example-plugin`, `types`):
- Package `README.md` matching the existing per-package style (one-liner, install, minimal example).
- Update the **root README package table** and the **Package Layers** table to include an
  "Atom intelligence" layer.
- Update `CONTRIBUTING.md` package-boundary table with the new packages and their ownership.
- Extend the **hackathon-quickstart** example (or add a second example) that classifies + enriches a
  parsed atom end-to-end — the natural sequel to the existing "life of an atom" story.
- Slot the new packages into the documented **publish order** and dist-tag policy in
  `docs/release.md`.

## 4. Cross-repo / narrative docs

- A **launch blog post / announcement** tying Phase 0 (SDK) → Phase 1 (open backend) → Phase 2
  (decentralized network). Reuse the marketing site's "onchain or off / permissionless / build on"
  voice. Owned by DevRel + marketing; drafted from [00](./00-vision-and-value.md).
- An updated **public architecture overview** on the docs site / marketing surface: "here's the whole
  stack, here's how to run it."
- A short **FAQ**: "Why open-source the backend?", "Does this expose your moat?" (answer from
  [00 §5](./00-vision-and-value.md)), "Do I need an OpenAI key?" (no, for the minimal tier), "Can I
  index my own contract?".

## 5. Documentation acceptance gate

Before launch, an engineer **not** on the backend team must follow `run-your-own-node.md` from a clean
machine and reach a queried graph **without asking for help**. Any step that requires tribal knowledge
is a doc bug and blocks launch (this is success metric G1 made concrete).

---

Continue to [`06-roadmap-and-workstreams.md`](./06-roadmap-and-workstreams.md).
