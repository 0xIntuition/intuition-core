import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getIdentifier, getRequestName, getRequestUrl } from '../__shared__/request';
import { tmdbDetailsResponseSchema } from './external';
import { tmdbDataSchema } from './schema';

type CreateTmdbPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	apiKey?: string;
	language?: string;
};

type TmdbGenre = {
	name?: string;
};

type TmdbDetailsResponse = {
	id?: number;
	title?: string;
	name?: string;
	overview?: string;
	poster_path?: string;
	backdrop_path?: string;
	release_date?: string;
	first_air_date?: string;
	vote_average?: number;
	genres?: TmdbGenre[];
	runtime?: number;
	episode_run_time?: number[];
	imdb_id?: string;
};

type TmdbTarget = {
	tmdbId: number;
	mediaType: 'movie' | 'tv';
};

const tmdbImageBaseUrl = 'https://image.tmdb.org/t/p/w500';

export function createTmdbPlugin(options: CreateTmdbPluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);
	const language = options.language ?? 'en-US';

	return defineEnrichmentPlugin({
		id: 'tmdb',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['tmdb'],
		priority: options.priority ?? 55,
		TTL: options.TTL ?? 43_200,

		supports(request: EnrichmentRequest) {
			return !!resolveTmdbTarget(request);
		},

		async enrich(request, ctx) {
			const target = resolveTmdbTarget(request);
			if (!target) {
				return [];
			}

			const query = new URLSearchParams({ language });
			if (options.apiKey) {
				query.set('api_key', options.apiKey);
			}

			const endpoint = `https://api.themoviedb.org/3/${target.mediaType}/${target.tmdbId}?${query.toString()}`;
			const payload = await fetchJsonWithSchema(fetcher, endpoint, tmdbDetailsResponseSchema, {
				signal: ctx.signal,
			});

			const tmdbId = payload.id ?? target.tmdbId;
			const title = payload.title ?? payload.name ?? `TMDB ${tmdbId}`;
			const sourceUrl = `https://www.themoviedb.org/${target.mediaType}/${tmdbId}`;

			return [
				{
					artifact_type: 'tmdb',
					data: tmdbDataSchema.parse({
						tmdbId,
						mediaType: target.mediaType,
						title,
						overview: toOptionalString(payload.overview),
						posterUrl: toTmdbImageUrl(toOptionalString(payload.poster_path)),
						backdropUrl: toTmdbImageUrl(toOptionalString(payload.backdrop_path)),
						releaseDate: toOptionalString(payload.release_date ?? payload.first_air_date),
						voteAverage:
							typeof payload.vote_average === 'number' ? payload.vote_average : undefined,
						genres: payload.genres
							?.map((genre) => genre.name)
							.filter((name): name is string => typeof name === 'string' && name.length > 0),
						runtime:
							typeof payload.runtime === 'number' ? payload.runtime : payload.episode_run_time?.[0],
						imdbId: toOptionalString(payload.imdb_id),
					}),
					meta: {
						pluginId: 'tmdb',
						provider: 'tmdb',
						fetchedAt: ctx.now(),
						sourceUrl,
					},
				},
			];
		},
	});
}

function resolveTmdbTarget(request: EnrichmentRequest): TmdbTarget | undefined {
	const identifier = getIdentifier(request, 'tmdb', 'tmdbId');
	if (identifier) {
		const parsedIdentifier = parseTmdbReference(identifier);
		if (parsedIdentifier) {
			return parsedIdentifier;
		}
	}

	const url = getRequestUrl(request);
	if (url) {
		const parsedUrl = parseTmdbUrl(url);
		if (parsedUrl) {
			return parsedUrl;
		}
	}

	const name = getRequestName(request);
	if (!name) {
		return undefined;
	}

	return parseTmdbReference(name);
}

function parseTmdbReference(value: string): TmdbTarget | undefined {
	const typedMatch = value.match(/^(movie|tv):(\d+)$/i);
	if (typedMatch?.[1] && typedMatch[2]) {
		return {
			mediaType: typedMatch[1].toLowerCase() as 'movie' | 'tv',
			tmdbId: Number.parseInt(typedMatch[2], 10),
		};
	}

	const numericMatch = value.match(/^(\d+)$/);
	if (numericMatch?.[1]) {
		return {
			mediaType: 'movie',
			tmdbId: Number.parseInt(numericMatch[1], 10),
		};
	}

	return undefined;
}

function parseTmdbUrl(url: string): TmdbTarget | undefined {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes('themoviedb.org')) {
			return undefined;
		}

		const match = parsed.pathname.match(/^\/(movie|tv)\/(\d+)/i);
		if (!match?.[1] || !match[2]) {
			return undefined;
		}

		return {
			mediaType: match[1].toLowerCase() as 'movie' | 'tv',
			tmdbId: Number.parseInt(match[2], 10),
		};
	} catch {
		return undefined;
	}
}

function toTmdbImageUrl(path: string | undefined): string | undefined {
	if (!path || path.length === 0) {
		return undefined;
	}

	return `${tmdbImageBaseUrl}${path.startsWith('/') ? path : `/${path}`}`;
}

function toOptionalString(value: string | null | undefined): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
