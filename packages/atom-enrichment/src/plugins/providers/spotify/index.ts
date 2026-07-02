import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getIdentifier, getRequestName, getRequestUrl } from '../__shared__/request';
import {
	spotifyAlbumResponseSchema,
	spotifyArtistResponseSchema,
	spotifyEpisodeResponseSchema,
	spotifyOEmbedResponseSchema,
	spotifyPlaylistResponseSchema,
	spotifyShowResponseSchema,
	spotifyTokenResponseSchema,
	spotifyTrackResponseSchema,
} from './external';
import { spotifyDataSchema } from './schema';

type CreateSpotifyPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	clientId?: string;
	clientSecret?: string;
	market?: string;
};

type SpotifyTargetType = 'track' | 'album' | 'artist' | 'playlist' | 'show' | 'episode';

type SpotifyTarget = {
	type: SpotifyTargetType;
	id: string;
	url: string;
};

export function createSpotifyPlugin(options: CreateSpotifyPluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'spotify',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['spotify'],
		priority: options.priority ?? 48,
		TTL: options.TTL ?? 900,

		supports(request: EnrichmentRequest) {
			return !!resolveSpotifyTarget(request);
		},

		async enrich(request, ctx) {
			const target = resolveSpotifyTarget(request);
			if (!target) {
				return [];
			}

			const fallbackData = buildFallbackData(request, target);
			const clientId = options.clientId?.trim();
			const clientSecret = options.clientSecret?.trim();

			if (!clientId || !clientSecret) {
				// Keyless tier: Spotify's public oEmbed serves real titles and
				// artwork — EXCEPT for shows, where the oEmbed title is the latest
				// episode's title (verified live). Keep the artwork, drop the
				// misleading name; the Web API path returns the true show name.
				const oembed = await fetchSpotifyOEmbedData(fetcher, target.url, ctx.signal);
				// Show oEmbed titles are the LATEST EPISODE's title (verified
				// live) — keep the artwork, never the misleading name.
				const oembedName = target.type === 'show' ? undefined : oembed.name;
				return [
					{
						artifact_type: 'spotify',
						data: {
							...fallbackData,
							...(oembedName ? { name: oembedName } : {}),
							...(oembed.imageUrl ? { imageUrl: oembed.imageUrl } : {}),
						},
						meta: {
							pluginId: 'spotify',
							provider: oembedName ? 'spotify-oembed' : 'spotify-url',
							fetchedAt: ctx.now(),
							sourceUrl: target.url,
						},
					},
				];
			}

			try {
				const accessToken = await fetchSpotifyAccessToken(
					fetcher,
					clientId,
					clientSecret,
					ctx.signal
				);
				const data = await fetchSpotifyData({
					fetcher,
					target,
					accessToken,
					signal: ctx.signal,
					market: options.market,
				});

				return [
					{
						artifact_type: 'spotify',
						data: {
							...fallbackData,
							...data,
						},
						meta: {
							pluginId: 'spotify',
							provider: 'spotify-web-api',
							fetchedAt: ctx.now(),
							sourceUrl: target.url,
						},
					},
				];
			} catch (error) {
				ctx.logger?.warn('Spotify metadata fetch failed; falling back to URL-derived payload.', {
					error: toErrorMessage(error),
					sourceUrl: target.url,
				});
				const oembed = await fetchSpotifyOEmbedData(fetcher, target.url, ctx.signal);
				// Show oEmbed titles are the LATEST EPISODE's title (verified
				// live) — keep the artwork, never the misleading name.
				const oembedName = target.type === 'show' ? undefined : oembed.name;
				return [
					{
						artifact_type: 'spotify',
						data: {
							...fallbackData,
							...(oembedName ? { name: oembedName } : {}),
							...(oembed.imageUrl ? { imageUrl: oembed.imageUrl } : {}),
						},
						meta: {
							pluginId: 'spotify',
							provider: 'spotify-url',
							fetchedAt: ctx.now(),
							sourceUrl: target.url,
						},
					},
				];
			}
		},
	});
}

function resolveSpotifyTarget(request: EnrichmentRequest): SpotifyTarget | undefined {
	const url = getRequestUrl(request);
	if (url) {
		const parsed = parseSpotifyUrl(url);
		if (parsed) {
			return parsed;
		}
	}

	const trackId = getIdentifier(request, 'spotifyTrackId');
	if (trackId && isLikelySpotifyId(trackId)) {
		return createTargetFromIdentifier('track', trackId);
	}

	const albumId = getIdentifier(request, 'spotifyAlbumId');
	if (albumId && isLikelySpotifyId(albumId)) {
		return createTargetFromIdentifier('album', albumId);
	}

	const artistId = getIdentifier(request, 'spotifyArtistId');
	if (artistId && isLikelySpotifyId(artistId)) {
		return createTargetFromIdentifier('artist', artistId);
	}

	const playlistId = getIdentifier(request, 'spotifyPlaylistId');
	if (playlistId && isLikelySpotifyId(playlistId)) {
		return createTargetFromIdentifier('playlist', playlistId);
	}

	const showId = getIdentifier(request, 'spotifyShowId');
	if (showId && isLikelySpotifyId(showId)) {
		return createTargetFromIdentifier('show', showId);
	}

	const episodeId = getIdentifier(request, 'spotifyEpisodeId');
	if (episodeId && isLikelySpotifyId(episodeId)) {
		return createTargetFromIdentifier('episode', episodeId);
	}

	const rawSpotifyId = getIdentifier(request, 'spotifyId');
	if (!rawSpotifyId) {
		return undefined;
	}

	const parsedRaw = parseSpotifyIdentifier(rawSpotifyId);
	if (parsedRaw) {
		return parsedRaw;
	}

	return undefined;
}

function createTargetFromIdentifier(type: SpotifyTargetType, id: string): SpotifyTarget {
	const normalizedId = normalizeSpotifyId(id);
	return {
		type,
		id: normalizedId,
		url: toSpotifyCanonicalUrl(type, normalizedId),
	};
}

function parseSpotifyIdentifier(value: string): SpotifyTarget | undefined {
	const normalized = value.trim();
	const canonicalPattern = /^(track|album|artist|playlist|show|episode):([A-Za-z0-9]{8,64})$/i;
	const canonicalMatch = normalized.match(canonicalPattern);
	if (canonicalMatch?.[1] && canonicalMatch[2]) {
		const type = canonicalMatch[1].toLowerCase() as SpotifyTargetType;
		const id = normalizeSpotifyId(canonicalMatch[2]);
		return {
			type,
			id,
			url: toSpotifyCanonicalUrl(type, id),
		};
	}

	const fullPattern = /^spotify:(track|album|artist|playlist|show|episode):([A-Za-z0-9]{8,64})$/i;
	const fullMatch = normalized.match(fullPattern);
	if (fullMatch?.[1] && fullMatch[2]) {
		const type = fullMatch[1].toLowerCase() as SpotifyTargetType;
		const id = normalizeSpotifyId(fullMatch[2]);
		return {
			type,
			id,
			url: toSpotifyCanonicalUrl(type, id),
		};
	}

	return undefined;
}

function parseSpotifyUrl(value: string): SpotifyTarget | undefined {
	try {
		const parsed = new URL(value);
		if (!parsed.hostname.endsWith('spotify.com')) {
			return undefined;
		}

		const segments = parsed.pathname.split('/').filter(Boolean);
		if (segments.length === 0) {
			return undefined;
		}

		const first = segments[0];
		const second = segments[1];
		const third = segments[2];

		if (!first) {
			return undefined;
		}

		// Some localized Spotify URLs may include locale as first path segment.
		const firstLooksLikeLocale = /^[a-z]{2}(?:-[A-Za-z]{2})?$/i.test(first);
		const kind = (firstLooksLikeLocale ? second : first) as SpotifyTargetType | undefined;
		const resourceId = firstLooksLikeLocale ? third : second;
		if (!kind || !resourceId) {
			return undefined;
		}
		if (!isSpotifyTargetType(kind)) {
			return undefined;
		}

		const normalizedId = normalizeSpotifyId(resourceId);
		if (!isLikelySpotifyId(normalizedId)) {
			return undefined;
		}

		return {
			type: kind,
			id: normalizedId,
			url: toSpotifyCanonicalUrl(kind, normalizedId),
		};
	} catch {
		return undefined;
	}
}

const SPOTIFY_TARGET_TYPES = new Set(['track', 'album', 'artist', 'playlist', 'show', 'episode']);

function isSpotifyTargetType(value: string): value is SpotifyTargetType {
	return SPOTIFY_TARGET_TYPES.has(value);
}

function normalizeSpotifyId(value: string): string {
	return value.replace(/\/+$/, '').trim();
}

function isLikelySpotifyId(value: string): boolean {
	return /^[A-Za-z0-9]{8,64}$/.test(value);
}

function toSpotifyCanonicalUrl(type: SpotifyTargetType, id: string): string {
	return `https://open.spotify.com/${type}/${id}`;
}

async function fetchSpotifyAccessToken(
	fetcher: FetchLike,
	clientId: string,
	clientSecret: string,
	signal: AbortSignal
): Promise<string> {
	const response = await fetcher('https://accounts.spotify.com/api/token', {
		method: 'POST',
		headers: {
			authorization: `Basic ${base64Encode(`${clientId}:${clientSecret}`)}`,
			'content-type': 'application/x-www-form-urlencoded',
		},
		body: 'grant_type=client_credentials',
		signal,
	});

	if (!response.ok) {
		throw new Error(`HTTP ${response.status} from https://accounts.spotify.com/api/token`);
	}

	const payload = spotifyTokenResponseSchema.parse(await response.json());
	if (!payload.access_token) {
		throw new Error('Spotify API did not return an access token.');
	}

	return payload.access_token;
}

async function fetchSpotifyData(params: {
	fetcher: FetchLike;
	target: SpotifyTarget;
	accessToken: string;
	signal: AbortSignal;
	market?: string;
}): Promise<{
	name: string;
	type: SpotifyTargetType;
	spotifyId: string;
	spotifyUrl: string;
	spotifyApiPayload?: Record<string, unknown>;
	previewUrl?: string;
	imageUrl?: string;
	artists?: Array<{ name: string; spotifyId: string }>;
	albumName?: string;
	showName?: string;
	publisher?: string;
	description?: string;
	releaseDate?: string;
	durationMs?: number;
	popularity?: number;
	isrc?: string;
	genres?: string[];
	totalEpisodes?: number;
	languages?: string[];
	showSpotifyId?: string;
	showSpotifyUrl?: string;
}> {
	const endpoint = new URL(
		`https://api.spotify.com/v1/${encodeURIComponent(params.target.type)}s/${encodeURIComponent(params.target.id)}`
	);
	if (params.market?.trim()) {
		endpoint.searchParams.set('market', params.market.trim());
	}
	// Spotify's client-credentials flow requires a market for show/episode
	// lookups; without one the API returns 404 for many resources.
	if (
		(params.target.type === 'show' || params.target.type === 'episode') &&
		!endpoint.searchParams.has('market')
	) {
		endpoint.searchParams.set('market', 'US');
	}

	const headers = {
		authorization: `Bearer ${params.accessToken}`,
	};

	if (params.target.type === 'track') {
		const payload = await fetchJsonWithSchema(
			params.fetcher,
			endpoint.toString(),
			spotifyTrackResponseSchema,
			{
				signal: params.signal,
				headers,
			}
		);

		return spotifyDataSchema.parse({
			name: payload.name ?? `Spotify Track ${params.target.id}`,
			type: 'track',
			spotifyId: payload.id ?? params.target.id,
			spotifyUrl: payload.external_urls?.spotify ?? params.target.url,
			spotifyApiPayload: asUnknownRecord(payload),
			previewUrl: normalizeHttpUrl(payload.preview_url),
			imageUrl: normalizeHttpUrl(payload.album?.images?.[0]?.url),
			artists: payload.artists
				?.map((artist) => {
					if (!artist?.name || !artist.id) {
						return undefined;
					}
					return {
						name: artist.name,
						spotifyId: artist.id,
					};
				})
				.filter((entry): entry is { name: string; spotifyId: string } => !!entry),
			albumName: payload.album?.name,
			releaseDate: payload.album?.release_date,
			durationMs: payload.duration_ms,
			popularity: payload.popularity,
			isrc: payload.external_ids?.isrc,
		});
	}

	if (params.target.type === 'album') {
		const payload = await fetchJsonWithSchema(
			params.fetcher,
			endpoint.toString(),
			spotifyAlbumResponseSchema,
			{
				signal: params.signal,
				headers,
			}
		);
		return spotifyDataSchema.parse({
			name: payload.name ?? `Spotify Album ${params.target.id}`,
			type: 'album',
			spotifyId: payload.id ?? params.target.id,
			spotifyUrl: payload.external_urls?.spotify ?? params.target.url,
			spotifyApiPayload: asUnknownRecord(payload),
			imageUrl: normalizeHttpUrl(payload.images?.[0]?.url),
			artists: payload.artists
				?.map((artist) => {
					if (!artist?.name || !artist.id) {
						return undefined;
					}
					return {
						name: artist.name,
						spotifyId: artist.id,
					};
				})
				.filter((entry): entry is { name: string; spotifyId: string } => !!entry),
			releaseDate: payload.release_date,
			popularity: payload.popularity,
			genres: payload.genres,
		});
	}

	if (params.target.type === 'artist') {
		const payload = await fetchJsonWithSchema(
			params.fetcher,
			endpoint.toString(),
			spotifyArtistResponseSchema,
			{
				signal: params.signal,
				headers,
			}
		);
		return spotifyDataSchema.parse({
			name: payload.name ?? `Spotify Artist ${params.target.id}`,
			type: 'artist',
			spotifyId: payload.id ?? params.target.id,
			spotifyUrl: payload.external_urls?.spotify ?? params.target.url,
			spotifyApiPayload: asUnknownRecord(payload),
			imageUrl: normalizeHttpUrl(payload.images?.[0]?.url),
			popularity: payload.popularity,
			genres: payload.genres,
		});
	}

	if (params.target.type === 'playlist') {
		const payload = await fetchJsonWithSchema(
			params.fetcher,
			endpoint.toString(),
			spotifyPlaylistResponseSchema,
			{
				signal: params.signal,
				headers,
			}
		);
		return spotifyDataSchema.parse({
			name: payload.name ?? `Spotify Playlist ${params.target.id}`,
			type: 'playlist',
			spotifyId: payload.id ?? params.target.id,
			spotifyUrl: payload.external_urls?.spotify ?? params.target.url,
			spotifyApiPayload: asUnknownRecord(payload),
			imageUrl: normalizeHttpUrl(payload.images?.[0]?.url),
		});
	}

	if (params.target.type === 'show') {
		const payload = await fetchJsonWithSchema(
			params.fetcher,
			endpoint.toString(),
			spotifyShowResponseSchema,
			{
				signal: params.signal,
				headers,
			}
		);
		return spotifyDataSchema.parse({
			name: payload.name ?? `Spotify Show ${params.target.id}`,
			type: 'show',
			spotifyId: payload.id ?? params.target.id,
			spotifyUrl: payload.external_urls?.spotify ?? params.target.url,
			spotifyApiPayload: asUnknownRecord(payload),
			imageUrl: normalizeHttpUrl(payload.images?.[0]?.url),
			description: payload.description,
			publisher: payload.publisher,
			totalEpisodes: payload.total_episodes,
			languages: payload.languages,
		});
	}

	const payload = await fetchJsonWithSchema(
		params.fetcher,
		endpoint.toString(),
		spotifyEpisodeResponseSchema,
		{
			signal: params.signal,
			headers,
		}
	);
	return spotifyDataSchema.parse({
		name: payload.name ?? `Spotify Episode ${params.target.id}`,
		type: 'episode',
		spotifyId: payload.id ?? params.target.id,
		spotifyUrl: payload.external_urls?.spotify ?? params.target.url,
		spotifyApiPayload: asUnknownRecord(payload),
		previewUrl: normalizeHttpUrl(payload.audio_preview_url),
		imageUrl: normalizeHttpUrl(payload.images?.[0]?.url),
		description: payload.description,
		releaseDate: payload.release_date,
		durationMs: payload.duration_ms,
		showName: payload.show?.name,
		showSpotifyId: payload.show?.id,
		showSpotifyUrl: normalizeHttpUrl(payload.show?.external_urls?.spotify),
	});
}

async function fetchSpotifyOEmbedData(
	fetcher: FetchLike,
	url: string,
	signal: AbortSignal
): Promise<{ name?: string; imageUrl?: string }> {
	try {
		const payload = await fetchJsonWithSchema(
			fetcher,
			`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`,
			spotifyOEmbedResponseSchema,
			{ signal }
		);
		const imageUrl = normalizeHttpUrl(payload.thumbnail_url);
		return {
			...(payload.title ? { name: payload.title } : {}),
			...(imageUrl ? { imageUrl } : {}),
		};
	} catch {
		return {};
	}
}

function buildFallbackData(
	request: EnrichmentRequest,
	target: SpotifyTarget
): {
	name: string;
	type: SpotifyTargetType;
	spotifyId: string;
	spotifyUrl: string;
} {
	const inferredName = getRequestName(request);
	const defaultName = `${toTitleCase(target.type)} ${target.id}`;
	return {
		name: inferredName ?? defaultName,
		type: target.type,
		spotifyId: target.id,
		spotifyUrl: target.url,
	};
}

function normalizeHttpUrl(value: string | undefined | null): string | undefined {
	if (!value) {
		return undefined;
	}

	try {
		const parsed = new URL(value);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return undefined;
		}
		return parsed.toString();
	} catch {
		return undefined;
	}
}

function asUnknownRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function toTitleCase(value: string): string {
	if (value.length === 0) {
		return value;
	}
	return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function base64Encode(value: string): string {
	if (typeof btoa === 'function') {
		return btoa(value);
	}

	const maybeBuffer = (
		globalThis as {
			Buffer?: { from(input: string, encoding: string): BufferLike };
		}
	).Buffer;
	if (!maybeBuffer) {
		throw new Error('Base64 encoding is unavailable in this runtime.');
	}

	return maybeBuffer.from(value, 'utf8').toString('base64');
}

type BufferLike = {
	toString(format: string): string;
};

function toErrorMessage(value: unknown): string {
	if (value instanceof Error && value.message) {
		return value.message;
	}

	return String(value);
}
