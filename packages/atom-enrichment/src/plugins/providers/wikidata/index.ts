import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getIdentifier, getRequestName, getRequestUrl } from '../__shared__/request';
import { wikidataEntityLookupResponseSchema, wikidataSearchResponseSchema } from './external';
import { wikidataDataSchema } from './schema';

type CreateWikidataPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	language?: string;
};

type WikidataSearchResponse = {
	search?: Array<{ id?: string }>;
};

type WikidataMonolingualValue = {
	value?: string;
};

type WikidataClaim = {
	mainsnak?: {
		datavalue?: {
			value?: unknown;
		};
	};
};

type WikidataEntity = {
	id?: string;
	labels?: Record<string, WikidataMonolingualValue>;
	descriptions?: Record<string, WikidataMonolingualValue>;
	aliases?: Record<string, WikidataMonolingualValue[]>;
	claims?: Record<string, WikidataClaim[]>;
	sitelinks?: Record<string, { site?: string; title?: string; url?: string }>;
};

type WikidataEntityResponse = {
	entities?: Record<string, WikidataEntity>;
};

const wikidataEntityIdPattern = /^Q\d+$/i;

export function createWikidataPlugin(options: CreateWikidataPluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);
	const language = options.language ?? 'en';

	return defineEnrichmentPlugin({
		id: 'wikidata',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['wikidata'],
		priority: options.priority ?? 35,
		TTL: options.TTL ?? 43_200,

		supports(request: EnrichmentRequest) {
			return !!resolveWikidataEntityId(request) || !!getRequestName(request);
		},

		async enrich(request, ctx) {
			let entityId = resolveWikidataEntityId(request);
			if (!entityId) {
				const name = getRequestName(request);
				if (!name) {
					return [];
				}

				entityId = await searchEntityId(fetcher, name, language, ctx.signal);
				if (!entityId) {
					return [];
				}
			}

			const payload = await fetchJsonWithSchema(
				fetcher,
				`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(entityId)}.json`,
				wikidataEntityLookupResponseSchema,
				{ signal: ctx.signal }
			);

			const entity = payload.entities?.[entityId];
			if (!entity) {
				return [];
			}

			const label = pickLocalizedValue(entity.labels, [language, 'en']) ?? entity.id;
			if (!label) {
				return [];
			}

			const description = pickLocalizedValue(entity.descriptions, [language, 'en']);
			const aliases = pickAliases(entity.aliases, [language, 'en']);
			const sitelinks = normalizeSitelinks(entity.sitelinks);
			const sourceUrl = sitelinks?.enwiki ?? `https://www.wikidata.org/wiki/${entityId}`;

			return [
				{
					artifact_type: 'wikidata',
					data: wikidataDataSchema.parse({
						entityId,
						label,
						description,
						aliases,
						claims: entity.claims,
						sitelinks,
						instanceOf: extractInstanceOf(entity.claims),
					}),
					meta: {
						pluginId: 'wikidata',
						provider: 'wikidata',
						fetchedAt: ctx.now(),
						sourceUrl,
					},
				},
			];
		},
	});
}

function resolveWikidataEntityId(request: EnrichmentRequest): string | undefined {
	const identifier = getIdentifier(request, 'wikidata', 'wikidataId', 'entityId');
	if (identifier && wikidataEntityIdPattern.test(identifier)) {
		return identifier.toUpperCase();
	}

	const url = getRequestUrl(request);
	if (url) {
		const fromUrl = parseWikidataEntityIdFromUrl(url);
		if (fromUrl) {
			return fromUrl;
		}
	}

	const name = getRequestName(request);
	if (name && wikidataEntityIdPattern.test(name)) {
		return name.toUpperCase();
	}

	return undefined;
}

async function searchEntityId(
	fetcher: FetchLike,
	name: string,
	language: string,
	signal: AbortSignal
): Promise<string | undefined> {
	const searchUrl =
		`https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&limit=1` +
		`&language=${encodeURIComponent(language)}` +
		`&search=${encodeURIComponent(name)}`;
	const payload = await fetchJsonWithSchema(fetcher, searchUrl, wikidataSearchResponseSchema, {
		signal,
	});

	const candidate = payload.search?.[0]?.id;
	if (!candidate || !wikidataEntityIdPattern.test(candidate)) {
		return undefined;
	}

	return candidate.toUpperCase();
}

function parseWikidataEntityIdFromUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes('wikidata.org')) {
			return undefined;
		}

		const match = parsed.pathname.match(/\/wiki\/(Q\d+)/i);
		if (!match?.[1]) {
			return undefined;
		}

		return match[1].toUpperCase();
	} catch {
		return undefined;
	}
}

function pickLocalizedValue(
	map: Record<string, WikidataMonolingualValue> | undefined,
	preferredLocales: string[]
): string | undefined {
	if (!map) {
		return undefined;
	}

	for (const locale of preferredLocales) {
		const value = map[locale]?.value;
		if (typeof value === 'string' && value.length > 0) {
			return value;
		}
	}

	for (const entry of Object.values(map)) {
		if (typeof entry.value === 'string' && entry.value.length > 0) {
			return entry.value;
		}
	}

	return undefined;
}

function pickAliases(
	aliases: Record<string, WikidataMonolingualValue[]> | undefined,
	preferredLocales: string[]
): string[] | undefined {
	if (!aliases) {
		return undefined;
	}

	for (const locale of preferredLocales) {
		const values = aliases[locale]
			?.map((entry) => entry.value)
			.filter((value): value is string => typeof value === 'string' && value.length > 0);
		if (values && values.length > 0) {
			return values;
		}
	}

	return undefined;
}

function normalizeSitelinks(
	sitelinks: Record<string, { site?: string; title?: string; url?: string }> | undefined
): Record<string, string> | undefined {
	if (!sitelinks) {
		return undefined;
	}

	const normalized: Record<string, string> = {};
	for (const [siteKey, value] of Object.entries(sitelinks)) {
		if (typeof value.url === 'string' && value.url.length > 0) {
			normalized[siteKey] = value.url;
			continue;
		}

		if (!value.site || !value.title) {
			continue;
		}

		if (value.site.endsWith('wiki') && value.site.length > 4) {
			const locale = value.site.slice(0, -4);
			normalized[siteKey] =
				`https://${locale}.wikipedia.org/wiki/${encodeURIComponent(value.title.replace(/\s+/g, '_'))}`;
		}
	}

	return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function extractInstanceOf(
	claims: Record<string, WikidataClaim[]> | undefined
): string[] | undefined {
	const statements = claims?.P31;
	if (!statements) {
		return undefined;
	}

	const values = statements
		.map((statement) => extractEntityId(statement.mainsnak?.datavalue?.value))
		.filter((value): value is string => typeof value === 'string' && value.length > 0);

	return values.length > 0 ? values : undefined;
}

function extractEntityId(value: unknown): string | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	const candidate = (value as { id?: unknown }).id;
	return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
}
