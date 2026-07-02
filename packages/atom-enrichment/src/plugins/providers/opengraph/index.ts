import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { BROWSER_FETCH_HEADERS, type FetchLike, fetchText } from '../__shared__/http';
import { getRequestUrl } from '../__shared__/request';

// Google Maps pages serve the product's own boilerplate OpenGraph ("Google
// Maps — Find local businesses…"), never metadata about the place itself —
// the places plugin owns that URL family.
function isGoogleMapsUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
		if (host === 'maps.app.goo.gl' || host === 'goo.gl' || host === 'maps.google.com') {
			return true;
		}
		return (
			(host === 'google.com' || host.endsWith('.google.com')) && parsed.pathname.startsWith('/maps')
		);
	} catch {
		return false;
	}
}

type CreateOpenGraphPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
};

export function createOpenGraphPlugin(
	options: CreateOpenGraphPluginOptions = {}
): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'opengraph',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['opengraph'],
		priority: options.priority ?? 10,
		TTL: options.TTL ?? 2_592_000,

		supports(request: EnrichmentRequest) {
			const url = getRequestUrl(request);
			return !!url && !isGoogleMapsUrl(url);
		},

		async enrich(request, ctx) {
			const url = getRequestUrl(request);
			if (!url) {
				return [];
			}

			const html = await fetchText(fetcher, url, {
				signal: ctx.signal,
				headers: BROWSER_FETCH_HEADERS,
			});

			const metadata = readOpenGraphMetadata(html);
			const audioUrl = readFirstMetadataValue(metadata, [
				'og:audio:secure_url',
				'og:audio:url',
				'og:audio',
				'twitter:player:stream',
				'music:preview_url:url',
				'music:preview_url',
			]);
			const audioType = readFirstMetadataValue(metadata, [
				'og:audio:type',
				'twitter:player:stream:content_type',
				'music:preview_url:type',
			]);

			return [
				{
					artifact_type: 'opengraph',
					data: {
						title: metadata['og:title'] ?? readTitleTag(html),
						description: metadata['og:description'],
						image: metadata['og:image'],
						url: metadata['og:url'] ?? url,
						siteName: metadata['og:site_name'],
						type: metadata['og:type'],
						locale: metadata['og:locale'],
						audio: audioUrl,
						audioUrl,
						audioType,
					},
					meta: {
						pluginId: 'opengraph',
						provider: 'website',
						fetchedAt: ctx.now(),
						sourceUrl: url,
					},
				},
			];
		},
	});
}

function readOpenGraphMetadata(html: string): Record<string, string> {
	const metaMap: Record<string, string> = {};
	const metaTagPattern = /<meta\s+[^>]*>/gi;
	const attributePattern = /([:\w-]+)\s*=\s*["']([^"']*)["']/g;

	const tags = html.match(metaTagPattern) ?? [];
	for (const tag of tags) {
		const attributes: Record<string, string> = {};
		for (const match of tag.matchAll(attributePattern)) {
			const key = match[1]?.toLowerCase();
			const value = match[2] ?? '';
			if (key) {
				attributes[key] = value;
			}
		}

		const key = attributes.property?.toLowerCase() ?? attributes.name?.toLowerCase();
		const content = attributes.content;
		if (key && content) {
			metaMap[key] = content;
		}
	}

	return metaMap;
}

function readTitleTag(html: string): string | undefined {
	const match = html.match(/<title[^>]*>([^<]+)<\/title>/i);
	if (!match?.[1]) {
		return undefined;
	}

	const title = match[1].trim();
	return title.length > 0 ? title : undefined;
}

function readFirstMetadataValue(
	metadata: Record<string, string>,
	keys: readonly string[]
): string | undefined {
	for (const key of keys) {
		const value = metadata[key];
		if (value && value.trim().length > 0) {
			return value.trim();
		}
	}

	return undefined;
}
