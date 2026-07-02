import type {
	ClassificationCanonicalFieldPolicyMap,
	ClassificationCanonicalMeta,
	ClassificationSourceFamily,
} from './types';

export const PUBLISHABLE_STABLE_FIELDS = new Set([
	'name',
	'alternateName',
	'identifier',
	'url',
	'contentUrl',
	'canonicalUrl',
	'sameAs',
	'brand',
	'sku',
	'gtin',
	'isbn',
	'termCode',
	'address',
	'chainId',
	'username',
	'platform',
]);

// These fields may exist in canonical classifications, but they are intentionally
// stripped from `resolved.publishable` because they are too time-sensitive for
// IPFS/on-chain publishing.
export const NON_PUBLISHABLE_VOLATILE_FIELDS = new Set([
	'offers',
	'aggregateRating',
	'review',
	'reviewCount',
	'price',
	'priceCurrency',
	'lowPrice',
	'highPrice',
	'availability',
	'itemCondition',
]);

export const NON_PUBLISHABLE_MEDIA_FIELDS = new Set(['image', 'thumbnailUrl', 'logo', 'media']);

const RICH_PUBLIC_FIELDS_BY_PLUGIN: Partial<
	Record<string, Partial<Record<ClassificationSourceFamily, Set<string>>>>
> = {
	x: {
		'domain-api': new Set(['text', 'author', 'datePublished']),
		'public-json': new Set(['text', 'author', 'datePublished']),
	},
};

export function getFieldPolicy(
	meta: ClassificationCanonicalMeta,
	key: string
):
	| {
			promotionTier: 'identity' | 'rich-public' | 'volatile';
			sourceFamily?: ClassificationSourceFamily;
	  }
	| undefined {
	const fieldPolicies = meta.fieldPolicies as ClassificationCanonicalFieldPolicyMap | undefined;
	const fieldPolicy = fieldPolicies?.[key];
	if (!fieldPolicy) {
		return undefined;
	}

	return {
		promotionTier: fieldPolicy.promotionTier,
		sourceFamily: fieldPolicy.sourceFamily ?? meta.sourceFamily,
	};
}

export function isRichPublicFieldAllowed(meta: ClassificationCanonicalMeta, key: string): boolean {
	const fieldPolicy = getFieldPolicy(meta, key);
	const sourceFamily = fieldPolicy?.sourceFamily ?? meta.sourceFamily;
	if (!sourceFamily) {
		return false;
	}

	const pluginPolicies = RICH_PUBLIC_FIELDS_BY_PLUGIN[meta.pluginId];
	const allowedFields = pluginPolicies?.[sourceFamily];
	return allowedFields ? allowedFields.has(key) : false;
}
