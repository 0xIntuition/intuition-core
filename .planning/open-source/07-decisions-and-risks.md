# 07 — Decisions & Risks

---

## 1. Decision log

Status: **OPEN** (needs a call) · **REC** (recommended, low controversy) · **DONE**.

### D1 — Repo topology · OPEN (CTO sign-off)
**Question:** One mega-repo, one repo per service, or hybrid?
**Recommendation:** **Hybrid** — extend `0xIntuition/packages` with the atom-intelligence npm libs;
create a new `0xIntuition/node` polyglot monorepo for deployable services + database packages + a
top-level docker-compose. Rationale and alternatives in [03 §1](./03-target-architecture.md).
**Why it matters:** shapes every downstream task. Decide first.

### D2 — Reconciliation & deploy source · OPEN (CTO + platform sign-off)
**Question:** How do public and private stay in sync, and does prod build from the public repo?
**Recommendation:** **Mirror-first, cut-over-later** — scrubbed one-way mirror during the program
(publish safely on schedule), then move the prod image build source to the public repo post-launch so
drift becomes structurally impossible. Detail in [04 §2](./04-extraction-reconciliation-security.md).
**Why it matters:** touches the production deploy pipeline (`intuition-v2` → GHCR → `gcp-deployment`);
highest-coordination item. Do not start Phase 3's cut-over work without this signed off.

### D3 — License · REC
**Recommendation:** **MIT**, matching the published `packages` repo (`Copyright Intuition Systems`).
Consistency with the existing public surface; permissive licensing maximizes adoption, which is the
whole point.

### D4 — Product / repo naming · OPEN (marketing input)
**Recommendation:** `0xIntuition/node` + product framing "Intuition Node / run your own node."
Alternatives: `infra`, `indexer`, `backend`. Note: the marketing subdomain `unchained.intuition.systems`
uses "onchain or off" copy — **"unchained" is not an established product term**; don't adopt it by
default. Keep npm scope `@0xintuition/*`.

### D5 — Embeddings provider coupling · REC
**Recommendation:** ship embeddings **optional and feature-gated**, with a documented provider seam;
OpenAI as the default reference, **off in the minimal tier**. Keeps the zero-paid-account minimal
stack (P4) and avoids forcing a vendor on the community.

### D6 — Atom-parser Rust/TS duality · REC
**Recommendation:** publish **both**. TS `@0xintuition/atom-parser` is the active library builders
reach for; the Rust `atom-parser-service` ships as the reference parity implementation (shared
fixtures prove parity). Sets up a future Rust-native indexer that classifies inline.

### D7 — Database packages: npm vs vendored · REC
**Recommendation:** for v1, vendor `database-kg/timescale/surreal` **inside `node`** so the runnable
stack is self-contained. Publishing them to npm is a fast-follow if external consumers want the
schemas standalone.

### D8 — crates.io for Rust libs · REC (fast-follow)
**Recommendation:** publish `curves` first. Do not publish the monolithic `shared` crate; split it
into narrow public primitives/events crates after v1, with service-local config/DB helpers kept
private. Vendoring `curves` into `node` is sufficient to ship. Track, don't block.

## 2. Risk register

Likelihood × Impact, with the mitigation and where it's handled.

| ID | Risk | L | I | Mitigation | Where |
|---|---|---|---|---|---|
| R1 | **Secret/credential leak** in published code or history | M | High | Mandatory gitleaks + trufflehog gate on working tree **and full history**; fresh-history snapshots for first publish; manual diff review; fail-closed gate | [04 §4](./04-extraction-reconciliation-security.md) |
| R2 | **Public/private drift** — the public repo rots vs. monorepo | M | Med | Mirror cadence + reconciliation tooling; end-state cut-over makes drift structural-impossible; track mirror-lag as a health metric | [04 §2](./04-extraction-reconciliation-security.md) |
| R3 | **Deploy-source cut-over destabilizes prod** | M | High | Mirror-first decouples publish from cut-over; do cut-over post-launch with platform; per-service, not big-bang | D2 |
| R4 | **Stakeholder/moat objection** blocks the program | M | High | The pitch in [00](./00-vision-and-value.md): moat is network + onchain data + token, not code; graph is already public onchain | [00 §3,§5](./00-vision-and-value.md) |
| R5 | **Support burden** overwhelms a small team | M | Med | No SLA; issue-first; rotating OSS-triage duty; plugin model adds contributors, not just consumers; phased surface | [06 §5](./06-roadmap-and-workstreams.md) |
| R6 | **Outsider can't actually run it** (docs gap) | M | High | Documentation acceptance gate: outsider reaches a queried graph unaided before launch | [05 §5](./05-documentation-plan.md) |
| R7 | **OpenAI/provider coupling** forces paid accounts on the community | L | Med | Feature-gate embeddings; all provider keys optional + degrading; minimal tier needs zero paid accounts | D5, P4 |
| R8 | **Identity fork** — a scrub/refactor changes derived bytes | L | High | Determinism freeze + review on all identity-sensitive surfaces; parity fixtures for the parser | [04 §2](./04-extraction-reconciliation-security.md), P1 |
| R9 | **Launch slips / decouples from app launch** narrative | M | Med | Layered phases each independently valuable; can launch libs (Phase 1) early; services follow; buffer week | [06 §2](./06-roadmap-and-workstreams.md) |
| R10 | **Scope creep** into frontend/infra open-sourcing | M | Med | Explicit non-goals; this program is backend services + intelligence libs only | [01 §2](./01-goals-principles-metrics.md) |

## 3. Open questions for the CTO

1. **D1 + D2** — the two decisions that gate the program. Sign off before Phase 0 completes.
2. Is the team comfortable that **prod will eventually build from a public repo** (D2 Phase B), or do
   we want to stay mirror-only indefinitely (accepting managed drift)?
3. Naming + launch-timing alignment with marketing (D4, [06 §6](./06-roadmap-and-workstreams.md)).
4. Who holds **WS-F (Security & Reconciliation)** — it's the hard dependency for every publish.

---

Continue to [`08-master-checklist.md`](./08-master-checklist.md).
