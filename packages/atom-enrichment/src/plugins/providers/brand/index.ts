import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import {
	getDomainFromUrl,
	getIdentifier,
	getRequestName,
	getRequestUrl,
} from '../__shared__/request';
import { brandFetchResponseSchema } from './external';
import { brandDataSchema } from './schema';

type CreateBrandPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	apiKey?: string;
};

type BrandFetchLink = {
	name?: string;
	url?: string;
};

type BrandFetchAssetFormat = {
	src?: string;
	background?: string | null;
	format?: string;
	height?: number | null;
	width?: number | null;
	size?: number | null;
};

type BrandFetchAsset = {
	theme?: string;
	formats?: BrandFetchAssetFormat[];
	tags?: string[];
	type?: string;
};

type BrandFetchColor = {
	hex?: string;
	type?: string;
	brightness?: number;
};

type BrandFetchFont = {
	name?: string;
	type?: string;
	origin?: string;
	originId?: string | null;
	weights?: Array<string | number>;
};

type BrandFetchIndustryParent = {
	emoji?: string;
	id?: string;
	name?: string;
	slug?: string;
};

type BrandFetchIndustry = {
	score?: number;
	id?: string;
	name?: string;
	emoji?: string;
	parent?: BrandFetchIndustryParent;
	slug?: string;
};

type BrandFetchFinancialIdentifiers = {
	isin?: string[];
	ticker?: string[];
};

type BrandFetchCompanyLocation = {
	city?: string;
	country?: string;
	countryCode?: string;
	region?: string;
	state?: string;
	subregion?: string;
};

type BrandFetchCompany = {
	employees?: number;
	financialIdentifiers?: BrandFetchFinancialIdentifiers;
	foundedYear?: number;
	industries?: BrandFetchIndustry[];
	kind?: string;
	location?: BrandFetchCompanyLocation;
};

type BrandFetchResponse = {
	id?: string;
	brandId?: string;
	name?: string;
	domain?: string;
	claimed?: boolean;
	description?: string;
	longDescription?: string;
	links?: BrandFetchLink[];
	logos?: BrandFetchAsset[];
	icons?: BrandFetchAsset[];
	colors?: BrandFetchColor[];
	fonts?: Array<BrandFetchFont | string>;
	fontDetails?: BrandFetchFont[];
	images?: BrandFetchAsset[];
	qualityScore?: number;
	company?: BrandFetchCompany;
	isNsfw?: boolean;
	urn?: string;
	logoUrl?: string;
	iconUrl?: string;
	primaryColor?: string;
	secondaryColor?: string;
};

type NormalizedBrandAssetFormat = {
	src: string;
	background?: string | null;
	format?: string;
	height?: number | null;
	width?: number | null;
	size?: number | null;
};

type NormalizedBrandAsset = {
	theme?: string;
	formats?: NormalizedBrandAssetFormat[];
	tags?: string[];
	type?: string;
};

const domainPattern = /^(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;

export function createBrandPlugin(options: CreateBrandPluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'brand',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['brand'],
		priority: options.priority ?? 28,
		TTL: options.TTL ?? 43_200,

		supports(request: EnrichmentRequest) {
			return !!resolveDomain(request);
		},

		async enrich(request, ctx) {
			const domain = resolveDomain(request);
			if (!domain) {
				return [];
			}

			const fallbackIconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=128`;

			let payload: BrandFetchResponse | undefined;
			try {
				payload = await fetchJsonWithSchema(
					fetcher,
					`https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`,
					brandFetchResponseSchema,
					{
						signal: ctx.signal,
						headers: {
							...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
						},
					}
				);
			} catch {
				// Fall back to deterministic icon endpoint when Brandfetch is unavailable.
			}

			const normalizedLogos = normalizeAssets(payload?.logos);
			const normalizedIcons = normalizeAssets(payload?.icons);
			const normalizedImages = normalizeAssets(payload?.images);
			const normalizedColors = normalizeColors(payload?.colors);
			const normalizedFonts = normalizeFonts(payload?.fontDetails ?? payload?.fonts);
			const normalizedLinks = normalizeLinks(payload?.links);
			const normalizedCompany = normalizeCompany(payload?.company);

			const logoUrl =
				selectFirstAssetUrl(normalizedLogos, ['logo']) ??
				selectFirstAssetUrl(normalizedLogos) ??
				selectFirstAssetUrl(normalizedIcons, ['logo']) ??
				selectFirstAssetUrl(normalizedIcons);
			const iconUrl =
				selectFirstAssetUrl(normalizedIcons, ['icon']) ??
				selectFirstAssetUrl(normalizedLogos, ['icon', 'symbol']) ??
				selectFirstAssetUrl(normalizedIcons) ??
				selectFirstAssetUrl(normalizedLogos) ??
				fallbackIconUrl;

			const primaryColor =
				sanitizeString(payload?.primaryColor) ?? selectPrimaryColor(normalizedColors);
			const secondaryColor =
				sanitizeString(payload?.secondaryColor) ?? selectSecondaryColor(normalizedColors);
			const fontNames = collectFontNames(payload?.fonts, normalizedFonts);

			return [
				{
					artifact_type: 'brand',
					data: brandDataSchema.parse({
						brandId: payload?.brandId ?? payload?.id,
						name: payload?.name,
						domain: normalizeDomain(payload?.domain ?? '') ?? domain,
						claimed: payload?.claimed,
						description: payload?.description,
						longDescription: payload?.longDescription,
						links: normalizedLinks.length > 0 ? normalizedLinks : undefined,
						logos: normalizedLogos.length > 0 ? normalizedLogos : undefined,
						icons: normalizedIcons.length > 0 ? normalizedIcons : undefined,
						images: normalizedImages.length > 0 ? normalizedImages : undefined,
						colors: normalizedColors.length > 0 ? normalizedColors : undefined,
						fonts: fontNames.length > 0 ? fontNames : undefined,
						fontDetails: normalizedFonts.length > 0 ? normalizedFonts : undefined,
						qualityScore: payload?.qualityScore,
						company: normalizedCompany,
						isNsfw: payload?.isNsfw,
						urn: payload?.urn,
						logoUrl: sanitizeString(payload?.logoUrl) ?? logoUrl,
						iconUrl: sanitizeString(payload?.iconUrl) ?? iconUrl,
						primaryColor,
						secondaryColor,
					}),
					meta: {
						pluginId: 'brand',
						provider: 'brandfetch',
						fetchedAt: ctx.now(),
						sourceUrl: `https://${domain}`,
					},
				},
			];
		},
	});
}

// Content-platform hosts whose pages describe OTHER entities. Deriving a
// brand domain from these URLs would fetch the platform's brand (for example
// Wikipedia's logo for a person article), so URL/name-derived domains on this
// list are rejected. Explicit identifiers (hints.identifiers.domain — for
// example a wikidata P856 official-website chain) bypass the blocklist.
const PLATFORM_HOST_SUFFIXES = [
	'wikipedia.org',
	'wikidata.org',
	'wikimedia.org',
	'spotify.com',
	'youtube.com',
	'youtu.be',
	'x.com',
	'twitter.com',
	'github.com',
	'npmjs.com',
	'reddit.com',
	'themoviedb.org',
	'imdb.com',
	'music.apple.com',
	'itunes.apple.com',
	'podcasts.apple.com',
	'apps.apple.com',
	'play.google.com',
	'maps.google.com',
	'maps.app.goo.gl',
	'goo.gl',
	'etherscan.io',
	'coingecko.com',
	'linkedin.com',
	'facebook.com',
	'instagram.com',
	'eventbrite.com',
	'lu.ma',
	'meetup.com',
	'ticketmaster.com',
	'dice.fm',
	'letterboxd.com',
	'goodreads.com',
	'untappd.com',
	'discogs.com',
	'boardgamegeek.com',
	'myanimelist.net',
	'steampowered.com',
	'greenhouse.io',
	'lever.co',
	'substack.com',
	'medium.com',
	'huggingface.co',
	'kaggle.com',
	'vimeo.com',
	'soundcloud.com',
	'bandcamp.com',
] as const;

const amazonHostPattern = /(^|\.)amazon\.[a-z.]+$/;

function isPlatformHost(host: string): boolean {
	const normalized = host.replace(/^www\./, '').toLowerCase();
	if (amazonHostPattern.test(normalized)) {
		return true;
	}
	return PLATFORM_HOST_SUFFIXES.some(
		(suffix) => normalized === suffix || normalized.endsWith(`.${suffix}`)
	);
}

function isPlatformContentUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (isPlatformHost(parsed.hostname)) {
			return true;
		}
		// google.com itself is a legitimate brand homepage, but Maps content
		// URLs live under google.com/maps and describe a place, not Google.
		const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
		if (
			(host === 'google.com' || host.endsWith('.google.com')) &&
			parsed.pathname.startsWith('/maps')
		) {
			return true;
		}
		return false;
	} catch {
		return false;
	}
}

function resolveDomain(request: EnrichmentRequest): string | undefined {
	const identifier = getIdentifier(request, 'domain', 'website', 'brandDomain');
	if (identifier) {
		const normalizedIdentifier = normalizeDomain(identifier);
		if (normalizedIdentifier) {
			return normalizedIdentifier;
		}
	}

	const url = getRequestUrl(request);
	if (url && !isPlatformContentUrl(url)) {
		const domainFromUrl = getDomainFromUrl(url);
		const normalizedDomainFromUrl = domainFromUrl ? normalizeDomain(domainFromUrl) : undefined;
		if (normalizedDomainFromUrl) {
			return normalizedDomainFromUrl;
		}
	}

	const name = getRequestName(request);
	if (!name) {
		return undefined;
	}

	const normalizedName = normalizeDomain(name);
	return normalizedName && !isPlatformHost(normalizedName) ? normalizedName : undefined;
}

function normalizeDomain(value: string): string | undefined {
	const cleaned = value
		.trim()
		.toLowerCase()
		.replace(/^https?:\/\//, '')
		.replace(/\/$/, '');
	const domain = cleaned.split('/')[0] ?? cleaned;
	if (!domainPattern.test(domain)) {
		return undefined;
	}

	return domain;
}

function normalizeLinks(
	links: BrandFetchLink[] | undefined
): Array<{ name?: string; url: string }> {
	if (!links || links.length === 0) {
		return [];
	}

	const normalized: Array<{ name?: string; url: string }> = [];
	for (const link of links) {
		if (!isHttpUrl(link.url)) {
			continue;
		}

		normalized.push({
			name: sanitizeString(link.name),
			url: link.url,
		});
	}

	return normalized;
}

function normalizeAssets(assets: BrandFetchAsset[] | undefined): NormalizedBrandAsset[] {
	if (!assets || assets.length === 0) {
		return [];
	}

	const normalized: NormalizedBrandAsset[] = [];
	for (const asset of assets) {
		const formats = normalizeAssetFormats(asset.formats);
		const theme = sanitizeString(asset.theme);
		const type = sanitizeString(asset.type);
		const tags = asset.tags?.filter(
			(tag): tag is string => typeof tag === 'string' && tag.length > 0
		);

		if (formats.length === 0 && !theme && !type && (!tags || tags.length === 0)) {
			continue;
		}

		normalized.push({
			theme,
			formats: formats.length > 0 ? formats : undefined,
			tags: tags && tags.length > 0 ? tags : undefined,
			type,
		});
	}

	return normalized;
}

function normalizeAssetFormats(
	formats: BrandFetchAssetFormat[] | undefined
): NormalizedBrandAssetFormat[] {
	if (!formats || formats.length === 0) {
		return [];
	}

	const normalized: NormalizedBrandAssetFormat[] = [];
	for (const format of formats) {
		if (!isHttpUrl(format.src)) {
			continue;
		}

		normalized.push({
			src: format.src,
			background: format.background ?? undefined,
			format: sanitizeString(format.format),
			height: typeof format.height === 'number' ? format.height : undefined,
			width: typeof format.width === 'number' ? format.width : undefined,
			size: typeof format.size === 'number' ? format.size : undefined,
		});
	}

	return normalized;
}

function normalizeColors(
	colors: BrandFetchColor[] | undefined
): Array<{ hex: string; type?: string; brightness?: number }> {
	if (!colors || colors.length === 0) {
		return [];
	}

	const normalized: Array<{ hex: string; type?: string; brightness?: number }> = [];
	for (const color of colors) {
		const hex = sanitizeString(color.hex);
		if (!hex) {
			continue;
		}

		normalized.push({
			hex,
			type: sanitizeString(color.type),
			brightness: typeof color.brightness === 'number' ? color.brightness : undefined,
		});
	}

	return normalized;
}

function normalizeFonts(fonts: Array<BrandFetchFont | string> | undefined): Array<{
	name?: string;
	type?: string;
	origin?: string;
	originId?: string | null;
	weights?: Array<string | number>;
}> {
	if (!fonts || fonts.length === 0) {
		return [];
	}

	const normalized: Array<{
		name?: string;
		type?: string;
		origin?: string;
		originId?: string | null;
		weights?: Array<string | number>;
	}> = [];

	for (const font of fonts) {
		if (typeof font === 'string') {
			const name = sanitizeString(font);
			if (!name) {
				continue;
			}

			normalized.push({ name });
			continue;
		}

		const name = sanitizeString(font.name);
		const type = sanitizeString(font.type);
		const origin = sanitizeString(font.origin);
		const originId = typeof font.originId === 'string' ? font.originId : null;
		const weights = font.weights?.filter(
			(weight): weight is string | number =>
				typeof weight === 'string' || typeof weight === 'number'
		);

		if (!name && !type && !origin && !originId && (!weights || weights.length === 0)) {
			continue;
		}

		normalized.push({
			name: name ?? undefined,
			type: type ?? undefined,
			origin: origin ?? undefined,
			originId,
			weights: weights && weights.length > 0 ? weights : undefined,
		});
	}

	return normalized;
}

function collectFontNames(
	fonts: Array<BrandFetchFont | string> | undefined,
	fontDetails: Array<{ name?: string }>
): string[] {
	const names = new Set<string>();

	for (const font of fonts ?? []) {
		if (typeof font === 'string') {
			const normalized = sanitizeString(font);
			if (normalized) {
				names.add(normalized);
			}
			continue;
		}

		const normalized = sanitizeString(font.name);
		if (normalized) {
			names.add(normalized);
		}
	}

	for (const font of fontDetails) {
		const normalized = sanitizeString(font.name);
		if (normalized) {
			names.add(normalized);
		}
	}

	return Array.from(names);
}

function normalizeCompany(company: BrandFetchCompany | undefined):
	| {
			employees?: number;
			financialIdentifiers?: {
				isin?: string[];
				ticker?: string[];
			};
			foundedYear?: number;
			industries?: Array<{
				score?: number;
				id?: string;
				name?: string;
				emoji?: string;
				parent?: {
					emoji?: string;
					id?: string;
					name?: string;
					slug?: string;
				};
				slug?: string;
			}>;
			kind?: string;
			location?: {
				city?: string;
				country?: string;
				countryCode?: string;
				region?: string;
				state?: string;
				subregion?: string;
			};
	  }
	| undefined {
	if (!company) {
		return undefined;
	}

	const financialIdentifiers = company.financialIdentifiers
		? {
				isin: company.financialIdentifiers.isin?.filter(
					(identifier): identifier is string =>
						typeof identifier === 'string' && identifier.length > 0
				),
				ticker: company.financialIdentifiers.ticker?.filter(
					(identifier): identifier is string =>
						typeof identifier === 'string' && identifier.length > 0
				),
			}
		: undefined;

	const industries = company.industries
		?.map((industry) => ({
			score: typeof industry.score === 'number' ? industry.score : undefined,
			id: sanitizeString(industry.id),
			name: sanitizeString(industry.name),
			emoji: sanitizeString(industry.emoji),
			parent: industry.parent
				? {
						emoji: sanitizeString(industry.parent.emoji),
						id: sanitizeString(industry.parent.id),
						name: sanitizeString(industry.parent.name),
						slug: sanitizeString(industry.parent.slug),
					}
				: undefined,
			slug: sanitizeString(industry.slug),
		}))
		.filter(
			(industry) =>
				industry.id ||
				industry.name ||
				industry.emoji ||
				industry.slug ||
				industry.score !== undefined
		);

	const location = company.location
		? {
				city: sanitizeString(company.location.city),
				country: sanitizeString(company.location.country),
				countryCode: sanitizeString(company.location.countryCode),
				region: sanitizeString(company.location.region),
				state: sanitizeString(company.location.state),
				subregion: sanitizeString(company.location.subregion),
			}
		: undefined;

	const normalized = {
		employees: typeof company.employees === 'number' ? company.employees : undefined,
		financialIdentifiers:
			financialIdentifiers &&
			((financialIdentifiers.isin && financialIdentifiers.isin.length > 0) ||
				(financialIdentifiers.ticker && financialIdentifiers.ticker.length > 0))
				? financialIdentifiers
				: undefined,
		foundedYear: typeof company.foundedYear === 'number' ? company.foundedYear : undefined,
		industries: industries && industries.length > 0 ? industries : undefined,
		kind: sanitizeString(company.kind),
		location:
			location &&
			(location.city ||
				location.country ||
				location.countryCode ||
				location.region ||
				location.state ||
				location.subregion)
				? location
				: undefined,
	};

	if (
		normalized.employees === undefined &&
		normalized.financialIdentifiers === undefined &&
		normalized.foundedYear === undefined &&
		normalized.industries === undefined &&
		normalized.kind === undefined &&
		normalized.location === undefined
	) {
		return undefined;
	}

	return normalized;
}

function selectFirstAssetUrl(assets: NormalizedBrandAsset[], types?: string[]): string | undefined {
	const normalizedTypeSet =
		types && types.length > 0 ? new Set(types.map((type) => type.toLowerCase())) : undefined;

	for (const asset of assets) {
		const assetType = asset.type?.toLowerCase();
		if (normalizedTypeSet && assetType && !normalizedTypeSet.has(assetType)) {
			continue;
		}

		for (const format of asset.formats ?? []) {
			return format.src;
		}
	}

	return undefined;
}

function selectPrimaryColor(
	colors: Array<{ hex: string; type?: string; brightness?: number }>
): string | undefined {
	const typePriorities = ['primary', 'brand', 'accent'];
	for (const type of typePriorities) {
		const match = colors.find((color) => color.type?.toLowerCase() === type);
		if (match?.hex) {
			return match.hex;
		}
	}

	return colors[0]?.hex;
}

function selectSecondaryColor(
	colors: Array<{ hex: string; type?: string; brightness?: number }>
): string | undefined {
	const typePriorities = ['secondary', 'dark', 'light', 'neutral'];
	for (const type of typePriorities) {
		const match = colors.find((color) => color.type?.toLowerCase() === type);
		if (match?.hex) {
			return match.hex;
		}
	}

	return colors[1]?.hex;
}

function sanitizeString(value: string | undefined): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}

function isHttpUrl(value: string | undefined): value is string {
	if (!value) {
		return false;
	}

	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}
