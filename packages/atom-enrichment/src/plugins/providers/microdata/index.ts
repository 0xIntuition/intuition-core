import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { BROWSER_FETCH_HEADERS, type FetchLike, fetchText } from '../__shared__/http';
import { getRequestUrl } from '../__shared__/request';
import { microdataDataSchema } from './schema';

type CreateMicrodataPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
};

const MAX_HTML_LENGTH = 1_500_000;
const MAX_JSON_LD_NODES = 12;
const MAX_NODE_JSON_LENGTH = 50_000;
const JSON_LD_SCRIPT_PATTERN =
	/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

// Hosts whose pages never carry useful entity JSON-LD for our purposes
// (platform shells; their content is owned by dedicated plugins).
const SKIPPED_HOST_SUFFIXES = [
	'maps.app.goo.gl',
	'goo.gl',
	'maps.google.com',
	'open.spotify.com',
	'wikidata.org',
];

function shouldSkipUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
		if (SKIPPED_HOST_SUFFIXES.some((suffix) => host === suffix || host.endsWith(`.${suffix}`))) {
			return true;
		}
		return (
			(host === 'google.com' || host.endsWith('.google.com')) && parsed.pathname.startsWith('/maps')
		);
	} catch {
		return true;
	}
}

function decodeJsonLdText(raw: string): string {
	// Some publishers (e.g. Letterboxd) wrap JSON-LD in CDATA comment guards;
	// others HTML-escape ampersands. Strip both before parsing.
	return raw
		.trim()
		.replace(/^\/\*\s*<!\[CDATA\[\s*\*\//, '')
		.replace(/\/\*\s*\]\]>\s*\*\/$/, '')
		.trim()
		.replace(/&amp;/g, '&');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

// Flattens a parsed ld+json payload into entity nodes: top-level arrays and
// `@graph` containers both unwrap; non-object entries are dropped.
export function flattenJsonLdNodes(parsed: unknown): Record<string, unknown>[] {
	const queue: unknown[] = Array.isArray(parsed) ? [...parsed] : [parsed];
	const nodes: Record<string, unknown>[] = [];

	while (queue.length > 0 && nodes.length < MAX_JSON_LD_NODES) {
		const entry = queue.shift();
		if (!isRecord(entry)) continue;
		const graph = entry['@graph'];
		if (Array.isArray(graph)) {
			queue.push(...graph);
			// Some publishers put properties beside @graph too; keep the node
			// itself when it carries a type.
			if (entry['@type'] === undefined) continue;
		}
		if (JSON.stringify(entry).length > MAX_NODE_JSON_LENGTH) continue;
		nodes.push(entry);
	}

	return nodes;
}

export function parseJsonLdBlocks(html: string): Record<string, unknown>[] {
	const nodes: Record<string, unknown>[] = [];
	for (const match of html.matchAll(JSON_LD_SCRIPT_PATTERN)) {
		if (nodes.length >= MAX_JSON_LD_NODES) break;
		const raw = match[1];
		if (!raw) continue;
		try {
			const parsed = JSON.parse(decodeJsonLdText(raw));
			nodes.push(...flattenJsonLdNodes(parsed));
		} catch {
			// Malformed block — publishers ship broken JSON all the time; skip.
		}
	}
	return nodes.slice(0, MAX_JSON_LD_NODES);
}

function readTitle(html: string): string | undefined {
	const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
	const title = match?.[1]?.trim();
	return title && title.length > 0 ? title.slice(0, 512) : undefined;
}

// Reads the entity's own image from json-ld nodes. Image values appear as a
// bare url string, an ImageObject ({url}), or arrays of either — Google
// requires `image` on Event/Product/Article rich results, so this is the
// page's authoritative visual for the entity.
export function readPrimaryJsonLdImage(
	nodes: readonly Record<string, unknown>[]
): string | undefined {
	for (const node of nodes) {
		const image = readImageValue(node.image);
		if (image) return image;
	}
	return undefined;
}

function readImageValue(value: unknown): string | undefined {
	const candidates = Array.isArray(value) ? value : [value];
	for (const entry of candidates) {
		if (typeof entry === 'string' && /^https?:\/\//.test(entry.trim())) {
			return entry.trim();
		}
		if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
			const url = (entry as Record<string, unknown>).url;
			if (typeof url === 'string' && /^https?:\/\//.test(url.trim())) {
				return url.trim();
			}
		}
	}
	return undefined;
}

// Extracts the page's embedded schema.org JSON-LD — the page-native tier.
// Sites mark up events, articles, job postings, products, recipes, and more
// for search engines; that markup is deterministic field data for us.
export function createMicrodataPlugin(
	options: CreateMicrodataPluginOptions = {}
): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'microdata',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['microdata'],
		priority: options.priority ?? 12,
		TTL: options.TTL ?? 2_592_000,

		supports(request: EnrichmentRequest) {
			const url = getRequestUrl(request);
			return !!url && !shouldSkipUrl(url);
		},

		async enrich(request, ctx) {
			const url = getRequestUrl(request);
			if (!url || shouldSkipUrl(url)) {
				return [];
			}

			const html = (
				await fetchText(fetcher, url, { signal: ctx.signal, headers: BROWSER_FETCH_HEADERS })
			).slice(0, MAX_HTML_LENGTH);
			const jsonLd = parseJsonLdBlocks(html);
			if (jsonLd.length === 0) {
				return [];
			}

			return [
				{
					artifact_type: 'microdata',
					data: microdataDataSchema.parse({
						url,
						title: readTitle(html),
						imageUrl: readPrimaryJsonLdImage(jsonLd),
						jsonLd,
					}),
					meta: {
						pluginId: 'microdata',
						provider: 'page-jsonld',
						fetchedAt: ctx.now(),
						sourceUrl: url,
					},
				},
			];
		},
	});
}
