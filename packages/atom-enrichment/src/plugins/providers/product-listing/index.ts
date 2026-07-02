import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import {
	extractAmazonAsinFromUrl,
	isAmazonShortLinkUrl,
	normalizeAmazonCanonicalUrl,
	resolveAmazonMarketplace,
	resolveAmazonShortLink,
} from '../__shared__/amazon';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getAmazonTarget, getRequestUrl } from '../__shared__/request';
import { canopyAmazonProductResponseSchema } from './external';
import { productListingDataSchema } from './schema';

type CreateProductListingPluginOptions = {
	apiKey?: string;
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
};

const CANOPY_BASE_URL = 'https://rest.canopyapi.co/api/amazon/product';

export function createProductListingPlugin(
	options: CreateProductListingPluginOptions = {}
): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'product-listing',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['product-listing'],
		priority: options.priority ?? 44,
		TTL: options.TTL ?? 300,

		supports(request: EnrichmentRequest) {
			const target = resolveAmazonProductTarget(request);
			return target?.kind === 'product' || isAmazonShortLinkUrl(getRequestUrl(request));
		},

		async enrich(request, ctx) {
			let target = resolveAmazonProductTarget(request);

			const url = getRequestUrl(request);
			if (!target && url && isAmazonShortLinkUrl(url)) {
				if (!options.apiKey) {
					throw new Error(
						'Authentication required for product-listing enrichment: CANOPY_API_KEY is missing.'
					);
				}
				const destination = await resolveAmazonShortLink(fetcher, url, ctx.signal);
				const asin = destination ? extractAmazonAsinFromUrl(destination) : undefined;
				if (destination && asin) {
					target = {
						kind: 'product',
						asin,
						canonicalUrl: normalizeAmazonCanonicalUrl(destination, asin),
						marketplace: resolveAmazonMarketplace(destination),
					};
				}
			}

			if (!target || target.kind !== 'product') {
				return [];
			}

			if (!options.apiKey) {
				throw new Error(
					'Authentication required for product-listing enrichment: CANOPY_API_KEY is missing.'
				);
			}

			const payload = await fetchJsonWithSchema(
				fetcher,
				buildCanopyProductUrl(target.canonicalUrl, target.asin, target.marketplace),
				canopyAmazonProductResponseSchema,
				{
					signal: ctx.signal,
					headers: {
						Accept: 'application/json',
						'API-KEY': options.apiKey,
					},
				}
			);
			const product = toRecordMaybe(payload.data?.amazonProduct);
			if (!product) {
				return [];
			}

			const name = toStringMaybe(product.title);
			if (!name) {
				return [];
			}

			const canonicalUrl = toStringMaybe(product.url) ?? target.canonicalUrl;

			return [
				{
					artifact_type: 'product-listing',
					data: productListingDataSchema.parse({
						name,
						brand: toStringMaybe(product.brand),
						description: resolveDescription(product),
						price: resolveStringLike(product.currentPrice) ?? resolveStringLike(product.price),
						currency:
							toStringMaybe(product.currencyCode) ?? toStringMaybe(product.currency) ?? undefined,
						imageUrl: toStringMaybe(product.mainImageUrl) ?? extractFirstString(product.imageUrls),
						rating: toNumberMaybe(product.rating) ?? toNumberMaybe(product.ratingValue),
						reviewCount:
							toNumberMaybe(product.reviewCount) ??
							toNumberMaybe(product.ratingsTotal) ??
							toNumberMaybe(product.totalReviews),
						availability:
							toStringMaybe(product.availability) ??
							toStringMaybe(product.availabilityText) ??
							toStringMaybe(product.availabilityStatus) ??
							undefined,
						sku: toStringMaybe(product.asin) ?? target.asin,
						gtin:
							toStringMaybe(product.gtin) ??
							toStringMaybe(product.upc) ??
							toStringMaybe(product.ean) ??
							undefined,
					}),
					meta: {
						pluginId: 'product-listing',
						provider: 'product-listing',
						fetchedAt: ctx.now(),
						sourceUrl: canonicalUrl,
					},
				},
			];
		},
	});
}

function resolveAmazonProductTarget(
	request: EnrichmentRequest
): ReturnType<typeof getAmazonTarget> | undefined {
	const explicitTarget = getAmazonTarget(request);
	if (explicitTarget) {
		return explicitTarget;
	}

	const url = getRequestUrl(request);
	if (!url) {
		return undefined;
	}

	const asin = extractAmazonAsinFromUrl(url);
	if (!asin) {
		return undefined;
	}

	return {
		kind: 'product',
		asin,
		canonicalUrl: normalizeAmazonCanonicalUrl(url, asin),
		marketplace: resolveAmazonMarketplace(url),
	};
}

function buildCanopyProductUrl(canonicalUrl: string, asin: string, marketplace?: string): string {
	const params = new URLSearchParams({
		asin,
		domain: marketplace ?? resolveAmazonMarketplace(canonicalUrl) ?? 'US',
	});
	return `${CANOPY_BASE_URL}?${params.toString()}`;
}

function resolveDescription(product: Record<string, unknown>): string | undefined {
	const featureSummary = extractStringArray(product.featureBullets).slice(0, 3).join(' ');
	return (
		toStringMaybe(product.description) ??
		toStringMaybe(product.subtitle) ??
		(featureSummary.length > 0 ? featureSummary : undefined)
	);
}

function extractFirstString(value: unknown): string | undefined {
	return extractStringArray(value)[0];
}

function extractStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is string => typeof entry === 'string')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

function toNumberMaybe(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	if (typeof value === 'string') {
		const normalized = Number(value);
		return Number.isFinite(normalized) ? normalized : undefined;
	}

	return undefined;
}

function resolveStringLike(value: unknown): string | undefined {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value.toString();
	}

	return toStringMaybe(value);
}

function toRecordMaybe(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function toStringMaybe(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}
