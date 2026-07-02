import { createSequencedDomainHtmlAdapter } from '../shared/domain-html/adapter';
import {
	extractCanonicalUrl,
	extractDocumentTitle,
	extractPrimaryJsonLd,
	normalizeWhitespace,
} from '../shared/domain-html/document';
import {
	type DomainHtmlFetchLike,
	fetchHtmlDocument,
	fetchJsonDocument,
} from '../shared/domain-html/fetch';
import { buildIdentityResolverAtom } from '../shared/domain-html/identity';
import { slugify, toRecordMaybe, toStringMaybe } from '../shared/helpers';
import type { PlatformStageAdapter } from '../shared/platform';

export type ImdbDomainHtmlAdapterOptions = {
	fetch?: DomainHtmlFetchLike;
};

export type ImdbDomainHtmlAdapter = PlatformStageAdapter;

type ImdbSuggestionRecord = {
	id?: string;
	l?: string;
	qid?: string;
	s?: string;
	i?: {
		imageUrl?: string;
	};
};

type ImdbHtmlSourceInput = {
	entityId: string | undefined;
	canonicalUrl: string;
	html: string;
	jsonLd: Record<string, unknown> | undefined;
	schemaType: 'Movie' | 'TVSeries' | 'Person';
	category: 'thing' | 'person';
	canonicalIdPrefix: 'imdb:title:' | 'imdb:name:';
	provider: 'imdb-html';
};

type ImdbSuggestionSourceInput = {
	entityId: string | undefined;
	canonicalUrl: string;
	suggestion: ImdbSuggestionRecord | undefined;
	schemaType: 'Movie' | 'TVSeries' | 'Person';
	category: 'thing' | 'person';
	canonicalIdPrefix: 'imdb:title:' | 'imdb:name:';
	provider: 'imdb-suggestion';
};

export function createImdbDomainHtmlAdapter(
	options: ImdbDomainHtmlAdapterOptions = {}
): ImdbDomainHtmlAdapter {
	return createSequencedDomainHtmlAdapter({
		domain: 'imdb',
		subtypes: ['title', 'person'],
		fetch: options.fetch,
		sources: [
			{
				id: 'imdb-html',
				resolve: async ({ subtype, canonicalUrl, classificationMeta, fetcher }) => {
					const html = await fetchHtmlDocument(fetcher, {
						url: canonicalUrl,
					});
					if (!html) {
						return null;
					}

					const resolvedCanonicalUrl = extractCanonicalUrl(html) ?? canonicalUrl;
					const jsonLd = extractPrimaryJsonLd(html);

					if (subtype === 'person') {
						return buildImdbAtomFromHtml({
							entityId: toStringMaybe(classificationMeta.personId),
							canonicalUrl: resolvedCanonicalUrl,
							html,
							jsonLd,
							schemaType: 'Person',
							category: 'person',
							canonicalIdPrefix: 'imdb:name:',
							provider: 'imdb-html',
						});
					}

					const jsonLdType = normalizeSchemaType(toStringMaybe(jsonLd?.['@type']));
					return buildImdbAtomFromHtml({
						entityId: toStringMaybe(classificationMeta.titleId),
						canonicalUrl: resolvedCanonicalUrl,
						html,
						jsonLd,
						schemaType: jsonLdType === 'TVSeries' ? 'TVSeries' : 'Movie',
						category: 'thing',
						canonicalIdPrefix: 'imdb:title:',
						provider: 'imdb-html',
					});
				},
			},
			{
				id: 'imdb-suggestion',
				resolve: async ({ subtype, canonicalUrl, classificationMeta, fetcher }) => {
					const entityId =
						subtype === 'person'
							? toStringMaybe(classificationMeta.personId)
							: toStringMaybe(classificationMeta.titleId);
					const suggestion = await fetchSuggestionRecord({
						fetcher,
						entityId,
						kind: subtype === 'person' ? 'name' : 'title',
					});

					if (subtype === 'person') {
						return buildImdbAtomFromSuggestion({
							entityId,
							canonicalUrl,
							suggestion,
							schemaType: 'Person',
							category: 'person',
							canonicalIdPrefix: 'imdb:name:',
							provider: 'imdb-suggestion',
						});
					}

					return buildImdbAtomFromSuggestion({
						entityId,
						canonicalUrl,
						suggestion,
						schemaType: mapSuggestionTitleType(suggestion?.qid),
						category: 'thing',
						canonicalIdPrefix: 'imdb:title:',
						provider: 'imdb-suggestion',
					});
				},
			},
		],
	});
}

function buildImdbAtomFromHtml(input: ImdbHtmlSourceInput) {
	const name =
		toStringMaybe(input.jsonLd?.name) ??
		normalizeImdbDocumentTitle(extractDocumentTitle(input.html)) ??
		undefined;
	if (!name) {
		return null;
	}

	const sameAs = normalizeUrlArray([input.canonicalUrl, toStringMaybe(input.jsonLd?.url) ?? '']);
	const description = toStringMaybe(input.jsonLd?.description);
	const image =
		toStringMaybe(input.jsonLd?.image) ?? toStringMaybe(input.jsonLd?.thumbnailUrl) ?? undefined;

	return buildIdentityResolverAtom({
		schemaType: input.schemaType,
		category: input.category,
		title: name,
		description,
		canonicalId: `${input.canonicalIdPrefix}${input.entityId ?? slugify(input.canonicalUrl)}`,
		canonicalUrl: input.canonicalUrl,
		sameAs,
		pluginId: 'imdb',
		provider: input.provider,
		fields: {
			...(image ? { image } : {}),
		},
	});
}

function buildImdbAtomFromSuggestion(input: ImdbSuggestionSourceInput) {
	const name = normalizeWhitespace(input.suggestion?.l);
	if (!name) {
		return null;
	}

	const description = normalizeWhitespace(input.suggestion?.s);
	const image = toStringMaybe(input.suggestion?.i?.imageUrl);

	return buildIdentityResolverAtom({
		schemaType: input.schemaType,
		category: input.category,
		title: name,
		description,
		canonicalId: `${input.canonicalIdPrefix}${input.entityId ?? slugify(input.canonicalUrl)}`,
		canonicalUrl: input.canonicalUrl,
		pluginId: 'imdb',
		provider: input.provider,
		fields: {
			...(image ? { image } : {}),
		},
	});
}

async function fetchSuggestionRecord(input: {
	fetcher: DomainHtmlFetchLike;
	entityId: string | undefined;
	kind: 'title' | 'name';
}): Promise<ImdbSuggestionRecord | undefined> {
	if (!input.entityId) {
		return undefined;
	}

	const bucket = input.kind === 'title' ? 't' : 'n';
	const payload = await fetchJsonDocument<{ d?: unknown[] }>(input.fetcher, {
		url: `https://v2.sg.media-imdb.com/suggestion/${bucket}/${input.entityId}.json`,
	});
	const records = payload?.d;
	if (!Array.isArray(records)) {
		return undefined;
	}

	for (const entry of records) {
		const record = toRecordMaybe(entry);
		if (record && toStringMaybe(record.id) === input.entityId) {
			return record as ImdbSuggestionRecord;
		}
	}

	const firstRecord = toRecordMaybe(records[0]);
	return firstRecord as ImdbSuggestionRecord | undefined;
}

function normalizeImdbDocumentTitle(value: string | undefined): string | undefined {
	const normalized = normalizeWhitespace(value);
	if (!normalized) {
		return undefined;
	}

	return normalized
		.replace(/\s+-\s+IMDb$/i, '')
		.replace(/\s+\(.*?\)\s+-\s+IMDb$/i, '')
		.trim();
}

function normalizeSchemaType(value: string | undefined): 'Movie' | 'TVSeries' | undefined {
	if (value === 'TVSeries' || value === 'Movie') {
		return value;
	}

	return undefined;
}

function mapSuggestionTitleType(value: string | undefined): 'Movie' | 'TVSeries' {
	const normalized = value?.trim().toLowerCase();
	if (
		normalized === 'tvseries' ||
		normalized === 'tvmini-series' ||
		normalized === 'tvminiseries' ||
		normalized === 'tv'
	) {
		return 'TVSeries';
	}

	return 'Movie';
}

function normalizeUrlArray(values: string[]): string[] {
	return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
