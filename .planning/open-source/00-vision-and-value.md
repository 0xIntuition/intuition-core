# 00 — Vision & Value: Why We Open-Source the Backend

> The document to read first, and the one to put in front of the CTO / stakeholders.

---

## 1. The thesis we are completing

Intuition's public claim is a **permissionless, credibly-neutral knowledge graph**: every fact gets
a *deterministic ID* (the same bytes hash to the same atom anywhere), a *canonical shape*, and an
*onchain market when it matters*. The marketing narrative says it plainly:

> *"The atom is public and permanent — anyone, in any app, derives the same ID and attaches their
> own triples."*
> *"One predicate grammar connects them across types: free to build offchain, a market onchain when
> it matters."*

There is a gap between that claim and today's reality. The atoms and triples may be onchain and
permissionless, but the **machinery that makes the graph usable is not**:

- The **indexer** that turns chain events into a queryable graph runs only inside Intuition.
- The **classification and enrichment** that turn a raw URL into "a Spotify track with this art and
  these credits" runs only inside Intuition.
- The **API** that everyone reads the graph through is a single hosted endpoint Intuition operates.

So today the honest statement is: *"the data is permissionless, but you can only see it through us."*
A credibly-neutral protocol cannot have a single company as the mandatory read path. **Open-sourcing
the backend closes that gap.** It is the difference between *"trust us, the graph is right"* and
*"run the indexer yourself and verify it."*

## 2. The narrative arc (where this sits)

```
Phase 0  — Protocol + SDK         [DONE]   Contracts live; 10 @0xintuition/* packages on npm.
           "Build WITH the graph."         Deterministic IDs, predicates, classifications, protocol ABIs.

Phase 1  — Open backend           [THIS]   Indexer, classification/enrichment, recommendation, API.
           "RUN the graph."                Anyone can index the chain and serve the graph themselves.

Phase 2  — Decentralized network  [NEXT]   Multiple independent operators; the network outlives any
           "The graph is no one's."        single operator. Community-run enrichment for new domains.
```

Phase 0 already proved the playbook: a clean public repo, MIT license, `@alpha` dist-tag, a
generated-from-spec model, and a disciplined release/validation gate. Phase 1 reuses that discipline
for the services tier. We are not inventing a process — we are extending a proven one to a bigger
surface.

## 3. Value propositions (the pitch)

Ordered by how they'd land with a CTO / board.

### V1 — It makes "credibly neutral" true, not marketing
A protocol whose only read path is one company's server is not neutral; it is a hosted product with
a token attached. Open indexing means **anyone can independently reconstruct the graph from chain
events and confirm Intuition's hosted view is honest.** This is the single most important strategic
reason and it is existential to the protocol thesis. Competitors and skeptics will ask "what happens
to the graph if Intuition disappears?" — the only credible answer is "anyone runs the indexer; here
it is."

### V2 — The moat is the network, not the code
The defensible asset is the **canonical onchain data, the enshrined predicate vocabulary, the token
economics, and the network of operators/builders** — not the indexer source. Open-sourcing the
indexer does not give a competitor the graph; the graph is onchain and already public. It *does*
give Intuition the network-effect upside of an ecosystem standardizing on its vocabulary and tooling.
Holding the code closed protects nothing and forfeits the ecosystem.

### V3 — Community-run enrichment scales the graph past our headcount
The classification and enrichment systems are **already built as plugin architectures** (15 built-in
classification plugins; a shipped example plugin showing exactly how outsiders extend them). That is
not an accident — the system was designed to be extended. Open-sourcing it lets the community write
classifiers/enrichers for domains we will never staff (scientific papers, regional commerce, niche
media) while every plugin still produces the **same deterministic atoms**, so the graph stays
coherent instead of fragmenting. This directly serves the site's anti-fragmentation message
("claims pile onto one record instead of fragmenting into duplicates").

### V4 — It is the hackathon/adoption unlock
The public packages and marketing site are explicitly **hackathon- and builder-oriented**
("Build the world's knowledge graph", `bun add ...@alpha`). Today a builder can compose SDK calls but
must point at our hosted backend. A one-command **"run your own node" docker-compose** lets a builder
or a hackathon team stand up the entire stack locally — index, classify, enrich, query — with no
dependency on us. That is a step-change in the developer funnel and in the credibility of the
"permissionless" pitch at every event.

### V5 — It distributes infra cost and single-point-of-failure risk
Partners and high-volume consumers who run their own indexer/API reduce Intuition's hosting load and
remove themselves as availability risks on our infrastructure. The protocol's resilience stops being
bounded by one company's uptime.

### V6 — It is a recruiting and reputation asset
A high-quality, production-grade **Rust event-indexing pipeline** (sealed event types, checkpointed
projections, dual-write to Timescale + SurrealDB) and a clean plugin-based intelligence layer are
exactly the artifacts that attract strong infra and protocol engineers. Open infra signals technical
seriousness in a way closed infra never can.

## 4. Why now

- The **SDK is already public** — the backend is the natural and expected next layer; builders are
  already asking how to run it.
- The **launch is imminent** — open infra landing *with* the app launch maximizes the narrative
  ("the network is open, here's how to run it") instead of being a quiet follow-up.
- The **plugin architecture is already in place** — we are not building extensibility, we are
  exposing extensibility that already exists. The marginal cost is scrub + docs + repo plumbing, not
  re-architecture.
- The **deploy pipeline is already containerized** (every service has a Dockerfile; prod runs from
  GHCR images). "Run your own" is mostly packaging what already runs, not new engineering.

## 5. Honest risks to the thesis (and the rebuttals)

| Concern a skeptic will raise | Rebuttal |
|---|---|
| "We're giving away our edge." | The edge is the network + onchain canonical data + token, none of which the code reveals. The graph is already public onchain. |
| "Support burden — people will file issues we have to answer." | Scope the support contract: best-effort, issue-first, community-first. The plugin model means contributors *add* capacity, not just consume it. Phase the launch so we control the surface. |
| "Security — we'll leak a secret." | A mandatory secret-scrub + history-scan gate on every publish (see [04](./04-extraction-reconciliation-security.md)). The known blockers (hardcoded RPC URLs, a dev Alchemy key, OpenAI coupling) are already inventoried and small. |
| "It will fragment our vocabulary." | The opposite: shared classification plugins + enshrined predicates make everyone derive the *same* atoms. Open-sourcing the deterministic intelligence is what *prevents* fragmentation. |
| "Maintaining a public repo will slow us down." | We keep developing in the monorepo and mirror outward on a cadence during the transition (see D2). The public repo is a release surface, not a second place to do daily work. |

## 6. What "done" looks like

A developer who has never met us can, from a public repo and a README:

1. `docker compose up` the datastores (Postgres + TimescaleDB, Postgres-KG, SurrealDB, Redis).
2. Run the indexer against the Intuition chain (or any EVM MultiVault deployment).
3. Watch atoms/triples populate, get classified and enriched by the plugin pipeline.
4. Start the API and query the graph they just built — and confirm it matches Intuition's hosted view.
5. Write a classification plugin for a domain we don't cover, and have it produce valid, deterministic
   atoms.

When that is true, "permissionless knowledge graph" is a fact about the system, not a slogan.

---

Continue to [`01-goals-principles-metrics.md`](./01-goals-principles-metrics.md).
