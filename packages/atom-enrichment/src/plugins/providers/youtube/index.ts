import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getIdentifier, getRequestName, getRequestUrl } from '../__shared__/request';
import { youTubeVideoResponseSchema } from './external';
import { youtubeDataSchema } from './schema';

type CreateYouTubePluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	apiKey?: string;
};

type YouTubeVideoResponse = {
	items?: Array<{
		id?: string;
		snippet?: {
			title?: string;
			description?: string;
			channelTitle?: string;
			channelId?: string;
			publishedAt?: string;
			thumbnails?: {
				default?: { url?: string };
				medium?: { url?: string };
				high?: { url?: string };
			};
			tags?: string[];
		};
		contentDetails?: { duration?: string };
		statistics?: { viewCount?: string; likeCount?: string };
		player?: { embedHtml?: string };
	}>;
};

const youtubeVideoIdPattern = /^[A-Za-z0-9_-]{11}$/;

export function createYouTubePlugin(options: CreateYouTubePluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'youtube',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['youtube'],
		priority: options.priority ?? 42,
		TTL: options.TTL ?? 3_600,

		supports(request: EnrichmentRequest) {
			return !!resolveYouTubeVideoId(request);
		},

		async enrich(request, ctx) {
			const videoId = resolveYouTubeVideoId(request);
			if (!videoId) {
				return [];
			}

			const query = new URLSearchParams({
				part: 'snippet,contentDetails,statistics,player',
				id: videoId,
			});
			if (options.apiKey) {
				query.set('key', options.apiKey);
			}

			const payload = await fetchJsonWithSchema(
				fetcher,
				`https://www.googleapis.com/youtube/v3/videos?${query.toString()}`,
				youTubeVideoResponseSchema,
				{ signal: ctx.signal }
			);

			const item = payload.items?.[0];
			if (!item) {
				return [];
			}

			const snippet = item.snippet ?? {};
			const thumbnailUrl =
				snippet.thumbnails?.high?.url ??
				snippet.thumbnails?.medium?.url ??
				snippet.thumbnails?.default?.url;
			const sourceUrl = `https://www.youtube.com/watch?v=${videoId}`;

			return [
				{
					artifact_type: 'youtube',
					data: youtubeDataSchema.parse({
						videoId,
						title: snippet.title ?? videoId,
						description: snippet.description,
						channelTitle: snippet.channelTitle,
						channelId: snippet.channelId,
						publishedAt: snippet.publishedAt,
						thumbnailUrl,
						duration: item.contentDetails?.duration,
						viewCount: parseCount(item.statistics?.viewCount),
						likeCount: parseCount(item.statistics?.likeCount),
						tags: snippet.tags,
						embedHtml: item.player?.embedHtml,
					}),
					meta: {
						pluginId: 'youtube',
						provider: 'youtube',
						fetchedAt: ctx.now(),
						sourceUrl,
					},
				},
			];
		},
	});
}

function resolveYouTubeVideoId(request: EnrichmentRequest): string | undefined {
	const identifier = getIdentifier(request, 'youtube', 'youtubeVideoId', 'videoId');
	if (identifier && youtubeVideoIdPattern.test(identifier)) {
		return identifier;
	}

	const url = getRequestUrl(request);
	if (url) {
		const fromUrl = parseYouTubeVideoIdFromUrl(url);
		if (fromUrl) {
			return fromUrl;
		}
	}

	const name = getRequestName(request);
	if (name && youtubeVideoIdPattern.test(name)) {
		return name;
	}

	return undefined;
}

function parseYouTubeVideoIdFromUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		const host = parsed.hostname.replace(/^www\./, '');

		if (host === 'youtu.be') {
			const candidate = parsed.pathname.replace(/^\//, '').split('/')[0];
			if (!candidate) {
				return undefined;
			}

			return youtubeVideoIdPattern.test(candidate) ? candidate : undefined;
		}

		if (host === 'youtube.com' || host === 'm.youtube.com') {
			const fromQuery = parsed.searchParams.get('v');
			if (fromQuery && youtubeVideoIdPattern.test(fromQuery)) {
				return fromQuery;
			}

			const shortsMatch = parsed.pathname.match(/^\/shorts\/([A-Za-z0-9_-]{11})/);
			if (shortsMatch?.[1]) {
				return shortsMatch[1];
			}

			const embedMatch = parsed.pathname.match(/^\/embed\/([A-Za-z0-9_-]{11})/);
			if (embedMatch?.[1]) {
				return embedMatch[1];
			}
		}

		return undefined;
	} catch {
		return undefined;
	}
}

function parseCount(value: string | undefined): number | undefined {
	if (!value) {
		return undefined;
	}

	const parsed = Number.parseInt(value, 10);
	return Number.isFinite(parsed) ? parsed : undefined;
}
