import { slugify, toStringMaybe, tryParseUrl, withPlatformMetadata } from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';
import { createAmazonDomainApiAdapter } from './domain-api-adapter';
import { createAmazonDomainHtmlAdapter } from './domain-html-adapter';
import { extractAmazonAsinFromUrl, isAmazonHostname, isAmazonShortLinkUrl } from './url';

export type AmazonPluginOptions = PlatformV0PluginOptions & {
	useDefaultDomainApiAdapter?: boolean;
	useDefaultDomainHtmlAdapter?: boolean;
};

export const amazonProfile: PlatformV0Profile = {
	domain: 'amazon',
	supportsOEmbed: false,
	classifier: {
		id: 'amazon-url-classifier',
		priority: 10,
		classify(input: string) {
			const parsed = tryParseUrl(input);
			if (!parsed) {
				return null;
			}

			// Share-sheet short links (a.co, amzn.to, …) are almost always product
			// pages but carry no ASIN; the domain-api adapter resolves the redirect
			// before calling Canopy.
			if (isAmazonShortLinkUrl(input)) {
				return {
					type: 'url' as const,
					domain: 'amazon',
					subtype: 'product',
					confidence: 0.7,
					meta: {
						shortLink: true,
						canonicalUrl: input,
					},
				};
			}

			if (!isAmazonHostname(parsed.hostname)) {
				return null;
			}

			const pathname = parsed.pathname;
			const asin = extractAmazonAsinFromUrl(input);
			if (asin) {
				return {
					type: 'url' as const,
					domain: 'amazon',
					subtype: 'product',
					confidence: 0.96,
					meta: {
						asin,
						canonicalUrl: `https://${parsed.hostname}/dp/${asin}`,
					},
				};
			}

			if (pathname.includes('/stores/')) {
				return {
					type: 'url' as const,
					domain: 'amazon',
					subtype: 'store',
					confidence: 0.9,
					meta: {
						canonicalUrl: `https://${parsed.hostname}${pathname}`,
					},
				};
			}

			return null;
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		if (classification.subtype === 'store') {
			const name = 'Amazon Storefront';
			return withPlatformMetadata(
				{
					schemaType: 'Organization',
					category: 'company',
					title: name,
					canonicalId: `amazon:store:${slugify(canonicalUrl)}`,
					sameAs: [canonicalUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'Organization',
						name,
						url: canonicalUrl,
						sameAs: [canonicalUrl],
					},
				},
				'amazon',
				classification.subtype,
				{
					pluginId: 'amazon',
					provider: 'amazon',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
				}
			);
		}

		const asin = toStringMaybe(classification.meta.asin) ?? '';
		const name = `Amazon Product ${asin}`.trim();
		return withPlatformMetadata(
			{
				schemaType: 'Product',
				category: 'product',
				title: name,
				canonicalId: `asin:${asin || slugify(canonicalUrl)}`,
				sameAs: [canonicalUrl],
				data: {
					'@context': 'https://schema.org/',
					'@type': 'Product',
					name,
					url: canonicalUrl,
					sameAs: [canonicalUrl],
					...(asin
						? {
								sku: asin,
							}
						: {}),
				},
			},
			'amazon',
			classification.subtype,
			{
				pluginId: 'amazon',
				provider: 'amazon',
				fetchedAt: now,
				sourceUrl: canonicalUrl,
				confidence: classification.confidence,
			}
		);
	},
};

export function createAmazonPlugin(options: AmazonPluginOptions = {}) {
	const {
		useDefaultDomainApiAdapter = true,
		useDefaultDomainHtmlAdapter = true,
		...platformOptions
	} = options;
	const domainApiAdapter =
		platformOptions.adapters?.domainApi ??
		(useDefaultDomainApiAdapter ? createAmazonDomainApiAdapter() : undefined);
	const domainHtmlAdapter =
		platformOptions.adapters?.domainHtml ??
		(useDefaultDomainHtmlAdapter ? createAmazonDomainHtmlAdapter() : undefined);

	return createPlatformPlugin({
		pluginId: 'amazon',
		resolverId: 'amazon-resolver',
		profile: amazonProfile,
		options: {
			...platformOptions,
			adapters: {
				...platformOptions.adapters,
				domainApi: domainApiAdapter,
				domainHtml: domainHtmlAdapter,
			},
		},
	});
}
