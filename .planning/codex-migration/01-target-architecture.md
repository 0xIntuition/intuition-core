# Target architecture and shared contracts

## Architectural boundary

Canonicalization and identity derivation are pure functions. Resolution is a networked, cached, retryable operation. Persistence retains both the immutable evidence and the mutable projection.

```text
                 deterministic / offline                         networked / retryable
  --------------------------------------------------+-----------------------------------
  bytes -> profile -> IID validate -> scheme/type   | resolver target -> provider APIs
                          |                          |          |
                          v                          |          v
              identity row + cluster key            |  raw + normalized artifacts
                                                     |          |
                                                     +----------v
                                                        display/search projection
```

No resolver may participate in IID canonicalization, atom-byte construction, or atom-ID calculation.

## Representation profiles

Consumers must accept all profiles plus legacy data.

| Profile | Atom bytes | Required use | Identity behavior |
| --- | --- | --- | --- |
| P0 anchor | Bare IID string | Class A/B plus unambiguous scheme | Atom ID is a direct function of IID bytes |
| P1 identity context | Stable JSON with `@type`, `identifier`, recipe fields/evidence | Class C or polymorphic schemes | IID joins the identity cluster; payload supplies required type/evidence |
| P2 enriched | P1 plus descriptive fields | Explicit opt-in only | Same cluster as any profile with the same IID |
| Legacy | Existing JSON, IPFS, URL, or string forms | Read/backfill compatibility | May gain a computed IID without changing on-chain bytes |

The parser must not infer P0 eligibility merely because the payload starts with `int:`. It must validate the registered scheme, canonical value, identity class, and typing rule.

## Shared interpretation contract

Freeze a package-level contract before engineers split up. Names are illustrative; the semantics are required.

```ts
type AtomProfile = "p0" | "p1" | "p2" | "legacy";

type ParsedIdentifier = {
  iid: string;
  scheme: string;
  value: string;
  identityClass: "A" | "B" | "C";
  schemeTyping: "unambiguous" | "polymorphic";
  canonical: boolean;
  valid: boolean;
  registryVersion: string;
};

type AtomInterpretation = {
  profile: AtomProfile;
  identifier?: ParsedIdentifier;
  classificationSlug?: string;
  schemaType?: string;
  classificationSource:
    | "iid-scheme"
    | "iid-value"
    | "payload-type"
    | "legacy-classifier"
    | "unresolved";
  confidence: "exact" | "payload-asserted" | "provider-derived" | "unknown";
  contextUris: ContextUri[];
  resolutionTargets: ResolutionTarget[];
  errors: InterpretationError[];
};

type ResolutionTarget = {
  resolver: string;
  key: string;
  source: "iid" | "context-uri" | "payload" | "legacy";
  priority: number;
};
```

Required behavior:

- Generic IID parsing splits only on the first two colons; scheme code owns remaining value structure.
- Unknown schemes and non-canonical values are invalid for new writes, but historical bytes remain indexable and visible.
- P1/P2 `identifier` is validated by the same code as P0.
- The classifier may use deterministic scheme/value structure and a P1/P2 `@type`; it may not call a provider.
- Resolvers accept typed targets rather than scraping meaning back out of an arbitrary URL.
- Context URLs supplement resolution. They are not trusted as identity and must preserve their event provenance.
- The interpretation result is serializable and versioned so workers, seed jobs, and APIs can replay deterministically.

## Resolver interface

Move enrichment plugins from URL-first matching to target-first resolution while retaining URL adapters for legacy atoms.

```ts
interface IdentifierResolver {
  name: string;
  version: string;
  supports(target: ResolutionTarget, atom: AtomInterpretation): boolean;
  resolve(target: ResolutionTarget, context: ResolveContext): Promise<ResolverArtifact[]>;
}

type ResolverArtifact = {
  provider: string;
  sourceUri?: string;
  fetchedAt: string;
  resolverVersion: string;
  rawPayloadRef?: string;
  normalized: Record<string, unknown>;
  identifiers: string[];
  classification?: { slug: string; schemaType: string };
};
```

The resolution cache key should include canonical IID or target key, resolver name/version, and material request parameters. Provider failure changes resolution status, not identity status. Artifacts remain independently refreshable.

For the initial ISRC path:

```text
int:isrc:USRC17607839
  -> exact classification: MusicRecording
  -> target: { resolver: "music-recording/isrc", key: "USRC17607839" }
  -> MusicBrainz lookup and configured Spotify/Apple matching
  -> normalized recording artifact + provider identifiers + provenance
```

Spotify is an enrichment source, not the identity namespace. A Spotify track URL in `AtomContextRegistered` can improve matching but does not replace the ISRC or alter the atom ID.

## Persistence model

Use additive structures. Exact names can be adjusted during the interface freeze.

### Chain event storage

Add a typed event record for `AtomContextRegistered` containing at least:

- chain/network, contract address, block number/hash, transaction hash, log index;
- `term_id`, registrant;
- raw `bytes[]` values without lossy decoding;
- canonical/reorg status and ingestion timestamp.

Normalize each URI into a KG projection such as `kg.node_context_uris` keyed by `(node_id, transaction_hash, log_index, ordinal)`. Store raw hex/bytes, a best-effort decoded string, URI kind, normalized URL when applicable, processing state, and validation error. Duplicate values may be semantically deduplicated for resolution while the original event entries remain intact.

### Identity storage

Prefer a normalized `kg.node_identifiers` table rather than overloading `kg.nodes`:

- `node_id`, `iid`, `scheme`, `value`, identity class, profile;
- canonical/valid flags, registry and interpreter versions;
- source (`payload`, `backfill`, `artifact`, `claim`) and primary flag;
- derivation/evidence reference for Class C or backfilled identities;
- timestamps and processing status.

Use a non-unique index on `iid`. Multiple atoms carrying the same IID are expected and must join a cluster; a database-wide unique `iid -> node` constraint would make P0/P1/P2 coexistence impossible. Enforce idempotency with a key scoped to node, IID, source, and role.

Add identity cluster and member projections when Layer 2 ships. Cluster membership is reversible projection state, never a destructive node merge. Elect identity-canonical and display-canonical nodes separately.

### Compatibility fields

- Preserve `kg.nodes.data`, `data_hex`, and current raw types.
- Add `iid` to the raw-type discriminator or derive profile separately without rewriting old rows.
- Keep `data_resolved` as a materialized compatibility/display projection.
- Keep normalized enrichment in `kg.artifacts` with source URI, content hash, provider, and resolver version.
- Update `search_text` from selected normalized artifact fields while retaining the IID as a searchable token.

## Contract event semantics

The indexer must follow these rules:

1. Sync the ABI from the actual deployed contract artifact.
2. Subscribe to `AtomContextRegistered` from the correct upgrade/deployment block.
3. Join the event to an atom by `termId`; never rely on `AtomCreated` being the previous log.
4. Treat no event as an empty context list, not as ingestion failure.
5. Decode URI bytes only after preserving the raw value.
6. Project idempotently and honor canonical/reorg state during replay.
7. Read `getAtomUriConfig()` in write clients or configuration sync so client limits do not drift from the contract.

## Write path

The canonical mint pipeline is:

1. Enrich source records only enough to find the strongest usable identifier and required P1 evidence.
2. Evaluate the classification identity ladder.
3. Canonicalize and validate with the pinned `@0xintuition/iid` implementation.
4. Select P0/P1/P2 from identity class and scheme typing.
5. Serialize atom bytes with an explicitly versioned deterministic serializer.
6. Calculate the atom ID from those final bytes.
7. Build a bounded, ordered list of context URI bytes.
8. Submit `atomDatas[i]`, `assets[i]`, and `uris[i]` with exact index alignment through `createAtomsWithUris` or its approved proxy route.
9. Record the intended bytes, expected term IDs, URIs, package versions, and transaction result in the seed/mint ledger.

## Read path

API clients should receive a backward-compatible atom plus an optional identity envelope:

```json
{
  "id": "0x...",
  "data": "int:isrc:USRC17607839",
  "dataResolved": { "name": "...", "@type": "MusicRecording" },
  "identity": {
    "iid": "int:isrc:USRC17607839",
    "scheme": "isrc",
    "class": "A",
    "profile": "p0",
    "valid": true,
    "clusterId": "..."
  },
  "contextUris": [],
  "resolution": { "status": "complete", "artifacts": [] }
}
```

Old clients continue to use `dataResolved`; new clients can distinguish identity, context, and refreshable enrichment explicitly.

