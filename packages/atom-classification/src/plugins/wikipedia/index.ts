import {
	slugify,
	toCategory,
	toStringMaybe,
	tryParseUrl,
	withPlatformMetadata,
} from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';

export type WikipediaPluginOptions = PlatformV0PluginOptions;

export const wikipediaProfile: PlatformV0Profile = {
	domain: 'wikipedia',
	supportsOEmbed: true,
	classifier: {
		id: 'wikipedia-url-classifier',
		priority: 10,
		classify(input: string) {
			const parsed = tryParseUrl(input);
			if (!parsed || !parsed.hostname.includes('wikipedia.org')) {
				return null;
			}

			const segments = parsed.pathname.split('/').filter(Boolean);
			const firstSegment = segments[0];
			if (segments.length < 2 || firstSegment !== 'wiki') {
				return null;
			}

			const articleTitle = decodeURIComponent(segments.slice(1).join('/'));
			const normalizedTitle = articleTitle.replace(/_/g, ' ');
			const inferred = inferWikipediaType(normalizedTitle);

			return {
				type: 'url' as const,
				domain: 'wikipedia',
				subtype: 'article',
				confidence: 0.95,
				meta: {
					articleTitle: normalizedTitle,
					canonicalUrl: `https://${parsed.hostname}/wiki/${encodeURIComponent(articleTitle)}`,
					inferredSchemaType: inferred.schemaType,
					inferredCategory: inferred.category,
				},
			};
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		const inferredSchema = toStringMaybe(classification.meta.inferredSchemaType) ?? 'Thing';
		const inferredCategory = toStringMaybe(classification.meta.inferredCategory) ?? 'thing';
		const articleTitle = toStringMaybe(classification.meta.articleTitle) ?? 'Wikipedia Article';

		return withPlatformMetadata(
			{
				schemaType: inferredSchema,
				category: toCategory(inferredCategory),
				title: articleTitle,
				canonicalId: `wikipedia:${slugify(articleTitle || canonicalUrl)}`,
				sameAs: [canonicalUrl],
				data: {
					'@context': 'https://schema.org/',
					'@type': inferredSchema,
					name: articleTitle,
					sameAs: [canonicalUrl],
				},
			},
			'wikipedia',
			classification.subtype,
			{
				pluginId: 'wikipedia',
				provider: 'wikipedia',
				fetchedAt: now,
				sourceUrl: canonicalUrl,
				confidence: classification.confidence,
			}
		);
	},
};

export function createWikipediaPlugin(options: WikipediaPluginOptions = {}) {
	return createPlatformPlugin({
		pluginId: 'wikipedia',
		resolverId: 'wikipedia-resolver',
		profile: wikipediaProfile,
		options,
	});
}

function inferWikipediaType(title: string): {
	schemaType: string;
	category: 'person' | 'place' | 'thing' | 'company' | 'product' | 'song' | 'software';
} {
	const lowered = title.toLowerCase();
	if (lowered.includes('(software)')) {
		return { schemaType: 'SoftwareApplication', category: 'software' };
	}

	if (lowered.includes('(company)') || lowered.includes('(organization)')) {
		return { schemaType: 'Organization', category: 'company' };
	}

	if (lowered.includes('(city)') || lowered.includes('(country)') || lowered.includes('(place)')) {
		return { schemaType: 'Place', category: 'place' };
	}

	if (lowered.includes('(person)')) {
		return { schemaType: 'Person', category: 'person' };
	}

	return { schemaType: 'Thing', category: 'thing' };
}
