# Track 3 — IID recognition and classification

## Mission

Make canonical IID a first-class atom raw type and derive safe semantic classification without network calls or duplicated scheme tables.

## Owner and reviewers

- Primary: Core parser/classification engineer
- Reviewers: packages semantic owner, database owner, enrichment owner

## Work packages

1. Add IID to parser/domain/database raw-type definitions.
2. Recognize IID before generic URL and string branches using public `iid`.
3. Persist raw input, canonical IID, profile, scheme, value, parser version, and validity/status.
4. Add typed failures while preserving the raw on-chain value for invalid/lookalike inputs.
5. Add classification branch through `iid-registry` with explicit source/version.
6. Represent unknown and polymorphic classification honestly.
7. Keep legacy structured/raw classifier branches unchanged for non-IIDs.
8. Backfill existing candidate `int:` atoms in resumable chunks.
9. Add parity tests using public fixture exports and database round trips.
10. Delete local scheme/classification tables only after all callers migrate.

## Ordering contract

```text
raw bytes -> UTF-8 candidate -> IID recognition/canonicalization
          -> otherwise existing JSON/HTTP/IPFS/string detection
```

Recognition is not resolution. This track must never call Spotify, MusicBrainz, chain RPCs, or other providers.

## Acceptance

- All valid golden IIDs round-trip canonically and values containing colons remain intact.
- Invalid or unregistered schemes do not become trusted IID identities.
- Classification equals registry behavior for all schemes and is absent where ambiguous.
- Existing non-IID parser/classifier fixtures are unchanged.
- Live and backfill processing produce the same persisted representation.

## Handoff

Track 4 receives a versioned canonical identity record, not an arbitrary string. Track 5 can expose recognition state before resolution completes.
