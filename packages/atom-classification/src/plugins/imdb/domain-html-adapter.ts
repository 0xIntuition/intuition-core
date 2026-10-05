import type { DomainHtmlFetchLike } from '../shared/domain-html/fetch';
import { resolveDomainHtmlFetch } from '../shared/domain-html/fetch';
import { buildIdentityResolverAtom } from '../shared/domain-html/identity';
import { toRecordMaybe, toStringMaybe } from '../shared/helpers';
import type { PlatformStageAdapter } from '../shared/platform';

export type ImdbDomainHtmlAdapterOptions = {
	apiKey?: string;
	fetch?: DomainHtmlFetchLike;
};
export type ImdbDomainHtmlAdapter = PlatformStageAdapter;

export function buildTmdbFindEndpoint(imdbId: string): string {
	return `https://api.themoviedb.org/3/find/${encodeURIComponent(imdbId)}?external_source=imdb_id`;
}

/** Retain the exported adapter name, but resolve exclusively through TMDB's catalog API. */
export function createImdbDomainHtmlAdapter(
	options: ImdbDomainHtmlAdapterOptions = {}
): ImdbDomainHtmlAdapter {
	const apiKey = options.apiKey?.trim();
	return async ({ runtime, domain, classification, canonicalUrl }) => {
		if (runtime !== 'server' || domain !== 'imdb' || classification.subtype !== 'title')
			return null;
		const imdbId = toStringMaybe(classification.meta.titleId);
		if (!imdbId || !/^tt\d+$/.test(imdbId)) return null;
		const diagnose = (status: 'hit' | 'miss' | 'ambiguous' | 'unavailable', hits: number) => {
			classification.meta.imdbBridge = { status, hits };
		};
		const fetcher = resolveDomainHtmlFetch(options.fetch);
		if (!apiKey || !fetcher) {
			diagnose('unavailable', 0);
			return null;
		}
		const endpoint = new URL(buildTmdbFindEndpoint(imdbId));
		endpoint.searchParams.set('api_key', apiKey);
		let response: Awaited<ReturnType<DomainHtmlFetchLike>>;
		try {
			response = await fetcher(endpoint.toString(), { headers: { accept: 'application/json' } });
		} catch {
			diagnose('unavailable', 0);
			throw new Error('TMDB find upstream request failed');
		}
		if (!response.ok) {
			diagnose('unavailable', 0);
			if (response.status === 429) throw new Error('TMDB find 429 rate limit');
			if (response.status === 401 || response.status === 403)
				throw new Error(`TMDB find auth ${response.status}`);
			if (response.status >= 500) throw new Error(`TMDB find upstream ${response.status}`);
			return null;
		}
		let payload: Record<string, unknown> | undefined;
		try {
			payload = toRecordMaybe(JSON.parse(await response.text()));
		} catch {
			diagnose('unavailable', 0);
			return null;
		}
		if (!Array.isArray(payload?.movie_results) || !Array.isArray(payload?.tv_results)) {
			diagnose('unavailable', 0);
			return null;
		}
		const hits = payload.movie_results.length + payload.tv_results.length;
		if (hits !== 1) {
			diagnose(hits === 0 ? 'miss' : 'ambiguous', hits);
			return null;
		}
		const mediaType = payload.movie_results.length ? 'movie' : 'tv';
		const record = toRecordMaybe(
			(mediaType === 'movie' ? payload.movie_results : payload.tv_results)[0]
		);
		const title = toStringMaybe(record?.[mediaType === 'movie' ? 'title' : 'name'])
			?.replace(/\s+/g, ' ')
			.trim();
		if (
			!record ||
			typeof record.id !== 'number' ||
			!Number.isSafeInteger(record.id) ||
			record.id <= 0 ||
			!title
		) {
			diagnose('unavailable', hits);
			return null;
		}
		const tmdbId = String(record.id);
		const date = toStringMaybe(record[mediaType === 'movie' ? 'release_date' : 'first_air_date']);
		const year = date?.match(/^(\d{4})-/)?.[1];
		diagnose('hit', hits);
		const atom = buildIdentityResolverAtom({
			schemaType: mediaType === 'movie' ? 'Movie' : 'TVSeries',
			category: 'thing',
			title,
			canonicalId: `imdb:title:${imdbId}`,
			canonicalUrl,
			sameAs: [canonicalUrl, `https://www.themoviedb.org/${mediaType}/${tmdbId}`],
			pluginId: 'imdb',
			provider: 'imdb-tmdb',
			fields: {
				imdbId,
				tmdbId,
				mediaType,
				identifier: `tmdb:${mediaType}:${tmdbId}`,
				...(date ? { datePublished: date } : {}),
				...(year ? { year: Number(year) } : {}),
			},
		});
		return {
			...atom,
			hints: { identifiers: { imdbId, tmdbId, mediaType } },
			metadata: { ...atom.metadata, imdbBridge: { status: 'hit', hits } },
		};
	};
}
