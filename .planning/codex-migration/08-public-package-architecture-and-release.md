# Public package architecture and release plan

## Outcome

The public packages repository becomes the shared semantic and transaction boundary between applications and Core. Core should integrate published, exact-pinned packages; it should not copy the private monorepo implementation or maintain local lookup tables.

Repository: `/Users/metasudo/workspace/intution/workspace/packages` ([GitHub](https://github.com/0xIntuition/packages))

## Target package ownership

| Package | Owns | Must not own |
| --- | --- | --- |
| `@0xintuition/iid` | grammar, parse/serialize, profiles, canonicalization, scheme registry types, conformance vectors | classifications, provider clients, contract calls |
| `@0xintuition/classifications` | schema.org classifications and declarative identity ladders | parser implementations or network resolution |
| `@0xintuition/iid-registry` | IID-to-classification lookup, provider plans, identifier hints, profile selection | provider I/O or persistence |
| `@0xintuition/ids` | on-chain atom/triple term ID calculation | semantic identity interpretation |
| `@0xintuition/primitives` | canonical high-level atom/triple builders | duplicated IID maps or raw contract transports |
| `@0xintuition/protocol` | consumer ABI, encoders, readers/writers, event decoders, URI configuration | deployed bytecode source |
| `@0xintuition/react` | ergonomic URI-aware hooks over protocol | alternate transaction semantics |
| `@0xintuition/deployments` | network addresses and optional activation metadata | Core-local devnet lifecycle |

`ids` and `iid` are intentionally separate: `iid` identifies an external entity in canonical bytes; `ids` hashes atom/triple bytes into protocol term IDs.

## Required package work

### `iid`

- Port and harden the private grammar implementation.
- Export stable types for scheme, profile, parsed IID, normalization result, and typed errors.
- Make parsing split only the first two colons.
- Publish a closed scheme registry and canonicalization behavior.
- Export machine-readable conformance vectors through a supported package export.
- Test P0/P1/P2, canonical round trips, unsafe Unicode, invalid schemes, and values containing colons.
- Keep the module pure and runtime-neutral.

### `classifications`

- Reconcile its current declarative identity ladders with `iid` types.
- Remove duplicate local scheme/class/typing definitions when that can be done without a circular dependency.
- Complete schema.org coverage needed by the registry, including provenance for generated classification data.
- Add reverse lookup tests from classification to candidate identity recipes.
- Decide and document whether identity ladders are public stable API or generated internal data exposed through the registry.

### `iid-registry`

- Implement total `classificationForScheme` and value-aware `classificationForIid` behavior.
- Implement `providersForScheme`, `providersForIid`, and `identifierHintsForIid`.
- Express P0 eligibility and P1/P2 profile selection explicitly.
- Preserve provider ordering and desired-capability semantics.
- Return `undefined` classification for genuinely polymorphic/unmapped cases while still returning safe resolver hints.
- Port the private decision fixtures and make every supported scheme explicit in a matrix test.

### `primitives`

Add one canonical builder seam, tentatively:

```ts
type AtomAnchor = {
  iid: string
  data: `0x${string}`
  atomId: `0x${string}`
  classification?: string
  providerPlan: readonly string[]
  contextUris: readonly string[]
}

buildAtomAnchor(input, options): AtomAnchor
```

The final API may differ, but it must satisfy these contracts:

- use the registry to select the profile;
- emit canonical IID bytes exactly once;
- calculate the matching atom ID through `ids`;
- produce an ordered, deduplicated, contract-valid URI manifest;
- support an explicit legacy JSON mode during migration;
- expose structured validation failures before transactions are submitted.

Replace or adapt the existing `buildAtom` path, which currently assumes JSON-LD classification output and validates only JSON object atom data.

### `protocol`

- Update the ABI to the URI-enabled contract release.
- Expose `createAtomsWithUris` and matching encoders/simulators.
- Expose `AtomContextRegistered` event decoding.
- Expose `AtomUriConfig`/`getAtomUriConfig` reads.
- Assert tuple/array shape parity, ordered URI preservation, and empty URI behavior.
- Keep existing `createAtoms` APIs additive and supported for compatibility.

### `react`

- Add an additive URI-aware atom-creation hook or extend the existing hook with a backward-compatible discriminated input.
- Validate lengths and URI limits before wallet interaction.
- Return simulation/revert details suitable for product UI.
- Keep the existing non-URI method usable during the compatibility period.

### `deployments`

Update only if the release needs ABI activation metadata or changed addresses. Core-local devnet addresses remain owned by Core. If activation blocks are added, define a network-aware shape and test it against Core's Rindexer start blocks.

## Core integration boundary

Core should use packages at these seams:

| Core area | Public dependency |
| --- | --- |
| atom parser | `iid` |
| classification worker | `iid`, `iid-registry` |
| enrichment worker | `iid`, `iid-registry`, `classifications` as needed for output schemas |
| KG term-ID actions | `ids` through thin Core wrappers |
| seed/preparation code | `primitives`, `iid-registry` |
| contract clients and ABI consumers | `protocol` |
| UI transaction adapters, if present | `react` or `protocol` |

No Core service may add a private scheme-to-classification or scheme-to-provider table. A lint/architecture test should scan for known scheme lists outside allowed package adapters.

## Contract ABI source-of-truth rule

There are currently two relevant layers:

- `@0xintuition/contracts-v2` owns Solidity source and deployable artifacts.
- `@0xintuition/protocol` owns the public consumer ABI and helpers.
- Core's `packages/contracts` owns local devnet deployment and synchronized artifacts.

The release gate is byte-for-byte ABI semantic parity between the exact `contracts-v2` version and `protocol`. Core may retain its ABI synchronization workflow for Rindexer, but CI must compare functions, events, inputs, indexed fields, and tuple components against the public protocol ABI. A mismatch blocks publishing or Core adoption.

## Proposed release train

Exact versions must be chosen by the package release owner. A coherent prerelease train would be:

| Order | Package | Proposed version | Reason |
| --- | --- | --- | --- |
| 1 | `iid` | `0.1.0-alpha.0` | new package |
| 2 | `classifications` | `0.1.0-alpha.1` | unreleased identity ladder work plus shared types |
| 3 | `iid-registry` | `0.1.0-alpha.0` | new bridge; depends on 1–2 |
| 4 | `ids` | unchanged unless exports/behavior change | term hashing is conceptually stable |
| 5 | `primitives` | `0.1.0-alpha.1` | canonical builder and IID support |
| 6 | `protocol` | `3.1.0` | additive URI ABI and APIs |
| 7 | `react` | `0.1.0-alpha.1` | URI-aware hook, if included |
| 8 | `deployments` | bump only if data changes | avoid empty releases |

Update the repository's hard-coded pack/smoke package lists and publish order to include `iid` and `iid-registry` in topological order. Require exact internal dependency pins.

## Release verification

For every package:

1. Run its build, typecheck, tests, schema checks, and lint.
2. Run repository-wide pack dry-run and packed-tarball smoke tests.
3. Inspect `npm pack --json` contents and exports; source-only files are not an API.
4. Install all packed tarballs together in a clean temporary consumer.
5. Run the shared conformance fixture through public exports only.
6. Compare protocol ABI to the exact contracts artifact.
7. Publish in dependency order with provenance and immutable exact versions.
8. Verify registry metadata, tarball integrity, export resolution, and installation from NPM.

## Core's 14-day release-age policy

Core enforces a 14-day minimum package age. New IID packages and new versions cannot be adopted in a normal production lockfile on publication day.

Use a two-lane process:

- **Integration lane:** test clean packed tarballs from the package repository in temporary worktrees and CI. Do not commit `file:` or Git dependencies.
- **Release lane:** publish prereleases, monitor them for 14 days, then commit exact NPM versions to Core after all gates pass.

The preferred solution is to let the release age. An emergency exception must be time-bounded, explicitly approved, and removed after the soak. The current package-name-based exclusion mechanism is broader than a single version, so it is not the default migration strategy.

## Package track exit gate

The package track is complete when a clean consumer using only packed/public exports can build the golden IID anchor, derive the expected classification and provider plan, calculate the expected atom ID, encode URI-aware atom creation, decode the resulting context event fixture, and reproduce the same outputs in Core.
