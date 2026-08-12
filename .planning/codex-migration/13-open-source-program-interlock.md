# Open-source program interlock

## Why this needs an explicit interlock

The earlier [open-source program](../open-source/index.md) successfully defined and delivered Intuition Core as the public, self-hostable backend. This migration now changes the semantic and protocol contracts that Core exposes. It is therefore both a product migration and maintenance of the open-source promise: an independent operator must reconstruct IID identity and URI context just as faithfully as Intuition's hosted deployment.

The migration does not reopen the old repository-topology decision. `intuition-core` is the public service monorepo; `0xIntuition/packages` is the public reusable TypeScript package repository. It does update several assumptions made when the OSS plan was written.

## Assumptions that must change

| Earlier OSS-plan assumption | New reality | Required update |
| --- | --- | --- |
| Public packages are a completed set of ten and this program need not change them | IID grammar/registry do not exist on NPM; classifications contain unreleased ladder work; protocol 3.0 lacks URI support | Run the coordinated package release in Track 1 |
| Atom intelligence begins from URL/JSON parsing | New default atom data is canonical IID bytes | Make IID recognition the first parser/classification branch |
| Classification plugins infer type from provider URLs/content | Unambiguous IID scheme/profile can classify deterministically | Registry decision precedes plugin/provider resolution |
| Enrichment requires a URL or parsed classification object | Resolver plan can be derived from IID plus context hints | Add identifier-first enrichment and explicit unresolved states |
| Current six events reconstruct the protocol state needed by Core | URI-enabled contracts emit `AtomContextRegistered` | Extend ABI, ingestion, typed storage, replay, and KG projection |
| Explorer/API raw data model is sufficient | Raw IID is meaningful but not presentation-ready; context and resolution need provenance | Add structured identity/context/resolution/display API and UI |
| Public packages and Core are loosely adjacent artifacts | Deterministic identity, builder bytes, IDs, ABI, and event decode cross both repos | Add packed-tarball conformance and ABI parity CI |

## Workstream mapping

| OSS program workstream | Migration continuation |
| --- | --- |
| Atom intelligence libraries | Tracks 1, 3, and 4: IID grammar, semantic registry, parser/classifier/enricher changes |
| Node skeleton/data layer | Tracks 2 and 5: URI tables, identity/artifact projections, indexes and migrations |
| Indexing/projections | Track 2: new event and replay; Track 7: reconstruction proof |
| API/services/workers/explorer | Tracks 3–5: new worker contracts and public read model |
| Security/reconciliation | Tracks 1 and 7: supply chain, ABI parity, URI/SSRF hardening, cross-repo releases |
| Documentation/adoption | Track 7 plus the documentation changes below |

## Public operator contract

The migration is not done when Intuition's hosted stack understands IIDs. A clean external Core operator must be able to:

1. Configure the URI-enabled contract address and activation block.
2. Index both atom creation and atom-context events from chain history.
3. Parse and classify canonical IIDs without private services.
4. Run keyless resolution providers in the minimal tier and see explicit skipped states for credentialed providers.
5. Query raw identity, URI evidence, resolution provenance, and resolved presentation through the public API.
6. Replay the chain range and get the same result.

This becomes the updated independent-reconstruction acceptance test from the OSS program.

## Documentation updates required in Core

Track PRs must update public documentation alongside code:

- `README.md`: explain IID atom data, URI context, and keyless/credentialed resolver behavior.
- `docs/architecture.md`: replace URL/JSON-first semantic flow with recognize -> classify -> resolve -> project.
- `docs/contracts.md`: document URI-enabled version, `createAtomsWithUris`, context event, limits, addresses, and activation blocks.
- API documentation: add identity/context/resolution/display schemas and compatibility notes.
- Explorer/operator docs: explain unresolved/retry states and raw versus normalized context.
- Configuration reference: flags, scheme allowlists, resolver versions, provider controls, and backfill settings.
- Plugin authoring guides: distinguish classification inference from provider resolution; forbid plugins from changing canonical identity.
- Release notes: exact public package versions, database migrations, reindex/backfill instructions, and rollback behavior.

The minimal stack must continue to start with zero paid provider accounts. IID recognition/classification and URI ingestion are fully functional offline; enrichment providers degrade explicitly when credentials are unavailable.

## Repository reconciliation policy

The private `alpha` monorepo remains a proving ground and consumer. It must consume public package outputs once released rather than export code into Core indefinitely.

For every semantic change:

1. Land the reusable contract and fixtures in `0xIntuition/packages`.
2. Validate private application behavior with packed tarballs.
3. Validate Core behavior with the same tarballs and fixtures.
4. Publish exact prereleases and complete supply-chain gates.
5. Adopt eligible NPM versions in both repositories.

Application-specific adapters stay private; shared grammar, mappings, fixtures, and builders move public. CI should detect a private shadow implementation of an exported public function where practical.

## Open-source release gate

In addition to the migration's functional gates, a release candidate must pass:

- a fresh Core bootstrap with documented configuration only;
- full secret/supply-chain checks for newly added packages and provider configuration;
- packed/public dependency installation, with no local workspace assumptions;
- independent reconstruction of the golden transaction and historical event range;
- updated operator documentation reviewed by someone who did not implement the feature;
- exact container/package/contract/fixture versions recorded in release notes.

This preserves the original program thesis: the graph is credibly neutral only when independent operators can reproduce its identity and context, not merely download the code.
