import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getIdentifier, getRequestUrl } from '../__shared__/request';
import { itunesLookupResponseSchema } from './external';
import { appleMusicDataSchema } from './schema';

type CreateAppleMusicPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	country?: string;
};

type AppleMusicTarget =
	| { kind: 'lookup'; id: string; country: string; media?: 'podcast' }
	| {
			kind: 'search';
			term: string;
			media: 'podcast';
			country: string;
			/** Gate: accepted only when the result publisher matches (when given). */
			corroboratePublisher?: string;
	  };

type ItunesLookupResult = {
	wrapperType?: string;
	kind?: string;
	feedUrl?: string;
	trackId?: number;
	collectionId?: number;
	artistId?: number;
	trackName?: string;
	collectionName?: string;
	artistName?: string;
	trackViewUrl?: string;
	collectionViewUrl?: string;
	artistLinkUrl?: string;
	artworkUrl100?: string;
	previewUrl?: string;
	releaseDate?: string;
	trackTimeMillis?: number;
	primaryGenreName?: string;
};

const APPLE_MUSIC_HOST_PATTERN = /(^|\.)music\.apple\.com$/i;
const NUMERIC_ID_PATTERN = /^\d{4,}$/;
const DEFAULT_COUNTRY = 'us';

// Resolves Apple Music targets via the public iTunes Lookup API — no
// credentials required, and song results include a playable previewUrl.
export function createAppleMusicPlugin(
	options: CreateAppleMusicPluginOptions = {}
): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);
	const defaultCountry = options.country ?? DEFAULT_COUNTRY;

	return defineEnrichmentPlugin({
		id: 'apple-music',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['apple-music'],
		priority: options.priority ?? 49,
		TTL: options.TTL ?? 43_200,

		supports(request: EnrichmentRequest) {
			return !!resolveAppleMusicTarget(request, defaultCountry);
		},

		async enrich(request, ctx) {
			const target = resolveAppleMusicTarget(request, defaultCountry);
			if (!target) {
				return [];
			}

			const endpoint =
				target.kind === 'lookup'
					? `https://itunes.apple.com/lookup?id=${encodeURIComponent(target.id)}&country=${encodeURIComponent(target.country)}`
					: `https://itunes.apple.com/search?term=${encodeURIComponent(target.term)}&media=${target.media}&limit=5&country=${encodeURIComponent(target.country)}`;
			const payload = await fetchJsonWithSchema(fetcher, endpoint, itunesLookupResponseSchema, {
				signal: ctx.signal,
			});

			const results = (payload.results ?? []) as ItunesLookupResult[];
			const result =
				target.kind === 'search' ? selectGatedSearchResult(results, target) : results[0];
			if (!result) {
				return [];
			}

			const type = resolveResultType(result);
			const name = resolveResultName(result, type);
			if (!(type && name)) {
				return [];
			}

			const targetId =
				target.kind === 'lookup' ? target.id : String(result.collectionId ?? result.trackId ?? '');
			const appleMusicUrl =
				result.trackViewUrl ??
				result.collectionViewUrl ??
				result.artistLinkUrl ??
				(target.kind === 'lookup' ? getRequestUrl(request) : undefined) ??
				`https://music.apple.com/${target.country}/${type}/${targetId}`;

			return [
				{
					artifact_type: 'apple-music',
					data: appleMusicDataSchema.parse({
						name,
						type,
						appleMusicId: targetId,
						appleMusicUrl,
						artworkUrl: upscaleArtworkUrl(result.artworkUrl100),
						previewUrl: result.previewUrl,
						artistName: result.artistName,
						albumName: type === 'song' ? result.collectionName : undefined,
						releaseDate: result.releaseDate,
						durationMs: result.trackTimeMillis,
						genres: result.primaryGenreName ? [result.primaryGenreName] : undefined,
						feedUrl: result.feedUrl,
					}),
					meta: {
						pluginId: 'apple-music',
						provider: 'apple-music',
						fetchedAt: ctx.now(),
						sourceUrl: appleMusicUrl,
					},
				},
			];
		},
	});
}

function resolveResultType(
	result: ItunesLookupResult
): 'song' | 'album' | 'artist' | 'podcast' | undefined {
	if (result.kind === 'podcast' || result.wrapperType === 'podcast') return 'podcast';
	if (result.wrapperType === 'track' || result.kind === 'song') return 'song';
	if (result.wrapperType === 'collection') return 'album';
	if (result.wrapperType === 'artist') return 'artist';
	return undefined;
}

function normalizeGateText(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[^\p{L}\p{N}]+/gu, ' ')
		.trim();
}

// Search joins are gated (cross-provider-augmentation-spec.md): accept only a
// result whose title matches the searched term, corroborated by publisher
// when one was provided. Blank beats wrong.
function selectGatedSearchResult(
	results: ItunesLookupResult[],
	target: Extract<AppleMusicTarget, { kind: 'search' }>
): ItunesLookupResult | undefined {
	const expectedTitle = normalizeGateText(target.term);
	const expectedPublisher = target.corroboratePublisher
		? normalizeGateText(target.corroboratePublisher)
		: undefined;
	return results.find((result) => {
		const title = result.collectionName ? normalizeGateText(result.collectionName) : '';
		if (title.length === 0 || title !== expectedTitle) return false;
		if (!expectedPublisher) return true;
		const publisher = result.artistName ? normalizeGateText(result.artistName) : '';
		return (
			publisher === expectedPublisher ||
			publisher.includes(expectedPublisher) ||
			expectedPublisher.includes(publisher)
		);
	});
}

function resolveResultName(
	result: ItunesLookupResult,
	type: 'song' | 'album' | 'artist' | 'podcast' | undefined
): string | undefined {
	if (type === 'song') return result.trackName;
	if (type === 'album' || type === 'podcast') return result.collectionName;
	if (type === 'artist') return result.artistName;
	return undefined;
}

function upscaleArtworkUrl(value: string | undefined): string | undefined {
	return value?.replace('100x100', '600x600');
}

function resolveAppleMusicTarget(
	request: EnrichmentRequest,
	defaultCountry: string
): AppleMusicTarget | undefined {
	const identifier = getIdentifier(request, 'apple-music', 'appleMusicId', 'itunes', 'itunesId');
	if (identifier && NUMERIC_ID_PATTERN.test(identifier)) {
		return { kind: 'lookup', id: identifier, country: defaultCountry };
	}

	// Cross-provider augmentation edge: 'term|publisher' searches the podcast
	// catalog with a publisher-corroborated acceptance gate.
	const podcastSearch = getIdentifier(request, 'itunesPodcastSearch');
	if (podcastSearch) {
		const [term, publisher] = podcastSearch.split('|');
		if (term?.trim()) {
			return {
				kind: 'search',
				term: term.trim(),
				media: 'podcast',
				country: defaultCountry,
				...(publisher?.trim() ? { corroboratePublisher: publisher.trim() } : {}),
			};
		}
	}

	const url = getRequestUrl(request);
	if (!url) {
		return undefined;
	}

	return parseAppleMusicUrl(url, defaultCountry) ?? parseApplePodcastsUrl(url, defaultCountry);
}

// Apple Podcasts URLs: podcasts.apple.com/{storefront}/podcast/{slug}/id{digits}
export function parseApplePodcastsUrl(
	url: string,
	defaultCountry = DEFAULT_COUNTRY
): AppleMusicTarget | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
	if (host !== 'podcasts.apple.com') {
		return undefined;
	}
	const segments = parsed.pathname.split('/').filter(Boolean);
	const country =
		segments[0] && /^[a-z]{2}$/i.test(segments[0]) ? segments[0].toLowerCase() : defaultCountry;
	const idSegment = segments.at(-1)?.replace(/^id/, '');
	if (idSegment && NUMERIC_ID_PATTERN.test(idSegment)) {
		return { kind: 'lookup', id: idSegment, country, media: 'podcast' };
	}
	return undefined;
}

// Apple Music URLs: music.apple.com/{storefront}/{album|song|artist}/{slug}/{id}
// Tracks inside an album page carry their id in the `i` query parameter.
export function parseAppleMusicUrl(
	url: string,
	defaultCountry = DEFAULT_COUNTRY
): AppleMusicTarget | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}

	if (!APPLE_MUSIC_HOST_PATTERN.test(parsed.hostname)) {
		return undefined;
	}

	const segments = parsed.pathname.split('/').filter(Boolean);
	const country =
		segments[0] && /^[a-z]{2}$/i.test(segments[0]) ? segments[0].toLowerCase() : defaultCountry;

	const trackParam = parsed.searchParams.get('i');
	if (trackParam && NUMERIC_ID_PATTERN.test(trackParam)) {
		return { kind: 'lookup', id: trackParam, country };
	}

	const lastSegment = segments.at(-1);
	const idFromPath = lastSegment?.replace(/^id/, '');
	if (idFromPath && NUMERIC_ID_PATTERN.test(idFromPath)) {
		return { kind: 'lookup', id: idFromPath, country };
	}

	return undefined;
}
