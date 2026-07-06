# Open-Sourcing the Intuition Backend — Program Command Center

**Status:** Draft v1 — for CTO / stakeholder review
**Owner:** Chief Architect (program lead)
**Created:** 2026-06-25
**Target window:** ~5 weeks, sequenced to land with the application launch

---

## One-paragraph summary

We have already open-sourced the **TypeScript SDK layer** (`0xIntuition/packages`: 10 npm
packages — deterministic IDs, classifications, predicates, protocol ABIs, React hooks). That lets
builders *build with* the Intuition knowledge graph. This program open-sources the **backend that
runs the graph**: the Rust indexing pipeline (chain → TimescaleDB + SurrealDB), the atom
classification/enrichment/parser intelligence, the recommendation engine, and the public API. The
goal is that any developer or partner can **run their own Intuition node** — index the chain,
classify and enrich atoms, and serve the graph — instead of depending on Intuition's hosted
infrastructure. That is the step that makes the "permissionless, credibly neutral knowledge graph"
thesis real instead of aspirational.

---

## Reading order

| # | Document | Audience | Purpose |
|---|----------|----------|---------|
| 00 | [`00-vision-and-value.md`](./00-vision-and-value.md) | CTO, exec, board | Why we do this; the narrative arc; value propositions; the stakeholder pitch |
| 01 | [`01-goals-principles-metrics.md`](./01-goals-principles-metrics.md) | Whole team | Goals, non-goals, principles, success metrics |
| 02 | [`02-codebase-inventory.md`](./02-codebase-inventory.md) | Engineers | The audit: every backend component, Rust/TS duality, what's in prod, OSS-readiness, blockers |
| 03 | [`03-target-architecture.md`](./03-target-architecture.md) | Engineers, architects | Which GitHub repos to create, what goes where, the node-monorepo layout |
| 04 | [`04-extraction-reconciliation-security.md`](./04-extraction-reconciliation-security.md) | Eng leads, security | How code moves private→public, reconciliation model, secret-scrub gate, what stays private |
| 05 | [`05-documentation-plan.md`](./05-documentation-plan.md) | DevRel, eng | Docs each repo needs to be runnable by outsiders |
| 06 | [`06-roadmap-and-workstreams.md`](./06-roadmap-and-workstreams.md) | Whole team, PM | The phased multi-week plan, workstreams, owners, governance, launch coordination |
| 07 | [`07-decisions-and-risks.md`](./07-decisions-and-risks.md) | Eng leads, CTO | Decision log (open + resolved) and risk register |
| 08 | [`08-master-checklist.md`](./08-master-checklist.md) | Execution | The full to-do list, by phase |

---

## Decisions snapshot (detail in [07](./07-decisions-and-risks.md))

| ID | Decision | Recommendation | Status |
|----|----------|----------------|--------|
| D1 | Repo topology | **Hybrid:** extend `0xIntuition/packages` (npm libs) + new `0xIntuition/node` polyglot monorepo (deployable services + databases + docker-compose) | **Needs CTO sign-off** |
| D2 | Reconciliation / deploy source | Mirror private→public during transition (scrubbed, gated), then cut prod build source over to the public repo | **Needs CTO sign-off** |
| D3 | License | MIT, matching the published `packages` repo | Recommended |
| D4 | Product / repo name | "Intuition Node" / `0xIntuition/node` (alternatives: `infra`, `indexer`, `backend`) | Needs marketing input |
| D5 | Embeddings provider coupling | Ship embeddings as **optional, feature-gated**, with a documented provider seam (OpenAI as default reference) | Recommended |
| D6 | Atom-parser Rust/TS duality | Publish **both**; TS is the active library, Rust is the reference parity service | Recommended |

## Next actions

1. CTO review of [`00-vision-and-value.md`](./00-vision-and-value.md) and the decisions snapshot.
2. Resolve D1 + D2 (they shape everything downstream).
3. Kick off Phase 0 (Foundations) per [`06-roadmap-and-workstreams.md`](./06-roadmap-and-workstreams.md).
