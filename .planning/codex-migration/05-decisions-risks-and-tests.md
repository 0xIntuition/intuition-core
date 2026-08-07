# Decisions, risks, and acceptance tests

## Decisions to lock in the opening session

| ID | Decision | Recommended default | Why it blocks parallel work |
| --- | --- | --- | --- |
| D1 | IID specification/package version | Pin an exact version and registry hash; treat canonicalization as frozen | Every writer and reader must produce the same bytes |
| D2 | Formal spec status | Ratify the current grammar/profile rules or explicitly name exceptions before default writes | Planning notes and formal package status are not fully aligned |
| D3 | P0 allowlist | Start with implemented, unambiguous routes such as ISRC; expand per scheme | “Unambiguous” in the IID package does not guarantee Core taxonomy/resolver readiness |
| D4 | Shared interpretation schema | Use one versioned contract across parser, worker, services, API, and seed | Prevents each track inventing incompatible IID state |
| D5 | Serializer | Pin canonical UTF-8/JSON serialization and version it in the seed ledger | Atom IDs are byte-sensitive |
| D6 | URI policy | Preserve raw bytes; define allowlisted schemes, ordering, normalization, privacy, and public API shape | Contract URIs are opaque and can contain unsafe or non-text data |
| D7 | Contract route | Choose direct `createAtomsWithUris` or approved fee-proxy path per client | Changes approvals, simulation, fees, and receipt parsing |
| D8 | Context limits | Read contract config and use lower/equal client limits | Defaults are configurable, not constants to duplicate forever |
| D9 | Legacy handling | Dual-read indefinitely; additive computed identifiers; no automatic remint | Existing on-chain bytes cannot be migrated |
| D10 | Identity indexing | Non-unique IID membership plus a cluster key | P0/P1/P2 atoms with one IID are expected to coexist |
| D11 | Canonical roles | Separate identity-canonical anchor from display-canonical enriched member | Stable claim targets and rich rendering have different goals |
| D12 | Provider policy | Registry-first resolver order, cache TTLs, credentials, quotas, and provenance requirements | Network behavior must not leak into deterministic identity logic |
| D13 | Seed write boundary | Define whether the control plane writes KG only or submits on-chain; require a mint manifest either way | Avoids a gap between prepared bytes and actual contract arrays |
| D14 | Equivalence scope | Exact same-IID clustering only in the cutover; candidate/attested cross-scheme merges later | Keeps a two-day switch achievable and reversible |

## Major risks and mitigations

### Contract and ABI drift

**Risk:** Core, the SDK, and the app compile against different MultiVault interfaces. The current Core ABI is pre-URI, and older transaction guidance is also stale.

**Mitigation:** publish one artifact, generate all bindings from it, record bytecode/deployment metadata, and enforce ABI drift in CI. Use receipt fixtures from the deployed version.

### Wrong event correlation

**Risk:** a consumer associates context with the previous `AtomCreated` log. Batch emission order makes that incorrect.

**Mitigation:** join exclusively on indexed `termId`, make late projection safe, and include interleaved batch fixtures.

### Invalid examples becoming production data

**Risk:** `int:src:132456798` is copied into tests or seed output.

**Mitigation:** only construct IIDs through `@0xintuition/iid`, keep negative tests for unknown `src`, and use canonical ISRC test vectors.

### Treating API data as identity

**Risk:** a provider redirect, outage, mutable name, or local ID changes atom bytes or the selected IID.

**Mitigation:** hard separation between pure canonicalization/ladder evaluation and resolver execution. Provider output is a versioned artifact/equivalence candidate only.

### P0 overreach

**Risk:** a scheme is technically marked unambiguous but Core lacks a precise taxonomy mapping, or a polymorphic IID is minted bare.

**Mitigation:** use a product P0 allowlist narrower than `isAnchorEligible`, require P1 for polymorphic schemes, and make taxonomy gaps explicit in the scheme matrix.

### Descriptive regressions

**Risk:** moving description off-chain yields blank cards/search until enrichment completes.

**Mitigation:** render the IID and resolver state immediately, hydrate asynchronously, reuse shared artifacts for equal IIDs, retain cached results, and define provider-miss fallbacks. P1 carries minimum display/evidence where P0 is not valid.

### URI abuse and privacy

**Risk:** opaque event bytes contain secrets, tracking URLs, malicious schemes, oversized render content, or non-UTF-8 data.

**Mitigation:** preserve raw data privately, decode safely, allowlist network resolvers, strip tracking only in a derived normalized field, cap public output, and never automatically fetch arbitrary schemes/private network targets.

### Accidental uniqueness constraint

**Risk:** a unique database index on `iid` rejects valid P1/P2 or legacy members that should join an identity cluster.

**Mitigation:** index IID for lookup, make membership idempotent within a node/source role, and represent clusters separately.

### Seed re-projection of immutable writes

**Risk:** bumping the seed projection silently changes IDs for jobs already written or minted.

**Mitigation:** distinguish candidate/prepared/submitted/on-chain states, reproject only safe states, produce an old/new diff, and backfill/cluster immutable results.

### Resolver cost and rate limiting

**Risk:** replay/backfill sends one provider request per node and exhausts quotas.

**Mitigation:** cache by stable resolver target, coalesce equal-IID work, rate-limit per provider, batch where supported, and stage rollout by scheme.

### Ontological-level merges

**Risk:** ISBN editions are automatically treated as the same node as a book work, or a recording is merged with its composition.

**Mitigation:** preserve each classification's `identifies` level, treat cross-level mappings as claims/candidates, and never merge merely because labels/providers are similar.

## Cross-stack acceptance matrix

| Fixture | Expected interpretation | Expected downstream behavior |
| --- | --- | --- |
| P0 canonical ISRC | valid A/unambiguous, `MusicRecording` | resolve by ISRC, accept context hints, searchable hydrated card |
| `int:src:132456798` | unknown scheme, invalid | new write rejected; historical atom preserved/quarantined |
| ISRC with separators/lowercase inside an already-minted IID | non-canonical IID | new write rejected; historical bytes not silently rewritten |
| P0 `int:wd:Q42` | syntactically valid IID but profile-invalid because polymorphic | classification unresolved/invalid-profile; no automatic P0 mint |
| P1 Wikidata person | valid A/polymorphic with payload type | `Person` accepted as payload-asserted; Wikidata resolver may corroborate/conflict |
| P1 `gen1` movie with exact recipe fields | valid C/unambiguous, P1 required | recipe re-derives IID; no external resolver required |
| P0 `gen1` | profile-invalid | reject new mint even though type is embedded in value |
| P0 CAIP-19 ERC-20 | valid B/unambiguous | classify token asset; chain/metadata resolution is retryable |
| P1 CAIP-10 contract | valid B/polymorphic with type | resolve chain state; account/contract distinction retained |
| Legacy JSON-LD music recording + Spotify `sameAs` | legacy profile | existing classification/enrichment still works; backfill may derive ISRC if evidence supports it |
| Legacy IPFS JSON | legacy profile | current remote parsing continues; derived IID remains additive |
| Plain string | legacy profile | no false IID detection |
| IID value containing colons | valid when scheme canonicalizer accepts it | parser splits first two colons only |
| Unknown registered-future-looking scheme | invalid under closed registry | no forward-compatible pass-through |
| Non-ASCII or >256-byte IID | invalid | write rejected; historical input visible with error |
| Empty URI list | no context event | atom processing completes normally |
| Five max-length URI byte values under current defaults | contract-valid | raw bytes round-trip and API output is bounded |
| URI count/length over live config | preflight and contract failure | no partially submitted batch; actionable error |
| Duplicate URI values | preserved as event evidence | resolution work may deduplicate safely |
| Binary/non-UTF-8 URI | valid opaque event bytes | lossless storage, no unsafe fetch, decode error recorded |
| Multi-atom URI batch | context events emitted after atom/deposit events | every URI set joins by `termId` correctly |
| Replayed context block | same input twice | no duplicate typed/projection rows |
| Reorged context event | canonicality changes | derived context projection follows established reorg policy |
| Same IID in P0 and P1 | two atom IDs, one identity cluster | P0 identity-canonical; richer/attested member eligible for display-canonical |
| Provider timeout/429 | identity/classification remain complete | resolution retries with provider-specific backoff |
| Provider permanent miss | valid atom with unresolved display | explicit terminal resolver status; no identity mutation |
| Seed repeated twice | identical output | IID/profile/bytes/URI order/expected ID all match |

## End-to-end go/no-go assertions

The integration lead should be able to answer “yes” to all of these from automated output:

1. Did exact submitted bytes produce the expected on-chain atom ID?
2. Did all context URIs join the correct term by `termId` and survive a replay?
3. Did the parser select the expected profile and use the pinned registry version?
4. Did classification complete without a network dependency?
5. Did resolver failure leave identity stable and retryable?
6. Can the API distinguish atom payload, identity, context, and enrichment provenance?
7. Can search/render work after enrichment while old clients still use `dataResolved`?
8. Did legacy fixtures remain unchanged?
9. Did equal IIDs cluster without deleting or overwriting either atom?
10. Can flags restore the old write behavior without a destructive database rollback?

## Known documentation/package drift to resolve

- The formal IID specification is labeled `0.1.0 — Draft` while planning material also describes several format decisions as ratified/stable. Record the release decision before enabling default writes.
- The current Core dependency on `@0xintuition/classifications@0.1.0-alpha.0` is not automatically the same as the `intuition-v2` workspace implementation that depends on `@0xintuition/iid`.
- Some planning checklists still mark P0 builder/indexer/backfill phases incomplete. This migration should not assume those implementations exist merely because the specification does.
- Older transaction guidance describes atom creation without URI context. Generate operational docs from the shipped ABI after the upgrade.

