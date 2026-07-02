import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getRequestName, getRequestUrl, parseWikipediaTitleFromUrl } from '../__shared__/request';
import { wikipediaSummaryResponseSchema } from './external';
import { wikipediaDataSchema } from './schema';

type CreateWikipediaPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	language?: string;
};

type WikipediaSummaryResponse = {
	title?: string;
	extract?: string;
	extract_html?: string;
	thumbnail?: { source?: string };
	content_urls?: {
		desktop?: { page?: string };
		mobile?: { page?: string };
	};
	pageid?: number;
	lang?: string;
	timestamp?: string;
	wikibase_item?: string;
};

export function createWikipediaPlugin(
	options: CreateWikipediaPluginOptions = {}
): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);
	const language = options.language ?? 'en';

	return defineEnrichmentPlugin({
		id: 'wikipedia',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['wikipedia'],
		priority: options.priority ?? 30,
		TTL: options.TTL ?? 43_200,

		supports(request: EnrichmentRequest) {
			return !!resolveWikipediaTitle(request);
		},

		async enrich(request, ctx) {
			const title = resolveWikipediaTitle(request);
			if (!title) {
				return [];
			}

			const endpoint = `https://${language}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
			const payload = await fetchJsonWithSchema(fetcher, endpoint, wikipediaSummaryResponseSchema, {
				signal: ctx.signal,
			});

			const pageUrl =
				payload.content_urls?.desktop?.page ??
				payload.content_urls?.mobile?.page ??
				`https://${language}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;

			return [
				{
					artifact_type: 'wikipedia',
					data: wikipediaDataSchema.parse({
						title: payload.title ?? title,
						extract: payload.extract ?? '',
						extractHtml: toOptionalString(payload.extract_html),
						thumbnailUrl: payload.thumbnail?.source,
						pageUrl,
						pageId: payload.pageid,
						language: payload.lang ?? language,
						lastModified: payload.timestamp,
						wikibaseItem: toOptionalString(payload.wikibase_item),
					}),
					meta: {
						pluginId: 'wikipedia',
						provider: 'wikipedia',
						fetchedAt: ctx.now(),
						sourceUrl: pageUrl,
					},
				},
			];
		},
	});
}

function resolveWikipediaTitle(request: EnrichmentRequest): string | undefined {
	const requestUrl = getRequestUrl(request);
	if (requestUrl) {
		const titleFromUrl = parseWikipediaTitleFromUrl(requestUrl);
		if (titleFromUrl) {
			return titleFromUrl;
		}
	}

	return getRequestName(request);
}

function toOptionalString(value: string | null | undefined): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
