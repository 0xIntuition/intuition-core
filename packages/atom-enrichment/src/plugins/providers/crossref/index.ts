import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getDoiFromRequest } from '../__shared__/request';
import { crossrefResponseSchema } from './external';
import { doiDataSchema } from './schema';

type CreateCrossrefPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	userAgent?: string;
};

type CrossrefAuthor = {
	given?: string;
	family?: string;
};

type CrossrefMessage = {
	DOI?: string;
	title?: string[];
	author?: CrossrefAuthor[];
	issued?: { 'date-parts'?: number[][] };
	'published-print'?: { 'date-parts'?: number[][] };
	'container-title'?: string[];
	publisher?: string;
	abstract?: string | null;
	URL?: string;
	type?: string;
	'is-referenced-by-count'?: number;
};

type CrossrefResponse = {
	message?: CrossrefMessage;
};

const defaultUserAgent = '@0xintuition/atom-enrichment/0.1.0 (https://0xintuition.com)';

export function createCrossrefPlugin(options: CreateCrossrefPluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);
	const userAgent = options.userAgent ?? defaultUserAgent;

	return defineEnrichmentPlugin({
		id: 'crossref',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['doi'],
		priority: options.priority ?? 60,
		TTL: options.TTL ?? 43_200,

		supports(request: EnrichmentRequest) {
			return !!getDoiFromRequest(request);
		},

		async enrich(request, ctx) {
			const doi = getDoiFromRequest(request);
			if (!doi) {
				return [];
			}

			const payload = await fetchJsonWithSchema(
				fetcher,
				`https://api.crossref.org/works/${encodeURIComponent(doi)}`,
				crossrefResponseSchema,
				{
					signal: ctx.signal,
					headers: {
						'User-Agent': userAgent,
					},
				}
			);

			const message = payload.message ?? {};
			const resolvedDoi = message.DOI ?? doi;
			const title = message.title?.[0] ?? resolvedDoi;
			const sourceUrl = message.URL ?? `https://doi.org/${resolvedDoi}`;

			return [
				{
					artifact_type: 'doi',
					data: doiDataSchema.parse({
						doi: resolvedDoi,
						title,
						authors: normalizeAuthors(message.author),
						publishedDate: normalizePublishedDate(message),
						journal: message['container-title']?.[0],
						publisher: toOptionalString(message.publisher),
						abstract: toOptionalString(message.abstract),
						url: sourceUrl,
						type: toOptionalString(message.type),
						citationCount: message['is-referenced-by-count'],
					}),
					meta: {
						pluginId: 'crossref',
						provider: 'crossref',
						fetchedAt: ctx.now(),
						sourceUrl,
					},
				},
			];
		},
	});
}

function normalizeAuthors(
	authors: CrossrefAuthor[] | undefined
): Array<{ given?: string; family: string }> | undefined {
	if (!authors || authors.length === 0) {
		return undefined;
	}

	const normalized = authors
		.filter((author) => typeof author.family === 'string' && author.family.length > 0)
		.map((author) => ({
			given: author.given,
			family: author.family as string,
		}));

	return normalized.length > 0 ? normalized : undefined;
}

function normalizePublishedDate(message: CrossrefMessage): string | undefined {
	const firstDate =
		message['published-print']?.['date-parts']?.[0] ?? message.issued?.['date-parts']?.[0];

	if (!firstDate || firstDate.length === 0) {
		return undefined;
	}

	const [year, month, day] = firstDate;
	if (!year) {
		return undefined;
	}

	if (!month) {
		return `${year}`;
	}

	const monthPadded = `${month}`.padStart(2, '0');
	if (!day) {
		return `${year}-${monthPadded}`;
	}

	return `${year}-${monthPadded}-${`${day}`.padStart(2, '0')}`;
}

function toOptionalString(value: string | null | undefined): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}
