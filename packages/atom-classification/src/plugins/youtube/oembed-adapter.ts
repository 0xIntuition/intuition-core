import type { ResolverAtom } from '../../plugins';
import type { PlatformStageAdapter } from '../shared/platform';

type FetchLike = (
	input: string,
	init?: {
		headers?: Record<string, string>;
	}
) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}>;

type YouTubeOEmbedResponse = {
	title?: string;
	author_name?: string;
	thumbnail_url?: string;
};

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export type YouTubeOEmbedAdapterOptions = {
	fetch?: FetchLike;
	endpoint?: string;
};

export type YouTubeOEmbedAdapter = PlatformStageAdapter;

export function createYouTubeOEmbedAdapter(
	options: YouTubeOEmbedAdapterOptions = {}
): YouTubeOEmbedAdapter {
	const fetcher = options.fetch ?? resolveGlobalFetch();
	const endpoint = toStringMaybe(options.endpoint) ?? 'https://www.youtube.com/oembed';

	return async ({ domain, classification, canonicalUrl }) => {
		if (domain !== 'youtube') {
			return null;
		}

		if (classification.subtype !== 'video') {
			return null;
		}

		if (!fetcher) {
			return null;
		}

		const videoId =
			toStringMaybe(classification.meta.videoId) ?? extractYouTubeVideoIdFromUrl(canonicalUrl);
		const oembedUrl = new URL(endpoint);
		oembedUrl.searchParams.set('url', canonicalUrl);
		oembedUrl.searchParams.set('format', 'json');

		const response = await fetcher(oembedUrl.toString(), {
			headers: {
				accept: 'application/json',
			},
		});
		if (!response.ok) {
			return null;
		}

		const payload = toRecordMaybe(await response.json()) as YouTubeOEmbedResponse | undefined;
		const title = toStringMaybe(payload?.title);
		if (!title) {
			return null;
		}

		const authorName = toStringMaybe(payload?.author_name);
		const thumbnailUrl = toStringMaybe(payload?.thumbnail_url);

		return {
			schemaType: 'VideoObject',
			category: 'thing',
			title,
			canonicalId: `youtube:video:${videoId ?? slugify(canonicalUrl)}`,
			sameAs: [canonicalUrl],
			data: {
				'@context': 'https://schema.org/',
				'@type': 'VideoObject',
				name: title,
				url: canonicalUrl,
				contentUrl: canonicalUrl,
				sameAs: [canonicalUrl],
				...(authorName
					? {
							author: authorName,
						}
					: {}),
				...(thumbnailUrl
					? {
							thumbnailUrl,
						}
					: {}),
			},
			metadata: {
				pluginId: 'youtube',
				provider: 'youtube-oembed',
				sourceUrl: canonicalUrl,
			},
		} satisfies ResolverAtom;
	};
}

function resolveGlobalFetch(): FetchLike | undefined {
	const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
	if (typeof globalFetch !== 'function') {
		return undefined;
	}

	return globalFetch;
}

function extractYouTubeVideoIdFromUrl(value: string): string | undefined {
	try {
		const parsed = new URL(value);
		const normalizedHost = parsed.hostname.toLowerCase().replace(/^www\./, '');

		if (normalizedHost === 'youtu.be') {
			const candidate = parsed.pathname.split('/').filter(Boolean)[0];
			if (candidate && YOUTUBE_VIDEO_ID_PATTERN.test(candidate)) {
				return candidate;
			}

			return undefined;
		}

		if (
			normalizedHost !== 'youtube.com' &&
			normalizedHost !== 'm.youtube.com' &&
			normalizedHost !== 'youtube-nocookie.com'
		) {
			return undefined;
		}

		const fromQuery = parsed.searchParams.get('v');
		if (fromQuery && YOUTUBE_VIDEO_ID_PATTERN.test(fromQuery)) {
			return fromQuery;
		}

		const segments = parsed.pathname.split('/').filter(Boolean);
		const firstSegment = segments[0];
		const secondSegment = segments[1];
		if (
			secondSegment &&
			(firstSegment === 'shorts' || firstSegment === 'embed') &&
			YOUTUBE_VIDEO_ID_PATTERN.test(secondSegment)
		) {
			return secondSegment;
		}

		return undefined;
	} catch {
		return undefined;
	}
}

function toStringMaybe(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toRecordMaybe(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function slugify(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/(^-|-$)/g, '');
}
