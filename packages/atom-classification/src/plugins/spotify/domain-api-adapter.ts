import type { ResolverAtom } from '../../plugins';
import type { PlatformStageAdapter } from '../shared/platform';

type SpotifyTargetType = 'track' | 'album' | 'artist' | 'show' | 'episode';

type FetchLike = (
	input: string,
	init?: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	}
) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}>;

type SpotifyTrackPayload = {
	id?: string;
	name?: string;
	external_urls?: {
		spotify?: string;
	};
	artists?: Array<{ name?: string }>;
	album?: {
		name?: string;
	};
};

type SpotifyAlbumPayload = {
	id?: string;
	name?: string;
	external_urls?: {
		spotify?: string;
	};
	artists?: Array<{ name?: string }>;
};

type SpotifyArtistPayload = {
	id?: string;
	name?: string;
	external_urls?: {
		spotify?: string;
	};
};

type SpotifyShowPayload = {
	id?: string;
	name?: string;
	description?: string;
	html_description?: string;
	external_urls?: {
		spotify?: string;
	};
	images?: Array<{ url?: string }>;
	publisher?: string;
	total_episodes?: number;
	languages?: string[];
};

type SpotifyEpisodePayload = {
	id?: string;
	name?: string;
	description?: string;
	html_description?: string;
	audio_preview_url?: string | null;
	duration_ms?: number;
	release_date?: string;
	external_urls?: {
		spotify?: string;
	};
	images?: Array<{ url?: string }>;
	show?: {
		id?: string;
		name?: string;
		external_urls?: {
			spotify?: string;
		};
	};
};

export type SpotifyDomainApiAdapterOptions = {
	clientId?: string;
	clientSecret?: string;
	market?: string;
	fetch?: FetchLike;
};

export type SpotifyDomainApiAdapter = PlatformStageAdapter;

export function createSpotifyDomainApiAdapter(
	options: SpotifyDomainApiAdapterOptions = {}
): SpotifyDomainApiAdapter {
	const fetcher = options.fetch ?? resolveGlobalFetch();

	return async ({ domain, classification, canonicalUrl, credential }) => {
		if (domain !== 'spotify') {
			return null;
		}

		if (!fetcher) {
			return null;
		}

		const targetType = normalizeSpotifyTargetType(classification.subtype);
		if (!targetType) {
			return null;
		}

		const resourceId =
			toStringMaybe(classification.meta.resourceId) ??
			extractSpotifyResourceIdFromUrl(canonicalUrl, targetType);
		if (!resourceId) {
			return null;
		}

		const clientId =
			toStringMaybe(options.clientId) ?? toStringMaybe(credential?.clientId) ?? undefined;
		const clientSecret =
			toStringMaybe(options.clientSecret) ?? toStringMaybe(credential?.clientSecret) ?? undefined;
		if (!clientId || !clientSecret) {
			return null;
		}

		const accessToken = await fetchSpotifyAccessToken(fetcher, clientId, clientSecret);
		const payload = await fetchSpotifyPayload(fetcher, {
			targetType,
			resourceId,
			accessToken,
			market: options.market,
		});

		return mapSpotifyPayloadToResolverAtom({
			targetType,
			resourceId,
			canonicalUrl,
			payload,
		});
	};
}

function resolveGlobalFetch(): FetchLike | undefined {
	const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
	if (typeof globalFetch !== 'function') {
		return undefined;
	}

	return globalFetch;
}

function normalizeSpotifyTargetType(value: string): SpotifyTargetType | undefined {
	if (
		value === 'track' ||
		value === 'album' ||
		value === 'artist' ||
		value === 'show' ||
		value === 'episode'
	) {
		return value;
	}

	return undefined;
}

function extractSpotifyResourceIdFromUrl(
	value: string,
	expectedType: SpotifyTargetType
): string | undefined {
	try {
		const parsed = new URL(value);
		if (!parsed.hostname.endsWith('spotify.com')) {
			return undefined;
		}

		const segments = parsed.pathname.split('/').filter(Boolean);
		if (segments.length < 2) {
			return undefined;
		}

		const first = segments[0];
		const second = segments[1];
		const third = segments[2];
		if (!first || !second) {
			return undefined;
		}

		const firstLooksLikeLocale = /^[a-z]{2}(?:-[A-Za-z]{2})?$/i.test(first);
		const targetType = (firstLooksLikeLocale ? second : first).toLowerCase();
		const resourceId = (firstLooksLikeLocale ? third : second) ?? '';

		if (targetType !== expectedType || resourceId.trim().length === 0) {
			return undefined;
		}

		return resourceId.trim();
	} catch {
		return undefined;
	}
}

async function fetchSpotifyAccessToken(
	fetcher: FetchLike,
	clientId: string,
	clientSecret: string
): Promise<string> {
	const response = await fetcher('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			authorization: `Basic ${base64Encode(`${clientId}:${clientSecret}`)}`,
			'content-type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} from Spotify token endpoint.`);
	}

	const payload = toRecordMaybe(await response.json()) ?? {};
	const accessToken = toStringMaybe(payload.access_token);
	if (!accessToken) {
		throw new Error('Spotify token response did not include access_token.');
	}

	return accessToken;
}

async function fetchSpotifyPayload(
	fetcher: FetchLike,
	input: {
		targetType: SpotifyTargetType;
		resourceId: string;
		accessToken: string;
		market?: string;
	}
): Promise<
	| SpotifyTrackPayload
	| SpotifyAlbumPayload
	| SpotifyArtistPayload
	| SpotifyShowPayload
	| SpotifyEpisodePayload
> {
	const endpoint = new URL(
		`https://api.spotify.com/v1/${encodeURIComponent(input.targetType)}s/${encodeURIComponent(
			input.resourceId
		)}`
	);
	const market = toStringMaybe(input.market);
	if (market) {
		endpoint.searchParams.set('market', market);
	}

	const response = await fetcher(endpoint.toString(), {
		headers: {
			authorization: `Bearer ${input.accessToken}`,
		},
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} from Spotify ${input.targetType} endpoint.`);
	}

	const payload = toRecordMaybe(await response.json()) ?? {};
	return payload as
		| SpotifyTrackPayload
		| SpotifyAlbumPayload
		| SpotifyArtistPayload
		| SpotifyShowPayload
		| SpotifyEpisodePayload;
}

function mapSpotifyPayloadToResolverAtom(input: {
	targetType: SpotifyTargetType;
	resourceId: string;
	canonicalUrl: string;
	payload:
		| SpotifyTrackPayload
		| SpotifyAlbumPayload
		| SpotifyArtistPayload
		| SpotifyShowPayload
		| SpotifyEpisodePayload;
}): ResolverAtom {
	if (input.targetType === 'track') {
		const payload = input.payload as SpotifyTrackPayload;
		const artistNames = extractArtistNames(payload.artists);
		const byArtist = artistNames.length > 0 ? artistNames.join(', ') : undefined;
		const inAlbum = toStringMaybe(payload.album?.name);
		const name = toStringMaybe(payload.name) ?? `Spotify Track ${input.resourceId}`;
		const spotifyUrl = toStringMaybe(payload.external_urls?.spotify) ?? input.canonicalUrl;
		const spotifyId = toStringMaybe(payload.id) ?? input.resourceId;

		return {
			schemaType: 'MusicRecording',
			category: 'song',
			title: name,
			canonicalId: `spotify:track:${spotifyId}`,
			sameAs: [spotifyUrl],
			data: {
				'@context': 'https://schema.org/',
				'@type': 'MusicRecording',
				name,
				sameAs: [spotifyUrl],
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
			metadata: {
				pluginId: 'spotify',
				provider: 'spotify-web-api',
				sourceUrl: spotifyUrl,
				sourceFamily: 'domain-api',
			},
		};
	}

	if (input.targetType === 'album') {
		const payload = input.payload as SpotifyAlbumPayload;
		const artistNames = extractArtistNames(payload.artists);
		const byArtist = artistNames.length > 0 ? artistNames.join(', ') : undefined;
		const name = toStringMaybe(payload.name) ?? `Spotify Album ${input.resourceId}`;
		const spotifyUrl = toStringMaybe(payload.external_urls?.spotify) ?? input.canonicalUrl;
		const spotifyId = toStringMaybe(payload.id) ?? input.resourceId;

		return {
			schemaType: 'MusicAlbum',
			category: 'song',
			title: name,
			canonicalId: `spotify:album:${spotifyId}`,
			sameAs: [spotifyUrl],
			data: {
				'@context': 'https://schema.org/',
				'@type': 'MusicAlbum',
				name,
				sameAs: [spotifyUrl],
				...(byArtist
					? {
							byArtist,
						}
					: {}),
			},
			metadata: {
				pluginId: 'spotify',
				provider: 'spotify-web-api',
				sourceUrl: spotifyUrl,
				sourceFamily: 'domain-api',
			},
		};
	}

	if (input.targetType === 'artist') {
		const payload = input.payload as SpotifyArtistPayload;
		const name = toStringMaybe(payload.name) ?? `Spotify Artist ${input.resourceId}`;
		const spotifyUrl = toStringMaybe(payload.external_urls?.spotify) ?? input.canonicalUrl;
		const spotifyId = toStringMaybe(payload.id) ?? input.resourceId;

		return {
			schemaType: 'MusicGroup',
			category: 'song',
			title: name,
			canonicalId: `spotify:artist:${spotifyId}`,
			sameAs: [spotifyUrl],
			data: {
				'@context': 'https://schema.org/',
				'@type': 'MusicGroup',
				name,
				sameAs: [spotifyUrl],
			},
			metadata: {
				pluginId: 'spotify',
				provider: 'spotify-web-api',
				sourceUrl: spotifyUrl,
				sourceFamily: 'domain-api',
			},
		};
	}

	if (input.targetType === 'show') {
		const payload = input.payload as SpotifyShowPayload;
		const name = toStringMaybe(payload.name) ?? `Spotify Show ${input.resourceId}`;
		const description = toStringMaybe(payload.description);
		const spotifyUrl = toStringMaybe(payload.external_urls?.spotify) ?? input.canonicalUrl;
		const spotifyId = toStringMaybe(payload.id) ?? input.resourceId;

		return {
			schemaType: 'PodcastSeries',
			category: 'podcast',
			title: name,
			canonicalId: `spotify:show:${spotifyId}`,
			sameAs: [spotifyUrl],
			data: {
				'@context': 'https://schema.org/',
				'@type': 'PodcastSeries',
				name,
				url: spotifyUrl,
				sameAs: [spotifyUrl],
				...(description ? { description } : {}),
				...(payload.publisher ? { publisher: payload.publisher } : {}),
			},
			metadata: {
				pluginId: 'spotify',
				provider: 'spotify-web-api',
				sourceUrl: spotifyUrl,
				sourceFamily: 'domain-api',
			},
		};
	}

	const payload = input.payload as SpotifyEpisodePayload;
	const name = toStringMaybe(payload.name) ?? `Spotify Episode ${input.resourceId}`;
	const spotifyUrl = toStringMaybe(payload.external_urls?.spotify) ?? input.canonicalUrl;
	const spotifyId = toStringMaybe(payload.id) ?? input.resourceId;
	const showName = toStringMaybe(payload.show?.name);
	const showUrl = toStringMaybe(payload.show?.external_urls?.spotify);

	return {
		schemaType: 'PodcastEpisode',
		category: 'podcast',
		title: name,
		canonicalId: `spotify:episode:${spotifyId}`,
		sameAs: [spotifyUrl],
		data: {
			'@context': 'https://schema.org/',
			'@type': 'PodcastEpisode',
			name,
			url: spotifyUrl,
			sameAs: [spotifyUrl],
			...(payload.description ? { description: payload.description } : {}),
			...(payload.release_date ? { datePublished: payload.release_date } : {}),
			...(payload.duration_ms ? { durationMs: payload.duration_ms } : {}),
			...(showName || showUrl
				? {
						partOfSeries: {
							'@type': 'PodcastSeries',
							...(showName ? { name: showName } : {}),
							...(showUrl ? { url: showUrl } : {}),
						},
					}
				: {}),
		},
		metadata: {
			pluginId: 'spotify',
			provider: 'spotify-web-api',
			sourceUrl: spotifyUrl,
			sourceFamily: 'domain-api',
		},
	};
}

function extractArtistNames(artists: Array<{ name?: string }> | undefined): string[] {
	if (!artists || artists.length === 0) {
		return [];
	}

	return artists
		.map((artist) => toStringMaybe(artist.name))
		.filter((name): name is string => typeof name === 'string');
}

function toStringMaybe(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toRecordMaybe(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function base64Encode(value: string): string {
	const globalBuffer = (
		globalThis as { Buffer?: { from(value: string): { toString(encoding: string): string } } }
	).Buffer;
	if (globalBuffer && typeof globalBuffer.from === 'function') {
		return globalBuffer.from(value).toString('base64');
	}

	const textEncoder = new TextEncoder();
	const bytes = textEncoder.encode(value);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}

	const globalBtoa = (globalThis as { btoa?: (input: string) => string }).btoa;
	if (typeof globalBtoa === 'function') {
		return globalBtoa(binary);
	}

	throw new Error('No base64 encoder available in runtime.');
}
