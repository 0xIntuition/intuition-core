import { createSequencedDomainHtmlAdapter } from '../shared/domain-html/adapter';
import {
	extractAttributeValue,
	extractCanonicalUrl,
	extractDocumentTitle,
	extractElementTextById,
	extractMetaContent,
	normalizeWhitespace,
} from '../shared/domain-html/document';
import { type DomainHtmlFetchLike, fetchHtmlDocument } from '../shared/domain-html/fetch';
import { buildIdentityResolverAtom } from '../shared/domain-html/identity';
import { toStringMaybe } from '../shared/helpers';
import type { PlatformStageAdapter } from '../shared/platform';
import { extractAmazonAsinFromUrl } from './url';

export type AmazonDomainHtmlAdapterOptions = {
	fetch?: DomainHtmlFetchLike;
};

export type AmazonDomainHtmlAdapter = PlatformStageAdapter;

export function createAmazonDomainHtmlAdapter(
	options: AmazonDomainHtmlAdapterOptions = {}
): AmazonDomainHtmlAdapter {
	return createSequencedDomainHtmlAdapter({
		domain: 'amazon',
		subtypes: ['product'],
		fetch: options.fetch,
		sources: [
			{
				id: 'amazon-html',
				resolve: async ({ canonicalUrl, classificationMeta, fetcher }) => {
					const html = await fetchHtmlDocument(fetcher, {
						url: canonicalUrl,
					});
					if (!html) {
						return null;
					}

					const resolvedCanonicalUrl = extractCanonicalUrl(html) ?? canonicalUrl;
					// Short-link inputs carry no ASIN; the page's canonical URL does.
					const asin =
						toStringMaybe(classificationMeta.asin) ??
						extractAmazonAsinFromUrl(canonicalUrl) ??
						extractAmazonAsinFromUrl(resolvedCanonicalUrl) ??
						undefined;
					// Amazon rarely gives us useful OG data. We prefer a small set of
					// site-specific identity fields that have been stable in product HTML.
					const name =
						normalizeAmazonProductTitle(extractElementTextById(html, 'productTitle')) ??
						normalizeAmazonProductTitle(extractMetaContent(html, 'title')) ??
						normalizeAmazonProductTitle(extractDocumentTitle(html));
					if (!name) {
						return null;
					}

					const brand =
						normalizeAmazonByline(extractElementTextById(html, 'bylineInfo')) ??
						normalizeAmazonByline(extractElementTextById(html, 'brand'));
					const image = extractAmazonPrimaryImageUrl(html);
					const description = sanitizeAmazonDescription(
						extractMetaContent(html, 'description'),
						name
					);

					// Keep the publishable boundary identity-focused. Prices, ratings,
					// inventory, and other storefront state belong in enrichment, not
					// deterministic classification.
					return buildIdentityResolverAtom({
						schemaType: 'Product',
						category: 'product',
						title: name,
						description,
						canonicalId: asin ? `asin:${asin}` : resolvedCanonicalUrl,
						canonicalUrl: resolvedCanonicalUrl,
						pluginId: 'amazon',
						provider: 'amazon-html',
						fields: {
							...(asin ? { sku: asin } : {}),
							...(brand ? { brand } : {}),
							...(image ? { image } : {}),
						},
					});
				},
			},
		],
	});
}

function extractAmazonPrimaryImageUrl(html: string): string | undefined {
	return (
		extractAttributeValue(html, /id=["']landingImage["'][^>]+src=["']([^"']+)["']/i) ??
		extractAttributeValue(html, /data-old-hires=["']([^"']+)["']/i) ??
		undefined
	);
}

function normalizeAmazonProductTitle(value: string | undefined): string | undefined {
	const normalized = normalizeWhitespace(value);
	if (!normalized || normalized === 'Amazon.com') {
		return undefined;
	}

	const withoutPrefix = normalized.replace(/^Amazon\.com:\s*/i, '');
	return withoutPrefix.replace(/\s+:\s+[A-Za-z0-9&,'/() -]+$/, '').trim() || undefined;
}

function normalizeAmazonByline(value: string | undefined): string | undefined {
	const normalized = normalizeWhitespace(value);
	if (!normalized) {
		return undefined;
	}

	const visitStoreMatch = normalized.match(/^Visit the (.+?) Store$/i);
	if (visitStoreMatch?.[1]) {
		return normalizeWhitespace(visitStoreMatch[1]);
	}

	const brandMatch = normalized.match(/^Brand:\s*(.+)$/i);
	if (brandMatch?.[1]) {
		return normalizeWhitespace(brandMatch[1]);
	}

	return normalized;
}

function sanitizeAmazonDescription(
	value: string | undefined,
	productName: string
): string | undefined {
	const normalized = normalizeAmazonProductTitle(value);
	if (!normalized || normalized === productName) {
		return undefined;
	}

	return normalized;
}
