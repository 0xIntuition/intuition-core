import { slugify, toStringMaybe, tryParseUrl, withPlatformMetadata } from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';

type TmdbMediaType = 'movie' | 'tv';

type TmdbTarget = {
	mediaType: TmdbMediaType;
	tmdbId: string;
	canonicalUrl: string;
};

export type TmdbPluginOptions = PlatformV0PluginOptions;

export const tmdbProfile: PlatformV0Profile = {
	domain: 'tmdb',
	supportsOEmbed: false,
	classifier: {
		id: 'tmdb-url-classifier',
		priority: 10,
		classify(input: string) {
			const target = parseTmdbUrl(input);
			if (!target) {
				return null;
			}

			return {
				type: 'url' as const,
				domain: 'tmdb',
				subtype: target.mediaType,
				confidence: 0.99,
				meta: {
					mediaType: target.mediaType,
					tmdbId: target.tmdbId,
					canonicalUrl: target.canonicalUrl,
				},
			};
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		const mediaType = toTmdbMediaType(toStringMaybe(classification.meta.mediaType)) ?? 'movie';
		const schemaType = mediaType === 'tv' ? 'TVSeries' : 'Movie';
		const tmdbId = toStringMaybe(classification.meta.tmdbId) ?? slugify(canonicalUrl);
		const label = mediaType === 'tv' ? 'TMDB TV Series' : 'TMDB Movie';
		const name = `${label} ${tmdbId}`.trim();

		return withPlatformMetadata(
			{
				schemaType,
				category: 'thing',
				title: name,
				canonicalId: `tmdb:${mediaType}:${tmdbId}`,
				sameAs: [canonicalUrl],
				data: {
					'@context': 'https://schema.org/',
					'@type': schemaType,
					name,
					identifier: `tmdb:${mediaType}:${tmdbId}`,
					sameAs: [canonicalUrl],
				},
			},
			'tmdb',
			classification.subtype,
			{
				pluginId: 'tmdb',
				provider: 'tmdb',
				fetchedAt: now,
				sourceUrl: canonicalUrl,
				confidence: classification.confidence,
			}
		);
	},
};

export function createTmdbPlugin(options: TmdbPluginOptions = {}) {
	return createPlatformPlugin({
		pluginId: 'tmdb',
		resolverId: 'tmdb-resolver',
		profile: tmdbProfile,
		options,
	});
}

function parseTmdbUrl(input: string): TmdbTarget | undefined {
	const parsed = tryParseUrl(input);
	if (!parsed) {
		return undefined;
	}

	const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
	if (host !== 'themoviedb.org') {
		return undefined;
	}

	const segments = parsed.pathname.split('/').filter(Boolean);
	const mediaType = toTmdbMediaType(segments[0]);
	const tmdbId = parseTmdbId(segments[1]);
	if (!mediaType || !tmdbId) {
		return undefined;
	}

	return {
		mediaType,
		tmdbId,
		canonicalUrl: `https://www.themoviedb.org/${mediaType}/${tmdbId}`,
	};
}

function toTmdbMediaType(value: string | undefined): TmdbMediaType | undefined {
	if (value === 'movie' || value === 'tv') {
		return value;
	}

	return undefined;
}

function parseTmdbId(value: string | undefined): string | undefined {
	const match = value?.match(/^(\d+)/);
	return match?.[1];
}
