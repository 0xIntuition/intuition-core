# Intuition Core — Technical Leadership Take-Home

*For CTO and Lead Engineer candidates. Please read the whole document before starting.*

---

## Why this assignment looks the way it does

We are not testing whether you can write code under a timer. We are testing the
thing the job actually is: **reasoning about a real system with real trade-offs
and committing to a direction you can defend.** Everything below is anchored in
our actual open-source codebase — [`intuition-core`](https://github.com/0xIntuition/intuition-core) —
and in a real product decision we are facing right now. There is no hidden
"correct" answer we are matching you against. We grade the quality of the
reasoning, the specificity of the plan, and your willingness to say what you
would *not* do.

**Time expectation:** 4–6 focused hours, spread over up to one week. Do not
polish; a sharp memo beats a beautiful deck. Using AI tools (Claude, Cursor,
etc.) is fine and expected — but you must be able to defend every claim live,
and we will push on them in the debrief.

**Deliverables (all three parts):**

1. A short **state-of-the-system note** (½–1 page)
2. A **direction memo** answering the strategic fork (2–3 pages)
3. A **widget product brief** (1–2 pages)
4. *Optional:* one small code artifact (cap it at 2 hours — see Part 4)

Submit as markdown or PDF, plus a link to any code. We will then do a 60–90
minute live debrief where we challenge your positions.

---

## Part 0 — Context: what Intuition Core is

Intuition Core is the open-sourced Intuition backend — "the open backend, in a
box." One `docker compose up` gives you a self-hosted shard of the Intuition
knowledge graph:

- **Chain ingestion** (Rust): `crates/rindexer-ingestion` indexes the
  MultiVault contract into a TimescaleDB event store; `crates/projections`
  turns events into read models and knowledge-graph tables.
- **Atom intelligence pipeline** (TypeScript/Bun): `services/workers` runs the
  parse → classify → enrich pipeline; `services/atom-services` exposes it over
  HTTP. Classification has **17 built-in URL plugins** (GitHub, Spotify,
  Wikipedia, X, …) and enrichment has **36 provider plugins** — the keyless set
  (OpenGraph, JSON-LD, Wikipedia, Wikidata) works with zero API keys.
- **Query API** (`services/api`): the read/write HTTP API over the KG database.
- **Explorer** (`apps/explorer`): a built-in dashboard — service health, worker
  pipeline throughput, live atoms/triples/events.
- **Deterministic IDs**: the atom ID you derive locally is the exact ID the
  protocol registers onchain — publishing is a state change, not a migration.

The minimal stack requires **zero paid accounts**, including chain indexing
(the Intuition testnet RPC is public and keyless). Start with `README.md`,
`docs/architecture.md`, and `docs/data-model.md`.

---

## Part 1 — Get oriented (~1 hour)

Clone the repo, stand the stack up (`README.md` quick start), and watch data
flow through the explorer. Skim the docs and the code at whatever depth you
need.

**Deliverable — state-of-the-system note (½–1 page):**

- What is this system genuinely good at, as built?
- What are the two or three things that most worry you (architecture, ops,
  DX, security — your call)?
- One thing you would change in the first month, and why that one.

If you can't get the stack running, say so and what you tried — the failure
mode itself is data, and the rest of the assignment does not depend on it.

---

## Part 2 — The fork in the road (the core question)

Intuition Core can only be optimized for one master over the next 12 months.
These are the two real paths in front of us:

### Path A — The developer community path

Optimize Core for **an expansive, organic developer community**: easy to run,
lightweight, hackathon-friendly. Every decision favors time-to-first-atom on a
laptop: fewer moving parts, fewer required services, better defaults, better
docs, a plugin API that a stranger can ship against in an afternoon. Growth
comes from many small integrations and builders who pick Intuition because it
was the easiest knowledge graph to start with.

### Path B — The enterprise path

Optimize Core for **a handful of large, sophisticated operators** and paid
APIs/services. Think partners like Spotify or Polymarket who want to augment
their existing catalog or database with Intuition's knowledge graph and
serve an enhanced experience to their customers. This path means things like an
advanced Kafka-based messaging backbone, many more enrichments and plugins,
multi-tenant concerns, SLAs, and a generally more intricate architecture that
few people run but which carries serious traffic and revenue.

### What we want from you — the direction memo (2–3 pages):

1. **Pick a path.** (A sequenced argument — "A now, B at trigger X" — is
   allowed, but a trigger is a measurable condition, not a vibe.)
2. **Ground it in the code.** Name the concrete changes to *this repo* your
   path implies in the first 90 days — which services, crates, or packages
   change, what gets added, and crucially **what gets deleted or explicitly
   not built**. Generic roadmaps score zero; `services/atom-services` and
   `crates/projections` are real code you can point at.
3. **The road not taken.** What does your choice cost us? Steelman the other
   path in one honest paragraph.
4. **How you'd know.** 3–5 metrics that would tell you within two quarters
   whether the bet is working, and what reading would make you reverse.
5. **Team shape.** Roughly what team (size and skills) executes this, and
   what you would do personally in month one.

---

## Part 3 — The widget: a product on top of Core

We have prototyped an **embeddable Intuition widget** — a way to carry the
knowledge graph onto any third-party website in one paste. The full brief with
the embed API, widget variants, and architecture of the prototype is in
[`widget-brief.md`](./widget-brief.md). Read it; it is short and self-contained.

The headline: a site drops in

```html
<div class="intuition-widget"
  data-type="item"
  data-id="0x91ab…02ce"
  data-variant="market"
  data-theme="dark"></div>
<script async src="https://embed.intuition.systems/v1.js"></script>
```

and gets a live, style-isolated card — identity, a live Trust/TVL sparkline,
supporter avatars, and a **Trust CTA** — stamped *Powered by Intuition*, backed
by a purpose-built read-only widget API over the same KG database Core ships.

**The question:** How would you use this widget to grow Intuition — and **which
partner would you approach first and build a prototype for?** (Polymarket and
Spotify are examples of the archetype, not constraints.)

**Deliverable — widget product brief (1–2 pages):**

1. **The growth thesis.** What loop does the widget create? Who sees it, what
   do they do, and how does that compound for Intuition? Be explicit about
   whether the widget serves your Part 2 path, the other one, or bridges them.
2. **The partner.** Name one first partner, what *their* users get on day one,
   and why the partner says yes. What data does the graph need to contain for
   the prototype to be genuinely useful rather than a demo?
3. **Prototype to production.** The prototype is a scaffold. List, in order,
   what it takes to make this real: hardening the widget API (it is currently
   no-auth, permissive-CORS, CDN-cached by design — what survives, what
   doesn't?), latency and freshness, abuse/embedding risks, versioning a
   script third parties have pasted and will never update, and how it lands in
   or beside `intuition-core`.
4. **The first 30 days.** A concrete sequence from "today" to "widget live on
   the partner's site," including the non-engineering steps.

---

## Part 4 — Optional code artifact (max 2 hours)

If — and only if — it strengthens your argument, ship one small thing.
Examples: a new enrichment or classification plugin (see
`docs/writing-an-enrichment-plugin.md`), a widget-serving endpoint sketch on
`services/api`, a Compose profile that supports your Part 2 direction, or a
mock widget for your chosen partner. A rough PR with a clear description beats
a polished one with none. Skipping this part carries no penalty.

---

## The debrief

60–90 minutes, live. You walk us through the direction memo (10 min), then we
argue: we will take the opposite side of your Part 2 pick, poke at your partner
choice, and go deep on one technical claim from your Part 3 hardening list.
We are evaluating how you reason under pushback — changing your mind for a good
reason scores *up*, not down.

## Ground rules

- The repo is public; your submission stays private to the hiring team.
- We are hiring, not sourcing free strategy — we cap your time, and we will
  not use your specific partner plan unless you join us and build it.
- Questions during the week are welcome and free: ask them the way you would
  as CTO — good questions are signal too.
