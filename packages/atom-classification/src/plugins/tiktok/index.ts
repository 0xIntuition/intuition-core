import { slugify, toStringMaybe, tryParseUrl, withPlatformMetadata } from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';

export type TikTokPluginOptions = PlatformV0PluginOptions;

export const tiktokProfile: PlatformV0Profile = {
	domain: 'tiktok',
	supportsOEmbed: true,
	classifier: {
		id: 'tiktok-url-classifier',
		priority: 10,
		classify(input: string) {
			const parsed = tryParseUrl(input);
			if (!parsed || !parsed.hostname.includes('tiktok.com')) {
				return null;
			}

			const segments = parsed.pathname.split('/').filter(Boolean);
			const firstSegment = segments[0];
			const secondSegment = segments[1];
			const thirdSegment = segments[2];
			if (!firstSegment || !firstSegment.startsWith('@')) {
				return null;
			}

			if (secondSegment === 'video' && thirdSegment) {
				return {
					type: 'url' as const,
					domain: 'tiktok',
					subtype: 'video',
					confidence: 0.98,
					meta: {
						handle: firstSegment.slice(1),
						videoId: thirdSegment,
						canonicalUrl: `https://www.tiktok.com/@${firstSegment.slice(1)}/video/${thirdSegment}`,
					},
				};
			}

			return {
				type: 'url' as const,
				domain: 'tiktok',
				subtype: 'profile',
				confidence: 0.91,
				meta: {
					handle: firstSegment.slice(1),
					canonicalUrl: `https://www.tiktok.com/@${firstSegment.slice(1)}`,
				},
			};
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		if (classification.subtype === 'profile') {
			const handle = toStringMaybe(classification.meta.handle) ?? 'unknown';
			const name = `TikTok @${handle}`;
			return withPlatformMetadata(
				{
					schemaType: 'SocialMediaAccount',
					category: 'person',
					title: name,
					canonicalId: `tiktok:user:${handle.toLowerCase()}`,
					sameAs: [canonicalUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'SocialMediaAccount',
						username: handle,
						platform: 'tiktok',
						url: canonicalUrl,
						sameAs: [canonicalUrl],
					},
				},
				'tiktok',
				classification.subtype,
				{
					pluginId: 'tiktok',
					provider: 'tiktok',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
				}
			);
		}

		const videoId = toStringMaybe(classification.meta.videoId) ?? '';
		const name = `TikTok Video ${videoId}`.trim();
		return withPlatformMetadata(
			{
				schemaType: 'VideoObject',
				category: 'thing',
				title: name,
				canonicalId: `tiktok:video:${videoId || slugify(canonicalUrl)}`,
				sameAs: [canonicalUrl],
				data: {
					'@context': 'https://schema.org/',
					'@type': 'VideoObject',
					name,
					contentUrl: canonicalUrl,
					sameAs: [canonicalUrl],
				},
			},
			'tiktok',
			classification.subtype,
			{
				pluginId: 'tiktok',
				provider: 'tiktok',
				fetchedAt: now,
				sourceUrl: canonicalUrl,
				confidence: classification.confidence,
			}
		);
	},
};

export function createTikTokPlugin(options: TikTokPluginOptions = {}) {
	return createPlatformPlugin({
		pluginId: 'tiktok',
		resolverId: 'tiktok-resolver',
		profile: tiktokProfile,
		options,
	});
}
