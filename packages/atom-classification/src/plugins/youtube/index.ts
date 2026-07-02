import { slugify, toStringMaybe, tryParseUrl, withPlatformMetadata } from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';
import { createYouTubeOEmbedAdapter } from './oembed-adapter';

const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export type YouTubePluginOptions = PlatformV0PluginOptions & {
	useDefaultOEmbedAdapter?: boolean;
};

export const youtubeProfile: PlatformV0Profile = {
	domain: 'youtube',
	supportsOEmbed: true,
	classifier: {
		id: 'youtube-url-classifier',
		priority: 10,
		classify(input: string) {
			const parsed = tryParseUrl(input);
			if (!parsed) {
				return null;
			}

			const videoId = parseYouTubeVideoId(parsed);
			if (!videoId) {
				return null;
			}

			const canonicalUrl = `https://www.youtube.com/watch?v=${videoId}`;
			return {
				type: 'url' as const,
				domain: 'youtube',
				subtype: 'video',
				confidence: 0.99,
				meta: {
					videoId,
					canonicalUrl,
				},
			};
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		const videoId = toStringMaybe(classification.meta.videoId) ?? '';
		const name = `YouTube Video ${videoId}`.trim();
		return withPlatformMetadata(
			{
				schemaType: 'VideoObject',
				category: 'thing',
				title: name,
				canonicalId: `youtube:video:${videoId || slugify(canonicalUrl)}`,
				sameAs: [canonicalUrl],
				data: {
					'@context': 'https://schema.org/',
					'@type': 'VideoObject',
					name,
					contentUrl: canonicalUrl,
					sameAs: [canonicalUrl],
				},
			},
			'youtube',
			classification.subtype,
			{
				pluginId: 'youtube',
				provider: 'youtube',
				fetchedAt: now,
				sourceUrl: canonicalUrl,
				confidence: classification.confidence,
			}
		);
	},
};

export function createYouTubePlugin(options: YouTubePluginOptions = {}) {
	const { useDefaultOEmbedAdapter = true, ...platformOptions } = options;
	const oEmbedAdapter =
		platformOptions.adapters?.oEmbed ??
		(useDefaultOEmbedAdapter ? createYouTubeOEmbedAdapter() : undefined);

	return createPlatformPlugin({
		pluginId: 'youtube',
		resolverId: 'youtube-resolver',
		profile: youtubeProfile,
		options: {
			...platformOptions,
			adapters: {
				...platformOptions.adapters,
				oEmbed: oEmbedAdapter,
			},
		},
	});
}

export type { YouTubeOEmbedAdapter, YouTubeOEmbedAdapterOptions } from './oembed-adapter';
export { createYouTubeOEmbedAdapter } from './oembed-adapter';

function parseYouTubeVideoId(parsed: URL): string | undefined {
	const host = parsed.hostname.toLowerCase();
	const normalizedHost = host.replace(/^www\./, '');

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
	if (!firstSegment || !secondSegment) {
		return undefined;
	}

	const hasVideoSegment = firstSegment === 'shorts' || firstSegment === 'embed';
	if (!hasVideoSegment) {
		return undefined;
	}

	if (YOUTUBE_VIDEO_ID_PATTERN.test(secondSegment)) {
		return secondSegment;
	}

	return undefined;
}
