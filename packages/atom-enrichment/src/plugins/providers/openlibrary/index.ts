import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import type { FetchLike } from '../__shared__/http';
import { getIdentifier } from '../__shared__/request';
import {
	type OpenLibraryBooksApiEntry,
	type OpenLibraryEntityResponse,
	openLibraryBooksApiResponseSchema,
	openLibraryEntityResponseSchema,
} from './external';
import { type OpenLibraryData, openLibraryDataSchema } from './schema';

type CreateOpenLibraryPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
};

type OpenLibraryTarget =
	| { kind: 'isbn'; identifier: string }
	| { kind: 'olid'; identifier: string; entityType: 'edition' }
	| { kind: 'olid'; identifier: string; entityType: 'work' }
	| { kind: 'olid'; identifier: string; entityType: 'author' };

const ISBN_PATTERN = /^(?:\d{9}[\dX]|\d{13})$/i;
const OLID_PATTERN = /^OL\d+([AMW])$/i;

export function createOpenLibraryPlugin(
	options: CreateOpenLibraryPluginOptions = {}
): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'openlibrary',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['openlibrary'],
		priority: options.priority ?? 30,
		TTL: options.TTL ?? 43_200,

		supports(request) {
			return !!resolveOpenLibraryTarget(request);
		},

		async enrich(request, ctx) {
			const target = resolveOpenLibraryTarget(request);
			if (!target) {
				return [];
			}

			const data = await fetchOpenLibraryData(fetcher, target, ctx.signal);
			if (!data) {
				return [];
			}

			return [
				{
					artifact_type: 'openlibrary',
					data: openLibraryDataSchema.parse(data),
					meta: {
						pluginId: 'openlibrary',
						provider: 'openlibrary',
						fetchedAt: ctx.now(),
						sourceUrl: data.sourceUrl,
					},
				},
			];
		},
	});
}

export function resolveOpenLibraryTarget(
	request: EnrichmentRequest
): OpenLibraryTarget | undefined {
	// OLID is the more specific OpenLibrary-native identity. Its precedence is
	// intentional and tested when a migration supplies both hints.
	const olid = getIdentifier(request, 'olid');
	if (olid) {
		const canonical = olid.toUpperCase();
		const match = canonical.match(OLID_PATTERN);
		const suffix = match?.[1]?.toUpperCase();
		if (suffix === 'M' || suffix === 'W' || suffix === 'A') {
			return {
				kind: 'olid',
				identifier: canonical,
				entityType: suffix === 'M' ? 'edition' : suffix === 'W' ? 'work' : 'author',
			};
		}
	}

	const isbn = getIdentifier(request, 'isbn');
	if (isbn) {
		const canonical = isbn.replace(/[\s-]/g, '').toUpperCase();
		if (ISBN_PATTERN.test(canonical)) {
			return { kind: 'isbn', identifier: canonical };
		}
	}

	return undefined;
}

async function fetchOpenLibraryData(
	fetcher: FetchLike,
	target: OpenLibraryTarget,
	signal: AbortSignal
): Promise<OpenLibraryData | undefined> {
	if (target.kind === 'isbn' || target.entityType === 'edition') {
		const bibkey = `${target.kind === 'isbn' ? 'ISBN' : 'OLID'}:${target.identifier}`;
		const url = `https://openlibrary.org/api/books?bibkeys=${encodeURIComponent(bibkey)}&jscmd=data&format=json`;
		const response = await fetcher(url, { signal });
		if (response.status === 404) {
			return undefined;
		}
		assertRetryableResponse(response, url);
		const payload = openLibraryBooksApiResponseSchema.parse(await response.json());
		const entry = payload[bibkey];
		return entry ? normalizeBooksApiEntry(target, entry) : undefined;
	}

	const segment = target.entityType === 'author' ? 'authors' : 'works';
	const url = `https://openlibrary.org/${segment}/${encodeURIComponent(target.identifier)}.json`;
	const response = await fetcher(url, { signal });
	if (response.status === 404) {
		return undefined;
	}
	assertRetryableResponse(response, url);
	const payload = openLibraryEntityResponseSchema.parse(await response.json());
	return normalizeEntityResponse(target, payload);
}

function normalizeBooksApiEntry(
	target:
		| Extract<OpenLibraryTarget, { kind: 'isbn' }>
		| Extract<OpenLibraryTarget, { entityType: 'edition' }>,
	entry: OpenLibraryBooksApiEntry
): OpenLibraryData | undefined {
	if (!entry.title) {
		return undefined;
	}

	const olid = extractOlid(entry.key) ?? entry.identifiers?.openlibrary?.[0];
	const isbn = target.kind === 'isbn' ? target.identifier : firstIsbn(entry.identifiers);
	const identifierType = target.kind;
	const identifier = target.identifier;
	const sourceUrl = olid
		? `https://openlibrary.org/books/${encodeURIComponent(olid)}`
		: `https://openlibrary.org/isbn/${encodeURIComponent(identifier)}`;

	return openLibraryDataSchema.parse({
		identifier,
		identifierType,
		entityType: 'edition',
		isbn,
		olid,
		title: entry.title,
		authors: names(entry.authors),
		publisher: names(entry.publishers)?.[0],
		publishedDate: entry.publish_date,
		pageCount: entry.number_of_pages,
		coverUrl: entry.cover?.large ?? entry.cover?.medium ?? entry.cover?.small,
		subjects: names(entry.subjects),
		sourceUrl,
	});
}

function normalizeEntityResponse(
	target: Extract<OpenLibraryTarget, { kind: 'olid' }>,
	entity: OpenLibraryEntityResponse
): OpenLibraryData | undefined {
	const title = entity.title ?? entity.name ?? entity.personal_name;
	if (!title) {
		return undefined;
	}

	const imageId = entity.covers?.[0] ?? entity.photos?.[0];
	const sourceUrl = `https://openlibrary.org/${target.entityType === 'author' ? 'authors' : 'works'}/${encodeURIComponent(target.identifier)}`;

	return openLibraryDataSchema.parse({
		identifier: target.identifier,
		identifierType: 'olid',
		entityType: target.entityType,
		isbn: entity.isbn_13?.[0] ?? entity.isbn_10?.[0],
		olid: target.identifier,
		title,
		authorOlids: extractAuthorOlids(entity.authors),
		publisher: entity.publishers?.[0],
		publishedDate: entity.publish_date,
		pageCount: entity.number_of_pages,
		coverUrl: imageId
			? `https://covers.openlibrary.org/${target.entityType === 'author' ? 'a' : 'b'}/id/${imageId}-L.jpg`
			: undefined,
		description: descriptionValue(entity.description ?? entity.bio),
		subjects: entity.subjects,
		sourceUrl,
	});
}

function assertRetryableResponse(response: Response, url: string): void {
	if (response.ok) {
		return;
	}
	if (response.status === 429) {
		throw new Error(`Rate limited by OpenLibrary (HTTP 429 from ${url})`);
	}
	throw new Error(`Upstream HTTP ${response.status} from ${url}`);
}

function names(values: Array<{ name?: string }> | undefined): string[] | undefined {
	const result = values?.flatMap((value) => (value.name ? [value.name] : []));
	return result && result.length > 0 ? result : undefined;
}

function extractOlid(key: string | undefined): string | undefined {
	return key?.match(/\/(OL\d+[AMW])$/i)?.[1]?.toUpperCase();
}

function firstIsbn(identifiers: Record<string, string[]> | undefined): string | undefined {
	return identifiers?.isbn_13?.[0] ?? identifiers?.isbn_10?.[0];
}

function extractAuthorOlids(authors: OpenLibraryEntityResponse['authors']): string[] | undefined {
	const result = authors?.flatMap((author) => {
		const candidate = author as { key?: string; author?: { key?: string } };
		const key = candidate.author?.key ?? candidate.key;
		const olid = extractOlid(key);
		return olid ? [olid] : [];
	});
	return result && result.length > 0 ? result : undefined;
}

function descriptionValue(value: string | { value?: string } | undefined): string | undefined {
	return typeof value === 'string' ? value : value?.value;
}
