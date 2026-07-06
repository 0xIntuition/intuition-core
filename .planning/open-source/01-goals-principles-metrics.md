# 01 — Goals, Principles & Metrics

---

## 1. Goals (what success requires)

**G1 — Runnable by an outsider.** A developer with no internal access can stand up the full backend
stack from a public repo and a README, and query a graph they indexed themselves.

**G2 — Verifiable graph.** An independent operator can reconstruct the same atoms/triples/markets
from chain events that Intuition's hosted backend produces — proving the hosted view is honest.

**G3 — Extensible intelligence.** The classification and enrichment plugin systems are public and
documented, with at least one end-to-end example, so the community can add domain coverage that still
produces deterministic, canonical atoms.

**G4 — No secrets, no surprises.** Nothing published contains credentials, internal-only URLs,
private provenance, or unscrubbed history. Every publish passes a secret-scan gate.

**G5 — Sustainable maintenance.** Daily development continues in the monorepo; the public surface is
kept in sync by a defined, low-friction reconciliation process — not by forking our workflow.

**G6 — Launch-aligned.** The open backend lands as part of the application-launch narrative, not as a
disconnected afterthought.

## 2. Non-goals (explicitly out of scope for this program)

- **Not** open-sourcing the product frontend apps (`apps/experimental`, `apps/admin`, `apps/funnel`)
  — separate decision, separate program.
- **Not** open-sourcing deployment/cluster infrastructure (`gcp-deployment` kustomize overlays,
  ArgoCD config, Secrets, the internal deploy workflows). We publish Dockerfiles + a docker-compose
  reference, not our production cluster wiring.
- **Not** open-sourcing internal experimentation infra (GrowthBook stack), billing/Stripe flows, or
  internal financial e2e harnesses.
- **Not** building a multi-operator consensus / decentralized-sequencer system. That is Phase 2. This
  program makes the backend *runnable by anyone*, not *coordinated across everyone*.
- **Not** committing to a support SLA. Support is best-effort, issue-first, community-first.
- **Not** a rewrite. We scrub, package, and document what already runs in production. Refactors are
  limited to what is required to remove coupling (provider seams, env parameterization).

## 3. Guiding principles

**P1 — Determinism is sacred.** Atom/predicate/triple IDs, classification slugs, parser output, and
schema URLs are identity-sensitive: change them and you fork the graph. Anything published that
affects derived bytes is frozen and review-gated, exactly as the `packages` repo already treats
schema URLs and predicate specs.

**P2 — Public repo is a release surface, canonical for what's public.** Following the `packages`
precedent ("package sources in this repository are the public package sources"), once a component is
published, the public repo is authoritative for its public shape. Internal-only provenance stays out.

**P3 — Reuse the proven playbook.** The `packages` repo already gives us MIT licensing, `@alpha`
dist-tag policy, a validation gate, a publish-order discipline, and `guard:supply-chain`. We extend
these, we do not reinvent them.

**P4 — Optional by default for external coupling.** Anything that needs a third-party credential
(OpenAI embeddings, OAuth providers, Stripe, scraping APIs) must degrade gracefully or be
feature-gated off, so the stack runs with zero paid accounts in its minimal configuration.

**P5 — Parameterize, never hardcode.** No Intuition-specific RPC URL, contract address, chain ID, or
internal hostname may be hardcoded. Everything is env-configurable with sane local defaults.

**P6 — Ship in layers, lowest-risk first.** Publish the pure libraries before the services; publish
the indexer before the API; gate each phase on the previous one being clean. Never block a clean
component on a coupled one.

## 4. Success metrics

**Launch-readiness (binary, must all be true at launch):**
- [ ] Minimal stack boots from public repos with zero paid third-party accounts.
- [ ] Secret-scan gate passing on all published repos and their history.
- [ ] "Run your own node" guide validated by someone outside the core backend team.
- [ ] Independent-reconstruction check: indexer output matches hosted view on a sample range.

**Adoption (track for 90 days post-launch):**
- npm downloads of the atom-intelligence packages (`atom-classification`, `atom-enrichment`,
  `atom-parser`, `atom-rules-engine`).
- GitHub stars / forks / unique cloners of the `node` repo.
- Number of external "run your own node" stand-ups we can confirm (Discord/issues/telemetry-free
  self-reports).
- Community-contributed classification/enrichment plugins (target: ≥1 within 60 days — the leading
  indicator that the extensibility story landed).
- External PRs and issues triaged (engagement, not just consumption).

**Health (ongoing):**
- Reconciliation lag: max days the public repo trails the monorepo for in-scope components.
- Time-to-triage on external issues/PRs (best-effort target, not an SLA).
- Zero secret-leak incidents.

---

Continue to [`02-codebase-inventory.md`](./02-codebase-inventory.md).
