import { slugify, toStringMaybe, tryParseUrl, withPlatformMetadata } from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';

export type SpotifyPluginOptions = PlatformV0PluginOptions;
const SPOTIFY_PLUGIN_ID = 'spotify';
const SPOTIFY_RESOURCE_TYPES = ['track', 'album', 'artist', 'show', 'episode'] as const;
type SpotifyResourceType = (typeof SPOTIFY_RESOURCE_TYPES)[number];

export const spotifyProfile: PlatformV0Profile = {
	domain: 'spotify',
	supportsOEmbed: true,
	classifier: {
		id: 'spotify-url-classifier',
		priority: 10,
		classify(input: string) {
			const parsed = tryParseUrl(input);
			if (!parsed || !parsed.hostname.endsWith('spotify.com')) {
				return null;
			}

			const segments = parsed.pathname.split('/').filter(Boolean);
			if (segments.length < 2) {
				return null;
			}

			const resourceType = segments[0];
			const resourceId = segments[1];
			if (!resourceType || !resourceId) {
				return null;
			}

			if (!isSpotifyResourceType(resourceType)) {
				return null;
			}

			return {
				type: 'url' as const,
				domain: 'spotify',
				subtype: resourceType,
				confidence: 0.99,
				meta: {
					resourceType,
					resourceId,
					canonicalUrl: `https://open.spotify.com/${resourceType}/${resourceId}`,
				},
			};
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		if (classification.subtype === 'track') {
			const resourceId = toStringMaybe(classification.meta.resourceId) ?? '';
			const name =
				toStringMaybe(classification.meta.trackName) ?? `Spotify Track ${resourceId}`.trim();
			const byArtist = toStringMaybe(classification.meta.byArtist);
			const inAlbum = toStringMaybe(classification.meta.inAlbum);
			return withPlatformMetadata(
				{
					schemaType: 'MusicRecording',
					category: 'song',
					title: name,
					canonicalId: `spotify:track:${resourceId || slugify(canonicalUrl)}`,
					sameAs: [canonicalUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'MusicRecording',
						name,
						sameAs: [canonicalUrl],
						...(byArtist
							? {
									byArtist,
								}
							: {}),
						...(inAlbum
							? {
									inAlbum,
								}
							: {}),
					},
				},
				'spotify',
				classification.subtype,
				{
					pluginId: SPOTIFY_PLUGIN_ID,
					provider: 'spotify',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
				}
			);
		}

		if (classification.subtype === 'album') {
			const resourceId = toStringMaybe(classification.meta.resourceId) ?? '';
			const name =
				toStringMaybe(classification.meta.albumName) ?? `Spotify Album ${resourceId}`.trim();
			const byArtist = toStringMaybe(classification.meta.byArtist);
			return withPlatformMetadata(
				{
					schemaType: 'MusicAlbum',
					category: 'song',
					title: name,
					canonicalId: `spotify:album:${resourceId || slugify(canonicalUrl)}`,
					sameAs: [canonicalUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'MusicAlbum',
						name,
						sameAs: [canonicalUrl],
						...(byArtist
							? {
									byArtist,
								}
							: {}),
					},
				},
				'spotify',
				classification.subtype,
				{
					pluginId: SPOTIFY_PLUGIN_ID,
					provider: 'spotify',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
				}
			);
		}

		if (classification.subtype === 'artist') {
			const resourceId = toStringMaybe(classification.meta.resourceId) ?? '';
			const name =
				toStringMaybe(classification.meta.artistName) ?? `Spotify Artist ${resourceId}`.trim();
			return withPlatformMetadata(
				{
					schemaType: 'MusicGroup',
					category: 'song',
					title: name,
					canonicalId: `spotify:artist:${resourceId || slugify(canonicalUrl)}`,
					sameAs: [canonicalUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'MusicGroup',
						name,
						sameAs: [canonicalUrl],
					},
				},
				'spotify',
				classification.subtype,
				{
					pluginId: SPOTIFY_PLUGIN_ID,
					provider: 'spotify',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
				}
			);
		}

		if (classification.subtype === 'show') {
			const resourceId = toStringMaybe(classification.meta.resourceId) ?? '';
			const name =
				toStringMaybe(classification.meta.showName) ?? `Spotify Show ${resourceId}`.trim();
			return withPlatformMetadata(
				{
					schemaType: 'PodcastSeries',
					category: 'podcast',
					title: name,
					canonicalId: `spotify:show:${resourceId || slugify(canonicalUrl)}`,
					sameAs: [canonicalUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'PodcastSeries',
						name,
						url: canonicalUrl,
						sameAs: [canonicalUrl],
					},
				},
				'spotify',
				classification.subtype,
				{
					pluginId: SPOTIFY_PLUGIN_ID,
					provider: 'spotify',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
				}
			);
		}

		const resourceId = toStringMaybe(classification.meta.resourceId) ?? '';
		const name =
			toStringMaybe(classification.meta.episodeName) ?? `Spotify Episode ${resourceId}`.trim();
		return withPlatformMetadata(
			{
				schemaType: 'PodcastEpisode',
				category: 'podcast',
				title: name,
				canonicalId: `spotify:episode:${resourceId || slugify(canonicalUrl)}`,
				sameAs: [canonicalUrl],
				data: {
					'@context': 'https://schema.org/',
					'@type': 'PodcastEpisode',
					name,
					url: canonicalUrl,
					sameAs: [canonicalUrl],
				},
			},
			'spotify',
			classification.subtype,
			{
				pluginId: SPOTIFY_PLUGIN_ID,
				provider: 'spotify',
				fetchedAt: now,
				sourceUrl: canonicalUrl,
				confidence: classification.confidence,
			}
		);
	},
};

function isSpotifyResourceType(value: string): value is SpotifyResourceType {
	return SPOTIFY_RESOURCE_TYPES.includes(value as SpotifyResourceType);
}

export function createSpotifyPlugin(options: SpotifyPluginOptions = {}) {
	return createPlatformPlugin({
		pluginId: 'spotify',
		resolverId: 'spotify-resolver',
		profile: spotifyProfile,
		options,
	});
}

export type { SpotifyDomainApiAdapter, SpotifyDomainApiAdapterOptions } from './domain-api-adapter';
export { createSpotifyDomainApiAdapter } from './domain-api-adapter';
