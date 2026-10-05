import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import {
	getRequestName,
	getRequestUrl,
	isSynthesizedProviderPlaceholderTitle,
	parseWikipediaTitleFromUrl,
} from '../__shared__/request';
import { fetchWikidataEntity, wikidataTypeAgreement } from '../__shared__/wikidata-type';
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
			const requestUrl = getRequestUrl(request);
			const titleFromUrl = requestUrl ? parseWikipediaTitleFromUrl(requestUrl) : undefined;
			let agreement: 'agree' | 'mismatch' | 'unknown' = 'unknown';
			if (!titleFromUrl && ctx.identity) {
				const qid = payload.wikibase_item;
				try {
					const entity =
						qid && /^Q\d+$/i.test(qid)
							? await fetchWikidataEntity(fetcher, qid.toUpperCase(), ctx.signal)
							: undefined;
					agreement = wikidataTypeAgreement(
						entity?.claims,
						request.input.jsonLd['@type'],
						ctx.identity,
						ctx.logger,
						ctx.signal
					);
				} catch (error) {
					if (ctx.signal.aborted) throw error;
					ctx.logger?.warn('Wikidata P31 fetch failed.', {
						error: error instanceof Error ? error.message : String(error),
					});
				}
				if (agreement === 'mismatch') return [];
			}

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
						...(titleFromUrl
							? { identityStrength: 'url' as const }
							: agreement === 'unknown'
								? { identityStrength: 'title' as const }
								: {}),
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

	return isSynthesizedProviderPlaceholderTitle(request) ? undefined : getRequestName(request);
}

function toOptionalString(value: string | null | undefined): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
