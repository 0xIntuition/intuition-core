# Internal — Evaluation Guide

*Not shared with candidates. How to run and score the take-home in
`assignment.md`.*

## First principles behind the design

- **Test judgment, not labor.** A CTO's scarce skill is committing to a
  direction with incomplete information and being right about what *not* to
  build. Hence one contested fork, hard time caps, and an optional code part.
- **The fork is genuinely contested on purpose.** We internally lean Path A
  (developer community). We do NOT grade on matching that. A candidate who
  argues Path B rigorously and names what it costs beats one who guesses A
  and hand-waves. Calibrate interviewers on this before scoring.
- **The widget is the hidden synthesis test.** The strongest answers notice
  the widget *bridges* the fork: it is Path-A-style distribution (one-paste,
  organic, "Powered by Intuition" loop) aimed at Path-B-style partners
  (Spotify/Polymarket archetypes). Candidates who treat Part 3 as disconnected
  from Part 2 are missing the systems view.
- **Anchor everything in the repo** so we measure comprehension of *our*
  system, not generic startup talk. "Generic roadmaps score zero" is stated in
  the assignment; enforce it.
- **Respect the candidate.** 4–6 hours, no free consulting (we commit not to
  use their partner plan), AI tools allowed but defended live. This protects
  our brand with exactly the senior people we want.

## Scoring

Score each dimension 1–4 (1 = miss, 2 = adequate, 3 = strong, 4 = exceptional).
Written submission first, then adjust after the debrief.

| Dimension | What a 4 looks like | Weight (CTO) | Weight (Lead Eng) |
| --- | --- | --- | --- |
| **Codebase comprehension** | Part 1 worries are specific and real (e.g. the Rust/TS pipeline seam, projections lag, worker retry semantics, docs vs. behavior drift) — not "add tests" | ×1 | ×2 |
| **Strategic reasoning** | Part 2 pick follows from evidence; the reversal condition is measurable; the steelman of the other path is honest enough to sting | ×2 | ×1 |
| **Prioritization / subtraction** | Names things to delete or refuse to build, in this repo, and accepts the cost | ×2 | ×1.5 |
| **Product sense (widget)** | Partner choice has a believable "why they say yes"; identifies the data-coverage prerequisite (a widget over an empty graph is a demo, not a product); sees the brand/growth loop | ×1.5 | ×1 |
| **Technical depth (widget hardening)** | Engages the real constraints: no-auth + `*` CORS survives because data is public, but needs rate limiting/abuse controls; CDN cache vs. freshness of trust numbers; the forever-pasted `v1.js` versioning problem; where widget-api lives relative to Core | ×1.5 | ×2 |
| **Communication** | Memos are decision documents: position up front, evidence, costs, next steps | ×1.5 | ×1 |
| **Debrief under pushback** | Defends with evidence, concedes with reasons, never bluffs about the code | ×1.5 | ×1.5 |

Rough bar: weighted average ≥ 3.0 → advance; 2.5–3.0 → discuss; < 2.5 → pass.

## Strong signals

- Ran the stack and reports something they *saw* (explorer throughput, a
  worker failure mode), not just something they read.
- Sequenced answer to the fork with a real trigger ("A until a partner signs a
  paid LOI; the Kafka backbone is a two-quarter build we start only then").
- Notices deterministic IDs are a strategic asset for both paths (local dev
  parity for A; integration guarantees for B) — that's reading the README
  closely and thinking.
- In Part 3, addresses partner-side incentives (what Spotify's PM gets) and
  the cold-start data problem, not just our side.
- Asks us a sharp question mid-week.

## Red flags

- Roadmap that never names a file, service, or crate.
- Chooses both paths ("we can do A and B") without sequencing or cost.
- Widget hardening list that "adds auth" reflexively without noticing the
  public-data/no-auth design is intentional — shows they didn't read the brief.
- Over-delivers massively (20 pages, big PR) — ignores constraints; that's a
  signal about how they'll treat team constraints too.
- In debrief, defends every point regardless of evidence, or folds instantly.

## CTO vs Lead Engineer

Same assignment, different weighting (table above) and different debrief focus:
for **CTO**, spend the debrief on Part 2 and the partner strategy; for **Lead
Engineer**, spend it on Part 1 worries and the Part 3 hardening list, and treat
Part 4 (code artifact) as a soft expectation rather than optional.

## Process / next steps

1. **Pilot internally**: have one of us do the assignment cold, timed, to
   validate the 4–6h cap and find ambiguities. Fix, then freeze the text.
2. **Re-export the widget screenshot** from the card-playground embed pages
   into `assets/market-widget.png` (the brief references it).
3. **Package for sending**: `assignment.md` + `widget-brief.md` + the asset.
   The evaluation guide never leaves this repo.
4. Send with a named contact for questions and a scheduled debrief slot at
   send time (forces the time-box to be real).
5. Two scorers per submission, score independently before comparing; debrief
   run by one scorer + one observer.
6. After 2–3 candidates, revisit the rubric weights against what actually
   differentiated them.
