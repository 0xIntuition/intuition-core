// Page-native tier: maps the page's own schema.org JSON-LD (microdata
// artifact) onto the target classification's fields. Because publishers mark
// up events, articles, job postings, products, and places for search engines,
// this single mapper covers dozens of URL families with zero per-site code.
// Ranks below provider-specific extractors and above the OG generic tier.

import { field, findArtifactData, parseMicrodata, readString } from './shared';
import type { ExtractedField, ExtractionContext } from './types';

const PAGE_NATIVE_CONFIDENCE = 0.85;

// Acceptable node @type values per spec schema.org type (identity + common
// schema.org subtypes). A node matches when any of its types appear here.
const SCHEMA_TYPE_FAMILIES: Record<string, readonly string[]> = {
	Person: ['Person'],
	Organization: [
		'Organization',
		'Corporation',
		'NGO',
		'EducationalOrganization',
		'GovernmentOrganization',
		'SportsOrganization',
		'NewsMediaOrganization',
	],
	Brand: ['Brand', 'Organization'],
	LocalBusiness: [
		'LocalBusiness',
		'Restaurant',
		'CafeOrCoffeeShop',
		'FoodEstablishment',
		'Store',
		'Hotel',
		'LodgingBusiness',
		'BarOrPub',
		'HealthAndBeautyBusiness',
		'AutomotiveBusiness',
	],
	Place: [
		'Place',
		'TouristAttraction',
		'Museum',
		'Park',
		'LandmarksOrHistoricalBuildings',
		'City',
		'CivicStructure',
		'LocalBusiness',
	],
	Event: [
		'Event',
		'MusicEvent',
		'Festival',
		'SportsEvent',
		'TheaterEvent',
		'ComedyEvent',
		'SocialEvent',
		'EducationEvent',
		'BusinessEvent',
		'ScreeningEvent',
		'ExhibitionEvent',
		'DanceEvent',
		'FoodEvent',
		'Hackathon',
	],
	Article: ['Article', 'NewsArticle', 'BlogPosting', 'ScholarlyArticle', 'Report', 'TechArticle'],
	NewsArticle: ['NewsArticle', 'ReportageNewsArticle', 'AnalysisNewsArticle', 'Article'],
	JobPosting: ['JobPosting'],
	Product: ['Product', 'IndividualProduct', 'ProductModel', 'Vehicle'],
	Book: ['Book'],
	Movie: ['Movie'],
	TVSeries: ['TVSeries'],
	MusicRecording: ['MusicRecording'],
	MusicAlbum: ['MusicAlbum'],
	MusicGroup: ['MusicGroup'],
	PodcastEpisode: ['PodcastEpisode', 'AudioObject'],
	// Apple Podcasts marks shows as CreativeWorkSeries (verified live).
	PodcastSeries: ['PodcastSeries', 'PodcastShow', 'CreativeWorkSeries'],
	VideoObject: ['VideoObject', 'Clip'],
	Review: ['Review', 'UserReview', 'CriticReview'],
	Dataset: ['Dataset'],
	WebSite: ['WebSite'],
	WebPage: ['WebPage'],
	SoftwareApplication: ['SoftwareApplication', 'WebApplication', 'VideoGame'],
	MobileApplication: ['MobileApplication', 'SoftwareApplication'],
	SoftwareSourceCode: ['SoftwareSourceCode'],
	ImageObject: ['ImageObject'],
	Service: ['Service'],
	Comment: ['Comment'],
	SocialMediaPosting: ['SocialMediaPosting'],
	AggregateRating: ['AggregateRating'],
	DefinedTerm: ['DefinedTerm'],
	Thing: [], // any typed node qualifies — handled explicitly below
};

// Spec field key → candidate node properties, tried in order. The field key
// itself is always tried first.
const FIELD_ALIASES: Record<string, readonly string[]> = {
	name: ['headline', 'title'],
	headline: ['name'],
	title: ['name', 'headline'],
	description: ['abstract'],
	datePublished: ['dateCreated', 'uploadDate'],
	dateCreated: ['datePublished'],
	author: ['creator'],
	text: ['articleBody'],
	url: ['mainEntityOfPage', '@id'],
	gtin: ['gtin13', 'gtin12', 'gtin14'],
	contentUrl: ['embedUrl'],
	reviewCount: ['ratingCount'],
	downloadUrl: ['installUrl'],
};

// Node types that describe the page or site chrome rather than the entity.
const BOILERPLATE_TYPES = new Set([
	'BreadcrumbList',
	'ItemList',
	'SearchAction',
	'ReadAction',
	'SiteNavigationElement',
]);

export function nodeTypes(node: Record<string, unknown>): string[] {
	const raw = node['@type'];
	if (typeof raw === 'string') return [raw];
	if (Array.isArray(raw)) {
		return raw.filter((entry): entry is string => typeof entry === 'string');
	}
	return [];
}

function nodeMatchesSpecType(node: Record<string, unknown>, specType: string): boolean {
	const family = SCHEMA_TYPE_FAMILIES[specType];
	const types = nodeTypes(node);
	if (types.length === 0) return false;
	if (specType === 'Thing') {
		return !types.some((type) => BOILERPLATE_TYPES.has(type));
	}
	if (!family) return types.includes(specType);
	return types.some((type) => family.includes(type));
}

function selectNodeForSpec(
	nodes: readonly Record<string, unknown>[],
	specType: string
): Record<string, unknown> | undefined {
	const candidates = nodes.filter((node) => nodeMatchesSpecType(node, specType));
	if (candidates.length === 0) return undefined;
	// Prefer the node that actually names the entity.
	return (
		candidates.find((node) => readString(node.name) ?? readString(node.headline)) ?? candidates[0]
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function composePostalAddress(value: Record<string, unknown>): string | undefined {
	const parts = [
		readString(value.streetAddress),
		readString(value.addressLocality),
		[readString(value.addressRegion), readString(value.postalCode)]
			.filter(Boolean)
			.join(' ')
			.trim() || undefined,
		isRecord(value.addressCountry)
			? readString(value.addressCountry.name)
			: readString(value.addressCountry),
	].filter((part): part is string => Boolean(part));
	return parts.length > 0 ? parts.join(', ') : undefined;
}

function unwrapToString(value: unknown): string | undefined {
	if (typeof value === 'string') return readString(value);
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (Array.isArray(value)) {
		for (const entry of value) {
			const unwrapped = unwrapToString(entry);
			if (unwrapped) return unwrapped;
		}
		return undefined;
	}
	if (isRecord(value)) {
		if (composeLooksLikeAddress(value)) {
			return composePostalAddress(value);
		}
		// Nested entities (location, author, brand, hiringOrganization…) read
		// as their name; addresses compose; bare references read their url.
		return (
			readString(value.name) ??
			(isRecord(value.address) ? composePostalAddress(value.address) : undefined) ??
			readString(value['@id'])
		);
	}
	return undefined;
}

function composeLooksLikeAddress(value: Record<string, unknown>): boolean {
	const types = nodeTypes(value);
	return (
		types.includes('PostalAddress') ||
		value.streetAddress !== undefined ||
		value.addressLocality !== undefined
	);
}

function unwrapToUrl(value: unknown): string | undefined {
	const candidates = Array.isArray(value) ? value : [value];
	for (const entry of candidates) {
		const raw = isRecord(entry) ? (entry.url ?? entry['@id']) : entry;
		const text = typeof raw === 'string' ? raw.trim() : undefined;
		if (text && /^https?:\/\//.test(text)) return text;
	}
	return undefined;
}

function normalizeJsonLdValue(fieldType: string, value: unknown): unknown {
	switch (fieldType) {
		case 'string':
			return unwrapToString(value);
		case 'url':
			return unwrapToUrl(value);
		case 'iso-date': {
			const text = unwrapToString(value);
			return text ? /^(\d{4}-\d{2}-\d{2})/.exec(text)?.[1] : undefined;
		}
		case 'iso-datetime': {
			const text = unwrapToString(value);
			return text && !Number.isNaN(Date.parse(text)) ? text : undefined;
		}
		case 'number': {
			const text = unwrapToString(value);
			const parsed = text !== undefined ? Number(text) : Number.NaN;
			return Number.isFinite(parsed) ? parsed : undefined;
		}
		case 'integer': {
			const text = unwrapToString(value);
			const parsed = text !== undefined ? Number(text) : Number.NaN;
			return Number.isInteger(parsed) ? parsed : undefined;
		}
		case 'string[]': {
			if (typeof value === 'string') {
				const parts = value
					.split(',')
					.map((part) => part.trim())
					.filter(Boolean);
				return parts.length > 0 ? parts : undefined;
			}
			if (Array.isArray(value)) {
				const parts = value
					.map((entry) => unwrapToString(entry))
					.filter((entry): entry is string => Boolean(entry));
				return parts.length > 0 ? parts : undefined;
			}
			const single = unwrapToString(value);
			return single ? [single] : undefined;
		}
		default:
			return undefined;
	}
}

export function extractPageNativeFields(context: ExtractionContext): ExtractedField[] {
	const microdata = findArtifactData(context.artifacts, 'microdata', parseMicrodata);
	const nodes = microdata?.data.jsonLd ?? [];
	if (nodes.length === 0) return [];

	const specType = context.spec.schema?.type ?? context.spec.type;
	const node = selectNodeForSpec(nodes, specType);
	if (!node) return [];

	const evidenceUrl = microdata?.sourceUrl ?? context.url;
	const fields: ExtractedField[] = [];
	for (const specField of context.spec.fields) {
		const propertyNames = [specField.key, ...(FIELD_ALIASES[specField.key] ?? [])];
		for (const property of propertyNames) {
			const raw = node[property];
			if (raw === undefined || raw === null) continue;
			const value = normalizeJsonLdValue(specField.fieldType, raw);
			if (value === undefined) continue;
			fields.push(field(specField.key, value, 'page', PAGE_NATIVE_CONFIDENCE, evidenceUrl));
			break;
		}
	}
	return fields;
}

// Suggestion support: the most entity-like JSON-LD type on the page.
const PRIMARY_TYPE_PRIORITY: readonly string[] = [
	'JobPosting',
	'Event',
	'MusicEvent',
	'Festival',
	'Product',
	'Movie',
	'TVSeries',
	'Book',
	'MusicRecording',
	'MusicAlbum',
	'PodcastEpisode',
	'PodcastSeries',
	'Dataset',
	'Review',
	'NewsArticle',
	'BlogPosting',
	'Article',
	'VideoObject',
	'LocalBusiness',
	'Restaurant',
	'SoftwareApplication',
	'MobileApplication',
	'Person',
	'Place',
	'TouristAttraction',
];

export function pickPrimaryJsonLdType(
	nodes: readonly Record<string, unknown>[]
): string | undefined {
	let best: { type: string; rank: number } | undefined;
	for (const node of nodes) {
		for (const type of nodeTypes(node)) {
			const rank = PRIMARY_TYPE_PRIORITY.indexOf(type);
			if (rank === -1) continue;
			if (!best || rank < best.rank) {
				best = { type, rank };
			}
		}
	}
	return best?.type;
}
