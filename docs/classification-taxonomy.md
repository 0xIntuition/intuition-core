# Classification Taxonomy

This taxonomy defines the first operator-facing domain filters for
IndexingScope. It maps broad presets such as `music` and `podcasts` to schema
types, categories, plugins, and artifacts.

## Domain Map

| Domain | Schema types | Categories | Plugins/providers | Artifacts |
| --- | --- | --- | --- | --- |
| `music` | `MusicRecording`, `MusicAlbum`, `MusicGroup`, `Person`, `WebPage` | track, album, artist, playlist, label, release | Spotify, OpenGraph, JSON-LD, Wikidata, Wikipedia | audio metadata, cover image, artist profile, external IDs |
| `podcast` | `PodcastSeries`, `PodcastEpisode`, `Person`, `Organization`, `WebPage` | show, episode, host, network, feed | Podcast Index, OpenGraph, JSON-LD, Wikidata, Wikipedia | feed metadata, episode metadata, cover image, transcript/source links |

## Preset Expansion

| Preset | Included domains |
| --- | --- |
| `music` | `music` |
| `podcasts` | `podcast` |
| `music-and-podcasts` | `music`, `podcast` |

## Matching Rules

Classification can enter a domain through any of these signals:

- A classifier plugin emits a domain-specific subtype, such as Spotify track or
  podcast feed.
- JSON-LD or OpenGraph metadata maps to a domain schema type.
- Enrichment resolves a provider entity whose canonical type belongs to the
  domain.
- A trusted taxonomy artifact maps an external ID to the domain.

Classification cannot be decided at the chain-event layer. Chain events carry
atom identity and relation data; domain knowledge emerges after parsing and
enrichment.

## Music Scope Requirements

The `music` scope should include:

- Spotify URLs for tracks, albums, artists, playlists, and episodes that are
  classified as music content.
- OpenGraph and JSON-LD fallback for music pages outside Spotify.
- Wikidata/Wikipedia enrichment when available without keys.
- Artifacts needed to render title, artist/creator, album/show, cover image,
  external IDs, and canonical URL.

## Podcast Scope Requirements

The `podcasts` scope should include:

- Podcast Index lookups for shows and episodes when keys are present.
- Feed URL parsing and metadata extraction.
- OpenGraph and JSON-LD fallback for episode pages.
- Artifacts needed to render show title, episode title, host/network, publish
  date, cover image, feed URL, and canonical URL.

## Open Decisions

- Exact schema type names emitted by each classifier should be normalized before
  the validator lands.
- Spotify podcast episodes overlap music-provider infrastructure but should map
  to the podcast domain when the provider metadata identifies them as episodes.
- Query APIs need a stable way to expose domain matches without leaking
  provider-specific implementation details.
