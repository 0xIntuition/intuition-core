# Live package-join board: next 24 hours

Status: active integration control plane; see the authoritative Core completion stack in [17-core-cutover-completion-plan.md](./17-core-cutover-completion-plan.md)

Package/Core snapshot: 2026-08-12 19:48 UTC / 12:48 PDT

Package source inspected read-only: `/Users/metasudo/workspace/intution/workspace/packages`

Umbrella release PR: [0xIntuition/packages#15](https://github.com/0xIntuition/packages/pull/15)

This board is the operational companion to [the 24-hour execution plan](./14-24-hour-parallel-execution.md). It records what is verifiably available now, what exists only on an open child branch, and what has not been built. Recheck the package repository, PRs, and NPM immediately before every join because this is a live release train.

## Executive state

- **J01 can begin in a draft Core worktree** against a clean `@0xintuition/iid@0.1.0-alpha.0` tarball built from integration commit `501b770cedaae8a40672204fc5f96069bc1426c7`.
- **J02 can begin as a packed-tarball draft.** Classification reconciliation and `@0xintuition/iid-registry@0.1.0-alpha.0` are merged into the clean integration branch at `d1aebd3`; Core's DTOs and switches are ready, but the switches are not wired into runtime behavior.
- **J03a is implemented and green in Core** against the already-published and aged `@0xintuition/ids@0.1.0-alpha.0`; exact known answers cover UTF-8, raw hex, IID-shaped strings, legacy JSON, and triples. **P06-P07 are now implemented and green in the local packages worktree**, so J03b has moved from API-blocked to review/commit and packed-export conformance.
- **J04 can pack both producer APIs now.** `@0xintuition/primitives@0.1.0-alpha.1` is merged at `6a484dc`, while the URI-aware `@0xintuition/protocol@3.1.0` helper is implemented in the local integration worktree. The remaining package-side gate is an immutable reviewed commit and publication, not helper design.
- **No new IID package can enter Core's normal lockfile today.** NPM returned `E404` for `@0xintuition/iid`, `@0xintuition/iid-spec`, `@0xintuition/iid-registry`, `@0xintuition/classifications@0.1.0-alpha.1`, `@0xintuition/primitives@0.1.0-alpha.1`, and `@0xintuition/protocol@3.1.0` at the snapshot time. Packed-tarball work is development evidence, not a publish substitute.

## Verified release-train snapshot

The committed package integration base is `update/v1.1.0-alpha` at `6a484dc`; the active working copy contains the uncommitted P06-P07 and release-gate changes described below. Package release evidence must still come from a clean detached worktree at the exact reviewed commit being tested.

| Item | Verified state | Commit / branch | Operational meaning |
| --- | --- | --- | --- |
| Public `main` | clean reference | `46cd2f0` / `main` | Does not contain the IID release train. |
| Umbrella PR 15 | remote draft CI is green; local committed integration branch plus uncommitted P06-P07 work | `update/v1.1.0-alpha` at `6a484dc` -> `main` | Integration base contains P00-P05; P06-P07 and release-gate changes must be split/reviewed/committed and are not assumed released. |
| P00 / PR 16 | merged into integration branch | child head `5e05256`; integration commit `2de35cc` | Release registry, pack/smoke tooling, and planning are committed. |
| P01 / PR 17 | merged into integration branch | child head `3a7a4ee`; integration commit `be96936` | `iid-spec@0.1.0-alpha.0` source and 145 conformance vectors are committed, but unpublished. |
| P02 / PR 18 | merged into integration branch | child head `338bf79`; integration commit `501b770` | `iid@0.1.0-alpha.0` source and inspection API are committed, but unpublished. |
| P03 / PR 19 | merged into integration branch | integration commit `9f208ef` | Public classification/IID type ownership is now an integration-branch contract; consumer tarball evidence is still required. |
| P04 / PR 20 `iid-registry` | merged into integration branch | integration commit `d1aebd3` | Pure classification, provider-slug, and identifier-hint APIs exist; J02 may begin its thin packed-tarball adapter. |
| P05 IID primitive builder | merged into integration branch | integration commit `6a484dc` | `buildIidAnchor` emits deterministic data/dataHex/id, profile, IID, provider plan, and normalized URI manifest; J04 still requires a clean immutable integration pack containing reviewed P07. |
| P06–P07 protocol URI work | implemented and locally green; not committed/published | local `update/v1.1.0-alpha` worktree on `6a484dc` | Exact contracts-v2 artifact sync/provenance, `createAtomsWithUris`, URI-config read, and URI event/context helpers pass tests, artifact drift checks, build, pack, and clean tarball smoke. Review and split/land the changes before consumer adoption. |
| P08 FeeProxy | conditional | planned branch `feat/protocol-fee-proxy-uris` | Not on the direct MultiVault critical path. |
| P09 React URI flow | planned, not built | planned branch `feat/react-atom-uris` | Not a Core join dependency. |

P03-P05 are part of the integration branch; P06-P07 are applied but still uncommitted. J02 must consume public packed exports, map registry results into Core-owned DTOs, and persist exact package provenance; it must not copy registry tables into Core. J04 can exercise local P05/P07 tarballs now, but production adoption still requires reviewed immutable producer SHAs and eligible published versions.

## Verified versus planned public APIs

| Package/API | State | Safe consumer assumption |
| --- | --- | --- |
| `@0xintuition/iid-spec@0.1.0-alpha.0` | committed on integration branch; unpublished | Normative fixture/source input for conformance; not an installable NPM dependency yet. |
| `@0xintuition/iid@0.1.0-alpha.0` | committed on integration branch; unpublished | `inspectIntuitionId` and the types below are verified at `501b770`; use only a clean tarball until publication. |
| `@0xintuition/classifications@0.1.0-alpha.1` | merged into integration commit `9f208ef`; publication not assumed | Use only a clean integration-branch tarball until publication/age eligibility. |
| `@0xintuition/iid-registry@0.1.0-alpha.0` | merged into integration commit `d1aebd3`; publication not assumed | `classificationForIid`, `providersForIid`, and `identifierHintsForIid` are available as pure public APIs; use a clean tarball for draft integration. |
| `@0xintuition/primitives@0.1.0-alpha.1` IID anchor builder | merged into integration commit `6a484dc`; unpublished | `buildIidAnchor` is ready for clean packed-tarball consumption; full writer adoption waits for reviewed/landed P07 and publication. |
| `@0xintuition/ids@0.1.0-alpha.0` | existing and published 2026-06-15 | `calculateAtomId`, `calculateTripleId`, and `calculateCounterTripleId` are verified public exports and have passed Core's 14-day age window. |
| `@0xintuition/protocol@3.1.0` URI APIs | implemented in the local integration worktree; unpublished | `createAtomsWithUris`, encoding, `getAtomUriConfig`, `AtomContextRegistered`/config parsers, and creation-context joining are available for packed-tarball conformance; do not treat them as released until landed and published. |

## Exact IID inspection contract

The following union is verified in `packages/iid/src/types.ts` at integration commit `501b770`:

```ts
type IidInspection =
  | {
      readonly valid: true
      readonly iid: IntuitionId
      readonly scheme: SchemeName
      readonly value: string
      readonly class: 'A' | 'B' | 'C'
      readonly typing: 'unambiguous' | 'polymorphic'
      readonly anchorEligible: boolean
      readonly anchorIneligibilityReason?: 'class-c' | 'polymorphic-scheme'
    }
  | {
      readonly valid: false
      readonly reason: 'malformed' | 'unknown-scheme' | 'noncanonical'
      readonly scheme?: string
      readonly value?: string
      readonly canonical?: IntuitionId
    }
```

`inspectIntuitionId(input)` is a synchronous, offline export. It recognizes the full IID grammar, requires a registered scheme, checks canonical form, and reports P0 anchor eligibility. The valid `iid` field is the canonical IID. `profile` is intentionally absent: P0/P1/P2 describes an atom representation, not the normalized identity.

Do not substitute these nearby APIs:

- `isIntuitionId`/`parseIntuitionId` recognize registered shape but do not prove canonical form.
- `validateIntuitionId` proves canonical validity but discards the inspection metadata Core needs.
- `canonical` on an invalid `noncanonical` result is a read-repair hint, not permission to accept a new write.

### Exact mapping into Core

| Public valid inspection / adapter input | Core `NormalizedAtomIdentity` | Rule |
| --- | --- | --- |
| original function input | `raw` | Preserve byte-for-byte string input passed to inspection. |
| `inspection.iid` | `canonical` | Direct mapping; never reconstruct locally. |
| `inspection.scheme` | `scheme` | Direct mapping; no Core prefix/scheme table. |
| `inspection.value` | `value` | Direct mapping; values may contain additional colons. |
| no inspection field | `profile` | Omit. Set only when a later public builder/representation parser supplies P0/P1/P2 context. |
| `inspection.class` | `class` | Direct optional persistence mapping. |
| `inspection.typing` | `typing` | Direct optional persistence mapping. |
| `inspection.anchorEligible` | `anchorEligible` | Direct mapping. Do not derive from class/typing in Core. |
| `inspection.anchorIneligibilityReason` | `anchorIneligibilityReason` | Copy when present; omit otherwise. |
| adapter build metadata | `provenance.producer` | Fixed value `@0xintuition/iid/inspectIntuitionId`. |
| exact consumed package version | `provenance.version` | Fixed value `0.1.0-alpha.0` for this tarball/release; assert against the exported package manifest. |
| exact normative fixture version | `provenance.specificationVersion` | Use `@0xintuition/iid-spec@0.1.0-alpha.0` when the adapter has verified that corpus; otherwise omit. |

The adapter should be this thin:

```ts
function toCoreIdentity(raw: string, inspection: IidInspection): NormalizedAtomIdentity | null {
  if (!inspection.valid) return null

  return {
    raw,
    canonical: inspection.iid,
    scheme: inspection.scheme,
    value: inspection.value,
    class: inspection.class,
    typing: inspection.typing,
    anchorEligible: inspection.anchorEligible,
    ...(inspection.anchorIneligibilityReason
      ? { anchorIneligibilityReason: inspection.anchorIneligibilityReason }
      : {}),
    provenance: {
      producer: '@0xintuition/iid/inspectIntuitionId',
      version: '0.1.0-alpha.0',
      specificationVersion: '@0xintuition/iid-spec@0.1.0-alpha.0',
    },
  }
}
```

Invalid inspections do not become `NormalizedAtomIdentity`:

| Invalid reason | Core read behavior | Core write behavior |
| --- | --- | --- |
| `malformed` | Preserve legacy parser fallback and bounded reason metrics. | Reject as IID; never promote `raw_type='iid'` or `iid`. |
| `unknown-scheme` | Preserve legacy fallback; do not invent a scheme mapping. | Reject as IID. |
| `noncanonical` without repair | Preserve diagnostic/fallback. | Reject as IID. |
| `noncanonical` with `canonical` repair | A separately designed historical-read path may re-inspect the returned canonical value and record repair provenance. | Reject the original new write; never silently canonicalize it into an anchor. |

## Tarball and publication gate

### Current registry fact

At 2026-08-10 19:41 UTC, `npm view` returned `E404` for all three new package names: `@0xintuition/iid`, `@0xintuition/iid-spec`, and `@0xintuition/iid-registry`. `@0xintuition/ids@0.1.0-alpha.0` is published and reported integrity `sha512-ILFtC1ldVBvQsLGMZ9Tu+rY+VpUYJFqczFbQD/tMTi0vjBjbRoF8LJ/j8iaTJhJOvqBB3yx7sC/dRsAGaEwwwQ==`.

### Gate T1 — producer commit

- [ ] Package owner supplies a clean detached worktree at the exact integration commit.
- [ ] `git status --short` is empty; do not pack an unmerged child branch as if it were the integration release.
- [ ] Record commit SHA, package name/version, build tool versions, tarball filename, shasum, integrity, and unpacked file list.
- [ ] Re-run the package's unit, typecheck, Biome, conformance, package-registry, pack-dry-run, and clean-tarball smoke gates.

For J01 today, the producer SHA is `501b770cedaae8a40672204fc5f96069bc1426c7` and the expected tarball name is `0xintuition-iid-0.1.0-alpha.0.tgz`.

### Gate T2 — clean Core consumer

- [ ] Install the supplied tarball in a disposable Core worktree or temporary clean consumer.
- [ ] Import only the package's declared public entrypoint; never import `src/` or workspace aliases.
- [ ] Run the shared valid, malformed, unknown, noncanonical, colon-bearing, Class C, and polymorphic fixtures.
- [ ] Compare outputs against the package conformance corpus and Core DTO expectations.
- [ ] Do not commit a tarball, `file:` dependency, Git dependency, workspace link, or tarball-resolved lockfile.

### Gate T3 — publish

- [ ] Merge the completed package train through PR 15 and publish in topological order: `iid-spec`, `iid`, updated classifications, `iid-registry`, updated primitives, protocol, then React.
- [ ] After each publish, verify `npm view <name>@<version> version dist.integrity dist.tarball time --json` and install it in a clean consumer.
- [ ] Record the immutable integrity and the timestamp when Core's 14-day minimum-release-age window ends.
- [ ] Use exact package versions in Core; update the shared lockfile once in a coordinated package-join PR.
- [ ] No join PR becomes normally mergeable before the version is published and age-eligible. A time-bounded exception requires separate Core maintainer and security/release approval; it is not implied by this 24-hour sprint.

## PR-ready join lanes

### J01 — IID parser adapter

Status: **ready for draft implementation from a clean P02 tarball; publish/age gated for normal merge**

Owner: parser/worker engineer. Required review: public IID owner plus KG persistence owner.

Branch/PR: `feat/core-iid-parser-adapter`, one focused PR against the active Core integration branch.

Steps:

- [ ] Pass T1/T2 for `@0xintuition/iid@0.1.0-alpha.0` at `501b770`.
- [ ] Add IID inspection before generic URL/plain-string fallback, delegating all recognition and canonicalization to `inspectIntuitionId`.
- [ ] Map only `valid: true` results through the exact adapter above.
- [ ] Keep invalid results backward compatible; persist bounded reason codes without storing raw IIDs in metrics.
- [ ] Populate `CompactParseResult.kind='iid'` and `identity`; promote `rawType='iid'` and canonical `iid` atomically only after valid inspection.
- [ ] Keep remote fetch disabled for IID/custom schemes and preserve legacy JSON, HTTP(S), IPFS, ENS, address, ISBN, and string paths.
- [ ] Keep `WORKERS_IID_READ_ENABLED` default off; prove disabled behavior is byte-compatible.
- [ ] After T3 and release-age eligibility, add the exact NPM dependency and coordinated lockfile update; remove all temporary tarball setup.

Checks:

- IID package conformance vectors and public-entrypoint import.
- Atom-parser fixture suite, worker tests/typecheck/Biome, database-KG tests.
- Known valid ISRC, colon-bearing value, `int:src:*` unknown scheme, repairable noncanonical, Class C, and polymorphic cases.
- Assertion that `profile` is absent unless a representation-aware public API supplies it.
- Assertion that atom ID/raw data do not change during recognition.

Stop conditions: any locally added IID grammar/scheme table, different canonical output, invalid input promoted to IID, raw IID used as search text, or package provenance mismatch.

### J02 — semantic registry, classification, and identifier-first enrichment

Status: **ready for packed-tarball draft from integration commit `d1aebd3`; publication/age gated for normal merge**

Owner: semantic adapter/enrichment engineer. Required review: classifications owner, registry owner, provider-runtime owner.

Branch/PR: `feat/core-iid-semantic-adapter`; do not open with hand-authored mappings.

Steps:

- [ ] Require PR 19 to merge, then require a clean reviewed `classifications@0.1.0-alpha.1` tarball from the new integration head.
- [ ] Require a clean `iid-registry@0.1.0-alpha.0` tarball and freeze its classification/provider/hint result types.
- [ ] Map registry output into Core `IdentityClassificationDecision` and `IdentityProviderPlan`; registry owns every scheme/value decision and provider ordering.
- [ ] Preserve explicit `classified`, `unmapped`, and `ambiguous` outcomes without converting them to `Unknown` guesses.
- [ ] Translate provider capabilities/hints into existing Core clients; add no provider HTTP client to the public registry package.
- [ ] Carry identity, decision, plan, errors, skips, and provenance across persisted worker handoffs.
- [ ] Keep `WORKERS_IID_RESOLUTION_ENABLED` default off and retain partial-artifact/all-retryable completion semantics.
- [ ] Plug in the public resolved-projection API only when it exists; until then leave IID `dataResolved/searchText` projection unplugged.

Checks:

- Registry totality over all public schemes and classification-slug existence.
- Golden ISRC classification/provider order; polymorphic WD; value-narrowed MBID/OLID/CAIP-19; explicit unmapped ISWC.
- No network I/O from classification/registry packages.
- Worker deserialization compatibility, retry/partial behavior, bounded metrics, and no raw identifiers in labels.
- Packed public exports only; exact provenance versions persisted.

Stop conditions: registry package absent, provider/classification maps copied into Core, private `AtomCategory` leaked into public contracts, provider slug mismatch, or resolved projection lacks deterministic provenance.

### J03 — public IDs and protocol parity

Status: **J03a implemented and verified; P06/P07 unblock J03b locally, with immutable packed-export parity still required**

Owner: protocol/KG parity engineer. Required review: IDs owner, Solidity contract owner, Core indexer owner.

Branch/PRs:

1. `refactor/core-public-id-wrappers` — independent J03a.
2. `feat/core-public-protocol-uri-parity` — J03b after P07.

J03a steps:

- [x] Exact-pin the already-aged `@0xintuition/ids@0.1.0-alpha.0`.
- [x] Replace duplicate KG atom/triple hashing bodies with thin `calculateAtomId`/`calculateTripleId` wrappers while preserving Core boundary normalization and exported names.
- [x] Compare string UTF-8 and hex-byte paths, including canonical IID strings and legacy JSON.
- [x] Update the lockfile once and run the supply-chain guard.

J03b steps:

- [ ] Require clean P06 artifact provenance and a packed `protocol@3.1.0` P07 API.
- [ ] Compare exact function/event/error signatures against contracts-v2, Core vendored ABI, and Rindexer ABI.
- [ ] Verify `createAtomsWithUris(address,bytes[],uint256[],bytes[][])`, `getAtomUriConfig`, `AtomContextRegistered`, and legacy `createAtoms` parity.
- [ ] Add calldata/receipt fixtures proving URI order/duplicates/opaque bytes and `termId` association without log adjacency.
- [ ] Do not couple direct MultiVault readiness to conditional FeeProxy P08.

Checks:

- Known-answer atom/triple IDs for UTF-8, hex, IID, legacy JSON, and triples.
- Package tests, database-KG tests, ABI drift checks, Rindexer Rust tests, TypeScript/Rust typechecks, supply-chain guard.
- Atom ID identical when URI context changes.

Stop conditions: any ID mismatch, ABI mismatch, Git/file dependency, URI included in ID material, or event association by log position.

### J04 — canonical builder, seed, and writer validation

Status: **P05 integrated at `6a484dc`; P07 is locally implemented, so writer integration is blocked on review/publication rather than API availability**

Owner: seed/writer integration engineer. Required review: primitives owner, protocol owner, Core reader owner, release owner.

Branch/PR: `test/core-iid-builder-writer-harness` first; production writer changes remain separate and gated.

Steps:

- [ ] Prepare a package-neutral golden harness now: canonical valid ISRC input, expected profile, bytes, atom ID, ordered URI bytes, classification decision, provider plan, and receipt events.
- [ ] Require packed P05 primitive builder and P07 protocol helper; freeze their public result/input shapes before wiring writers.
- [ ] Feed builder output directly into protocol simulation/encoding without reserializing identity or URI arrays in Core.
- [ ] Compare predicted atom ID to public IDs output and decoded receipt term ID.
- [ ] Prove URI manifest changes do not alter atom data or ID and that outer data/assets/URI arrays stay aligned.
- [ ] Exercise empty URI lists, configured limits, duplicates/order, unsafe UTF-8 bytes, simulation failure, and replay.
- [ ] Keep every production writer flag off until URI ingestion, KG/API/Explorer reads, search/display, rollback, and backfill gates pass.
- [ ] Inventory every real writer and seed pipeline; no second ad hoc IID serializer may remain.

Checks:

- Clean-tarball Node and Bun harness using public exports only.
- Seed dry run and deterministic manifest snapshot.
- Protocol calldata decode and receipt association by `termId`.
- Core legacy JSON/createAtoms regression suite and end-to-end reader fixture.
- Writer-disabled deployment smoke and rollback exercise.

Stop conditions: builder API not frozen, P0 emitted for Class C/polymorphic identities, URI context affects ID, a production writer bypasses the builder, or reader gate is incomplete.

## 24-hour ownership and handoff cadence

| Time | Package/release owner | J01 owner | J02 owner | J03 owner | J04 owner |
| --- | --- | --- | --- | --- | --- |
| Hour 0–4 | Pack P01-P05 from `6a484dc`; implement P06 | Implement thin inspection adapter behind the real flag | Implement registry DTO mapping | Keep J03a green; review P06 ABI | Freeze package-neutral fixture and pack P05 |
| Hour 4–10 | Complete P06 and implement P07 | Complete parser/KG conformance | Add identifier-hint/provider-plan adapter | Begin J03b against packed P07 | Build protocol/builder harness |
| Hour 10–16 | Run P10 clean-room package conformance | Rebase after adapter review | Complete provider coverage and retry tests | Complete ABI/calldata/event parity | Complete deterministic writer dry run |
| Hour 16–20 | Complete P11 docs and P12 release evidence | Full legacy/IID regression | Full worker/provider regression | Full TypeScript/Rust/ABI regression | End-to-end golden fixture; writers remain off |
| Hour 20–24 | Decide publish readiness; record integrities/timestamps | Join Core completion stack | Join API/context reader evidence | Join protocol parity evidence | Final no-Docker gate and deferred-environment ledger |

The integration/release owner updates this board at each package merge or publish. Replace snapshot facts rather than appending contradictory status notes.

## Final join checklist

- [ ] Every consumed API is linked to a committed package SHA and packed public export.
- [ ] P03/P04/P05/P07 are clearly either landed or still blocking their join.
- [ ] Tarball names, shasums, integrities, and producer SHAs are recorded.
- [ ] NPM publication metadata and 14-day eligibility timestamps are recorded.
- [ ] Core contains no Git, `file:`, workspace, tarball, or source-path dependency.
- [ ] All package versions are exact and appear once in the coordinated lockfile.
- [ ] J01/J02/J03/J04 tests pass independently and as one golden end-to-end fixture.
- [ ] Legacy JSON, URL, IPFS, string, and `createAtoms` behavior remains supported.
- [ ] Reader/resolution/writer switches remain off until their named gates pass.
