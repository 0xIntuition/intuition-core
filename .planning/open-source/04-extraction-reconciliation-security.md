# 04 — Extraction, Reconciliation & Security

> How code moves from the private monorepo to the public repos, how we keep them in sync without
> forking our workflow, and how we guarantee we never leak a secret.

---

## 1. The core tension

The backend services are **developed and deployed from the private monorepo** (`intuition-v2`): prod
images build from its Dockerfiles via GHCR → `gcp-deployment` → ArgoCD. We cannot simply fork the
code to a public repo and let it drift, because production depends on the private copy. We also
cannot stop shipping while we open-source. So we need a reconciliation model that lets us publish on
schedule **without destabilizing prod**, and an end-state that **eliminates drift**.

The `packages` repo precedent does **not** solve this for us: it declared the public repo canonical
for public package sources and kept any private→public sync tooling out of its docs (it sidesteps the
problem with a generated-from-spec model). The services tier has real running code in the private
repo, so we need an actual mechanism. That mechanism is net-new and is decision **D2**.

## 2. Reconciliation model (D2)

**Recommended: mirror during transition → cut over at the end.**

### Phase A — One-way scrubbed mirror (during the program)
- Keep developing in the monorepo. Nothing about daily workflow changes.
- A **sync script** (git `subtree split` of `backend/<svc>` + `packages/<pkg>` paths, or a filtered
  export) produces a scrubbed snapshot pushed to the public repo on a cadence (e.g. per release, or
  weekly).
- Every mirror push runs through the **secret-scrub gate** (§4) and a **diff review** before it lands
  on the public `main`. A human approves the first several; later ones can be PR-gated automation.
- Pro: publish on schedule, zero risk to prod, controlled surface. Con: temporary dual-home; mirror
  lag to manage (tracked as a health metric).

### Phase B — Cut over build source (end-state, post-launch)
- Once a component is proven in public, move its **source of record** to `0xIntuition/node` and have
  the deploy pipeline build that component's image from the public repo (or consume it as a
  submodule/subtree of `intuition-v2`).
- Pro: public repo is genuinely canonical; we dogfood it; drift is structurally impossible. Con:
  requires repointing the deploy build source — a `gcp-deployment` / CI change that needs care.

**Why not "public canonical from day one"?** It's the cleanest end-state but the riskiest *start*:
repointing the prod build source at the same time as the first public push couples two risky changes.
Mirror-first decouples them. We arrive at the same place, safely.

> **This decision touches the production deploy pipeline and needs explicit CTO + platform sign-off
> before Phase 3.** It is the single highest-coordination item in the program.

### Identity-sensitive freeze (carried from the `packages` model, principle P1)
Anything that affects derived bytes is frozen and review-gated on publish: classification slugs,
predicate keys, parser output shapes, schema URLs, atom/triple ID derivation. A change here is an
*identity fork* and must be documented as such (issue + PR + migration note) before it ships —
exactly as `packages` treats schema URLs and predicate specs today.

## 3. Per-component scrub checklist (the blockers from [02 §7])

Each component must be clean before it leaves the gate:

**Rust indexer / projections / embeddings:**
- [ ] Remove hardcoded `rpc.intuition.systems` fallback in `rindexer-ingestion/src/main.rs`.
- [ ] Parameterize diagnostics binaries (RPC URL as arg/env, not hardcoded testnet).
- [ ] Remove dev Alchemy key + Caldera URL from `.env.example`; replace with placeholders.
- [ ] Parameterize contract address / chain ID / start block (env-only).
- [ ] Vendor `curves` crate into `node` (resolve `../../../curves` path-dep).
- [ ] Feature-gate embeddings; document the provider seam; OpenAI as default reference, off by default.
- [ ] Resolve the single→dual DB-pool inconsistency (`DATABASE_KG_URL` / `DATABASE_TIMESCALE_URL`) or document it.
- [ ] Strip internal Linear ticket refs (ENG-XXXX) from comments/READMEs.

**TS API / services / workers:**
- [ ] Add `backend/api` README; document `@0xintuition/protocol` chain coupling.
- [ ] Make Stripe/billing optional (auth must boot with null Stripe secrets).
- [ ] Document OAuth setup (Google/GitHub/Apple) — deployer supplies own creds; default off.
- [ ] Confirm `/api/test` stays gated behind `E2E_API_ENABLED`.
- [ ] Standardize the workers Dockerfile workspace-copy pattern.
- [ ] Ensure all classification/enrichment provider keys (X, Spotify, Etherscan, Brandfetch, Google
      GenAI) are optional with graceful degradation.

**Every repo:**
- [ ] MIT `LICENSE` (matches `packages`).
- [ ] `.env.example` with placeholders only.
- [ ] No internal hostnames, partner URLs, or provenance.
- [ ] `bun.lock` / `Cargo.lock` reviewed for private registry refs.

## 4. Security gate (non-negotiable — principle P4/G4)

A publish does not happen unless **all** pass:

1. **Secret scan on the working tree** — `gitleaks` / `trufflehog` clean.
2. **History scan** — scan the *full git history* of any path being exported. If the monorepo history
   ever contained a secret on these paths, the export must be a **squashed/filtered snapshot** (fresh
   history), not a subtree carrying old commits. Default to fresh history for the first publish of
   each component.
3. **Dependency / supply-chain gate** — reuse `guard:supply-chain`; `bun install --frozen-lockfile`;
   no Git-URL deps, lifecycle install scripts, or `trustedDependencies` added (per repo policy).
4. **Manual diff review** — a named reviewer eyeballs the first export of each component for anything
   the scanners miss (internal URLs in comments, customer names, internal architecture references).
5. **CI for outsiders** — `id-token: write` / publish creds isolated to reviewed release jobs only;
   no `pull_request_target` workflows that execute untrusted PR code (per repo policy).

This gate runs on the **mirror push** in Phase A and on the **release workflow** in Phase B.

## 5. What stays private (recap from [02 §6])

`gcp-deployment` (cluster/secrets/ArgoCD), internal deploy workflows (publish a sanitized CI
reference only), `experimentation` (GrowthBook), `e2e-financial` internal harnesses, billing/Stripe
flows, `@0xintuition/authentication` internals, `.planning/` + `.agents/` + Linear refs, partner RPC
keys and all credentials.

## 6. Reconciliation tooling to build (Phase 0/2)

- `scripts/oss-sync/<component>.sh` — subtree-split or filtered-export per component.
- `scripts/oss-sync/scrub.sh` — strip Linear refs, internal URLs, swap `.env` for `.env.example`.
- `scripts/oss-sync/gate.sh` — run gitleaks + trufflehog + supply-chain guard; fail closed.
- A `RECONCILIATION.md` in `node` (modeled on `packages/docs/reconciliation.md`): what's canonical
  where, what's frozen, how a mirror push is reviewed.

---

Continue to [`05-documentation-plan.md`](./05-documentation-plan.md).
