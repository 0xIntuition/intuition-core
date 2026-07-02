import { slugify, toStringMaybe, tryParseUrl, withPlatformMetadata } from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';
import { createImdbDomainHtmlAdapter } from './domain-html-adapter';

export type ImdbPluginOptions = PlatformV0PluginOptions & {
	useDefaultDomainHtmlAdapter?: boolean;
};

export const imdbProfile: PlatformV0Profile = {
	domain: 'imdb',
	supportsOEmbed: false,
	classifier: {
		id: 'imdb-url-classifier',
		priority: 10,
		classify(input: string) {
			const parsed = tryParseUrl(input);
			if (!parsed || !parsed.hostname.includes('imdb.com')) {
				return null;
			}

			const segments = parsed.pathname.split('/').filter(Boolean);
			if (segments.length < 2) {
				return null;
			}

			const firstSegment = segments[0];
			const secondSegment = segments[1];
			if (!firstSegment || !secondSegment) {
				return null;
			}

			if (firstSegment === 'title' && /^tt\d+$/.test(secondSegment)) {
				return {
					type: 'url' as const,
					domain: 'imdb',
					subtype: 'title',
					confidence: 0.98,
					meta: {
						titleId: secondSegment,
						canonicalUrl: `https://www.imdb.com/title/${secondSegment}/`,
					},
				};
			}

			if (firstSegment === 'name' && /^nm\d+$/.test(secondSegment)) {
				return {
					type: 'url' as const,
					domain: 'imdb',
					subtype: 'person',
					confidence: 0.97,
					meta: {
						personId: secondSegment,
						canonicalUrl: `https://www.imdb.com/name/${secondSegment}/`,
					},
				};
			}

			return null;
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		if (classification.subtype === 'person') {
			const personId = toStringMaybe(classification.meta.personId) ?? slugify(canonicalUrl);
			const name = `IMDb Person ${personId}`;
			return withPlatformMetadata(
				{
					schemaType: 'SocialMediaAccount',
					category: 'person',
					title: name,
					canonicalId: `imdb:name:${personId}`,
					sameAs: [canonicalUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'SocialMediaAccount',
						username: personId,
						platform: 'imdb',
						url: canonicalUrl,
						sameAs: [canonicalUrl],
					},
				},
				'imdb',
				classification.subtype,
				{
					pluginId: 'imdb',
					provider: 'imdb',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
				}
			);
		}

		const titleId = toStringMaybe(classification.meta.titleId) ?? slugify(canonicalUrl);
		const name = `IMDb Title ${titleId}`;
		return withPlatformMetadata(
			{
				schemaType: 'Movie',
				category: 'thing',
				title: name,
				canonicalId: `imdb:title:${titleId}`,
				sameAs: [canonicalUrl],
				data: {
					'@context': 'https://schema.org/',
					'@type': 'Movie',
					name,
					sameAs: [canonicalUrl],
				},
			},
			'imdb',
			classification.subtype,
			{
				pluginId: 'imdb',
				provider: 'imdb',
				fetchedAt: now,
				sourceUrl: canonicalUrl,
				confidence: classification.confidence,
			}
		);
	},
};

export function createImdbPlugin(options: ImdbPluginOptions = {}) {
	const { useDefaultDomainHtmlAdapter = true, ...platformOptions } = options;
	const domainHtmlAdapter =
		platformOptions.adapters?.domainHtml ??
		(useDefaultDomainHtmlAdapter ? createImdbDomainHtmlAdapter() : undefined);

	return createPlatformPlugin({
		pluginId: 'imdb',
		resolverId: 'imdb-resolver',
		profile: imdbProfile,
		options: {
			...platformOptions,
			adapters: {
				...platformOptions.adapters,
				domainHtml: domainHtmlAdapter,
			},
		},
	});
}
