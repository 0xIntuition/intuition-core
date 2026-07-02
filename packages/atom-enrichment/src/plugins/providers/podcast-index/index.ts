import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getIdentifier, getRequestUrl } from '../__shared__/request';
import { podcastIndexFeedResponseSchema } from './external';
import { podcastIndexDataSchema } from './schema';

type CreatePodcastIndexPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	apiKey?: string;
	apiSecret?: string;
};

type PodcastIndexTarget =
	| { kind: 'feedUrl'; value: string }
	| { kind: 'itunesId'; value: string }
	| { kind: 'guid'; value: string }
	| { kind: 'feedId'; value: string };

const API_BASE = 'https://api.podcastindex.org/api/1.0';
// Podcast Index rejects requests without a User-Agent.
const USER_AGENT = 'Intuition/1.0';
const NUMERIC_ID_PATTERN = /^\d+$/;

// Cross-provider augmentation target: resolves canonical podcast feeds (RSS
// feedUrl, podcastGuid, category taxonomy) from identifiers harvested off
// Spotify/Apple artifacts. Requires free credentials from
// https://api.podcastindex.org — without them the plugin never activates.
export function createPodcastIndexPlugin(
	options: CreatePodcastIndexPluginOptions = {}
): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'podcast-index',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['podcast-index'],
		priority: options.priority ?? 47,
		TTL: options.TTL ?? 43_200,

		supports(request: EnrichmentRequest) {
			if (!(options.apiKey && options.apiSecret)) {
				return false;
			}
			return !!resolvePodcastIndexTarget(request);
		},

		async enrich(request, ctx) {
			const { apiKey, apiSecret } = options;
			if (!(apiKey && apiSecret)) {
				return [];
			}
			const target = resolvePodcastIndexTarget(request);
			if (!target) {
				return [];
			}

			const endpoint = buildEndpoint(target);
			const headers = await buildAuthHeaders(apiKey, apiSecret);
			const payload = await fetchJsonWithSchema(fetcher, endpoint, podcastIndexFeedResponseSchema, {
				signal: ctx.signal,
				headers,
			});

			// Misses come back as status "true" with an empty-array feed.
			const feed = payload.feed;
			if (!feed || Array.isArray(feed)) {
				return [];
			}
			if (!(feed.title && feed.url)) {
				return [];
			}

			const artworkUrl = feed.artwork || feed.image || undefined;
			const categories = feed.categories ? Object.values(feed.categories) : undefined;
			const sourceUrl = `https://podcastindex.org/podcast/${feed.id}`;

			return [
				{
					artifact_type: 'podcast-index',
					data: podcastIndexDataSchema.parse({
						podcastIndexId: feed.id,
						title: feed.title,
						feedUrl: feed.url,
						podcastGuid: feed.podcastGuid || undefined,
						link: safeHttpUrl(feed.link),
						description: feed.description || undefined,
						author: feed.author || undefined,
						ownerName: feed.ownerName || undefined,
						artworkUrl: safeHttpUrl(artworkUrl),
						itunesId: feed.itunesId ?? undefined,
						language: feed.language || undefined,
						categories: categories && categories.length > 0 ? categories : undefined,
						episodeCount: feed.episodeCount,
					}),
					meta: {
						pluginId: 'podcast-index',
						provider: 'podcast-index',
						fetchedAt: ctx.now(),
						sourceUrl,
					},
				},
			];
		},
	});
}

function buildEndpoint(target: PodcastIndexTarget): string {
	const value = encodeURIComponent(target.value);
	switch (target.kind) {
		case 'feedUrl':
			return `${API_BASE}/podcasts/byfeedurl?url=${value}`;
		case 'itunesId':
			return `${API_BASE}/podcasts/byitunesid?id=${value}`;
		case 'guid':
			return `${API_BASE}/podcasts/byguid?guid=${value}`;
		case 'feedId':
			return `${API_BASE}/podcasts/byfeedid?id=${value}`;
		default:
			return target satisfies never;
	}
}

// Podcast Index auth: Authorization = sha1(apiKey + apiSecret + X-Auth-Date),
// where X-Auth-Date is the unix timestamp in seconds.
export async function buildAuthHeaders(
	apiKey: string,
	apiSecret: string,
	nowSeconds = Math.floor(Date.now() / 1000)
): Promise<Record<string, string>> {
	const authDate = String(nowSeconds);
	const digest = await globalThis.crypto.subtle.digest(
		'SHA-1',
		new TextEncoder().encode(`${apiKey}${apiSecret}${authDate}`)
	);
	const authorization = Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
	return {
		'X-Auth-Key': apiKey,
		'X-Auth-Date': authDate,
		Authorization: authorization,
		'User-Agent': USER_AGENT,
	};
}

function safeHttpUrl(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? value : undefined;
	} catch {
		return undefined;
	}
}

export function resolvePodcastIndexTarget(
	request: EnrichmentRequest
): PodcastIndexTarget | undefined {
	const feedUrl = getIdentifier(request, 'feedUrl', 'rssFeedUrl');
	if (feedUrl) {
		return { kind: 'feedUrl', value: feedUrl };
	}

	const guid = getIdentifier(request, 'podcastGuid');
	if (guid) {
		return { kind: 'guid', value: guid };
	}

	const itunesId = getIdentifier(request, 'itunesId');
	if (itunesId && NUMERIC_ID_PATTERN.test(itunesId)) {
		return { kind: 'itunesId', value: itunesId };
	}

	const url = getRequestUrl(request);
	if (!url) {
		return undefined;
	}
	return parsePodcastIndexUrl(url);
}

// Podcast Index URLs: podcastindex.org/podcast/{feedId}
export function parsePodcastIndexUrl(url: string): PodcastIndexTarget | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
	if (host !== 'podcastindex.org') {
		return undefined;
	}
	const segments = parsed.pathname.split('/').filter(Boolean);
	if (segments[0] === 'podcast' && segments[1] && NUMERIC_ID_PATTERN.test(segments[1])) {
		return { kind: 'feedId', value: segments[1] };
	}
	return undefined;
}
