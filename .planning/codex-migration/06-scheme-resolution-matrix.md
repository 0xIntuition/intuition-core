# Scheme classification and resolution matrix

This matrix separates three questions that must not be collapsed:

1. Is the IID valid and canonical? The IID package answers this offline.
2. Does the scheme/value determine a classification? The classification registry answers this deterministically.
3. How is display/enrichment data obtained? A versioned resolver answers this over the network or from cached artifacts.

Identity classes and scheme typing below come from the current IID implementation. “Classification route” describes the required Core route or a gap to close; it is not permission to mint P0 without tests and an approved allowlist.

## Registry matrix

| Scheme | Class | Typing | Classification route | Likely resolver/evidence | Cutover stance |
| --- | --- | --- | --- | --- | --- |
| `isbn` | A | Unambiguous | `Book`; retain edition-vs-work level explicitly | Open Library/ISBN metadata | Implemented taxonomy path; P0 canary after level decision |
| `isrc` | A | Unambiguous | `MusicRecording` | MusicBrainz ISRC lookup; Spotify/Apple matching/context | First P0 vertical slice |
| `iswc` | A | Unambiguous | Musical composition/work; current taxonomy gap | ISWC authority/music metadata | Do not enable P0 until classification exists |
| `isni` | A | Polymorphic | P1 type: person, music group, or organization | ISNI and corroborating registries | P1 only; resolver cohort later |
| `orcid` | A | Polymorphic | P1 `Person` or approved narrower researcher type | ORCID | P1 only |
| `lei` | A | Unambiguous | Legal entity/company; current ladder coverage must be aligned | GLEIF | Close taxonomy/ladder gap before P0 |
| `gtin` | A | Unambiguous | `Product` | GS1/approved product source | P0 after resolver/provider policy |
| `doi` | A | Polymorphic | P1 type: article, dataset, or other DOI object | Crossref/DataCite/provider named by DOI | P1 only |
| `eidr` | A | Unambiguous | Audiovisual work; verify movie/series taxonomy coverage | EIDR and approved media databases | Close taxonomy route before P0 |
| `wd` | A | Polymorphic | P1 `@type` required | Wikidata; Wikipedia links as artifacts | P1 high-value cohort |
| `mbid` | A | Unambiguous | Decode value subtype: artist, recording, release-group, etc.; define unsupported subtypes | MusicBrainz | P0 per supported subtype only |
| `olid` | A | Unambiguous | Decode work/edition/author suffix; keep ontological level | Open Library | P0 per supported subtype only |
| `imdb` | A | Polymorphic | P1 movie/series/person type | IMDb context; TMDB find API where licensed/approved | P1 only |
| `tmdb` | A | Polymorphic | P1 type; value subtype can route but does not remove profile rule | TMDB | P1 only |
| `podcastguid` | A | Unambiguous | `PodcastSeries` | Podcast Index and feed metadata | P0 after feed/GUID policy test |
| `url` | B | Polymorphic | P1 type required | Safe URL fetch, metadata/extraction plugins | Legacy-compatible; P1 only |
| `caip10` | B | Polymorphic | P1 `EthereumAccount` or `EthereumSmartContract` | Chain RPC, explorer, ENS as display evidence | P1 only |
| `caip19` | B | Unambiguous | Current supported asset subtype maps to `EthereumERC20`; future namespaces need routes | Chain RPC/token metadata/CoinGecko | P0 only for supported namespaces |
| `hash` | B | Polymorphic | P1 image/video/content type | Context URI or content-addressed store | P1; never fetch unknown locations blindly |
| `appid` | B | Unambiguous | `MobileApplication` | Apple/Google app stores | P0 after store/resolver policy |
| `purl` | B | Unambiguous | `Software` package | Package registry, deps.dev, source repository | P0 after ecosystem coverage tests |
| `geo` | B | Polymorphic | P1 `Location` or `LocalBusiness` | Geospatial/open place sources and context | P1; candidate matching later |
| `acct` | B | Unambiguous | `SocialMediaAccount` | Platform API/page; immutable ID preferred | P0 only for approved strong value forms |
| `rssitem` | B | Unambiguous | `PodcastEpisode` | Feed item/feed resolver | P0 after container/value tests |
| `termset` | B | Unambiguous | `DefinedTerm` | Owning term-set artifact/context | P0 after term-set lookup exists |
| `gen1` | C | Unambiguous | Decode classification slug; verify exact recipe fields | No required external resolver; P1 evidence is primary | Never P0 |

## Resolver priority rules

For any scheme, build targets in this order:

1. Authoritative/open registry lookup keyed by the canonical IID value.
2. Provider crosswalk discovered from the registry response.
3. Explicit creation-time context URIs.
4. P1/P2 payload evidence.
5. Legacy URLs and previously stored artifacts.

The order is a routing preference, not a truth ranking. Every result retains provenance, and conflicting facts remain visible. A context URI may be tried before a slow registry for latency, but the stored plan and artifact must still say that it was context-derived.

## Classification conflicts

Handle conflicts explicitly:

- For an unambiguous scheme, a contradictory P1/P2 `@type` is an interpretation error and must not overwrite the deterministic route.
- For a polymorphic scheme, P1/P2 supplies the asserted type. A resolver may corroborate it or return a conflict that requires review.
- Provider output cannot make an invalid P0 payload valid after the fact.
- A scheme subtype not supported by the current taxonomy is `unsupported-classification`, not `Thing` by default.
- Cross-level relations—book work versus edition, recording versus composition, release versus release-group—become equivalence/relationship candidates, not silent merges.

## Minimum resolver implementation contract

Each resolver must document:

- accepted scheme/value or context target;
- classification/subtype coverage;
- authentication and legal/licensing constraints;
- request/cache key, TTL, timeout, retry, and rate-limit behavior;
- raw response retention policy and normalized artifact version;
- identifiers/crosswalks it may emit;
- permanent-miss versus retryable-failure rules;
- safe handling of redirects, private network addresses, and content size;
- deterministic mocks and one opt-in live integration test.

## Cohort rollout

Recommended order:

1. `isrc` / MusicRecording — proves the exact user scenario end to end.
2. `wd`, `isbn`, `olid`, `mbid` — broad open-registry coverage and P1/P0 mix.
3. `caip10`, `caip19`, `purl`, `appid`, `podcastguid`, `rssitem` — domain resolvers already suggested by current enrichment capabilities.
4. Remaining authority schemes after taxonomy and licensing decisions.
5. `url`, `hash`, `geo`, and `gen1` specialized behavior, followed by candidate generation/equivalence.

