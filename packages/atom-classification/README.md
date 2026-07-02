# @0xintuition/atom-classification

Deterministic, plugin-first atom classification engine with explicit runtime modes:

- `client-only`
- `progressive`
- `server-only`

## Core goals

- Stateless package core (no persistence side effects)
- Deterministic output for identical inputs/config/plugins
- Runtime-safe plugin extensibility (manifest validation, dependency order, hook safety)

## Plugin docs

- Plugin authoring guide: `./docs/plugin-authoring.md`
- Canonical output contract (`cpkg-02`) and migration notes:
  `./docs/canonical-output-contract.md`
- Publishable payload boundary: `./docs/publishable-boundary.md`
- Runtime capability matrix: `./docs/runtime-capability-matrix.md`
- JSON-LD type registration and collision policy:
  `./docs/type-registration-and-collision-policy.md`

## Default preset

`defaultClassificationPreset()` currently ships `type-profiles`, `etherscan`,
`isbn`, `lexical`, `plain-text`, `spotify`, `amazon`, `github`, `x`,
`instagram`, `tiktok`, `youtube`, `wikipedia`, `imdb`, and `default-url`
unless the generic website fallback is disabled explicitly.

The preset intentionally shares only cross-domain fallback stages such as
`oEmbed` and generic Open Graph. Domain-aware stages like `domainApi`,
`domainHtml`, and `publicMetadata` stay plugin-scoped so one plugin cannot
accidentally override another plugin's resolver behavior.

Amazon product URLs now use a deterministic server-side `domain-html` stage to
extract stable identity fields such as product name, ASIN, canonical URL,
brand/store name, and primary image. Volatile commerce fields remain out of the
publishable classification boundary.

X post URLs prefer the official X API when `X_BEARER_TOKEN` is configured,
falling back to public metadata, Open Graph, and finally an identity-only sparse
classification. Only trusted rich-public fields from approved source families
are promoted into `resolved.publishable`.

Spotify URLs classify tracks, albums, artists, podcast shows, and podcast
episodes. Podcast shows resolve as `PodcastSeries`; podcast episodes resolve as
`PodcastEpisode`. Both use the app-level `podcast` runtime category so
podcast content does not collapse into the generic `thing` bucket and does not
pollute the existing `song` category used for music recordings.

## Plain-text fallback rules

The default preset now routes deterministic non-URL text through the
`plain-text` plugin as generic `Thing` outputs.

The lexical plugin still exists, but it is now an explicit opt-in path for
offline-verified single words rather than part of the default preset.

## Migration note

Consumers that previously assumed arbitrary plain text would always produce a
`DefinedTerm` with a synthetic `term:*` canonical id must now handle generic
`Thing` results for default plain-text classification. These `Thing` fallbacks
keep a stable canonical classification plus compatibility projection, but they
do not emit a `term:*` identifier or Wiktionary link unless callers explicitly
opt into the lexical plugin.

## Example external plugin

See `@0xintuition/atom-classification-example-plugin` in
`packages/atom-classification-example-plugin`.
