import type { AmazonTarget, EnrichmentRequest, GitHubTarget, XTarget } from '../../../types';

const urlLikePattern = /^https?:\/\//i;
const doiPattern = /^10\.\d{4,9}\/.+/;

export function getRequestUrl(request: EnrichmentRequest): string | undefined {
	const hintUrl = request.input.hints?.url;
	if (typeof hintUrl === 'string' && urlLikePattern.test(hintUrl)) {
		return hintUrl;
	}

	const jsonLdUrl = request.input.jsonLd.url;
	if (typeof jsonLdUrl === 'string' && urlLikePattern.test(jsonLdUrl)) {
		return jsonLdUrl;
	}

	const sameAsUrl = findFirstUrl(request.input.jsonLd.sameAs);
	if (sameAsUrl) {
		return sameAsUrl;
	}

	return undefined;
}

function findFirstUrl(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return urlLikePattern.test(trimmed) ? trimmed : undefined;
	}

	if (!Array.isArray(value)) {
		return undefined;
	}

	for (const entry of value) {
		const url = findFirstUrl(entry);
		if (url) {
			return url;
		}
	}

	return undefined;
}

export function getRequestName(request: EnrichmentRequest): string | undefined {
	const hintName = request.input.hints?.name;
	if (typeof hintName === 'string') {
		const normalizedHintName = hintName.trim();
		if (normalizedHintName.length > 0 && !urlLikePattern.test(normalizedHintName)) {
			return normalizedHintName;
		}
	}

	const jsonLdName = request.input.jsonLd.name;
	if (typeof jsonLdName === 'string') {
		const normalizedJsonLdName = jsonLdName.trim();
		if (normalizedJsonLdName.length > 0 && !urlLikePattern.test(normalizedJsonLdName)) {
			return normalizedJsonLdName;
		}
	}

	return undefined;
}

// Pure display-fallback guard, based on v2 __shared__/request.ts. No IID resolution.
const providerPlaceholders = [
	{
		provider: 'amazon',
		host: 'amazon.com',
		pattern: /^Amazon Product [A-Z0-9]{10}$/i,
		id: /^[A-Z0-9]{10}$/i,
	},
	{ provider: 'etsy', host: 'etsy.com', pattern: /^Etsy Listing \d+$/i, id: /^\d+$/ },
	{ provider: 'goodreads', host: 'goodreads.com', pattern: /^Goodreads Book \d+$/i, id: /^\d+$/ },
	{
		provider: 'imdb',
		host: 'imdb.com',
		pattern: /^IMDb (?:Person|Title) [a-z]{2}\d+$/i,
		id: /^(?:tt|nm)\d+$/i,
	},
	{
		provider: 'instagram',
		host: 'instagram.com',
		pattern: /^Instagram (?:Post|Video) [A-Za-z0-9_-]+$/i,
	},
	{
		provider: 'openlibrary',
		host: 'openlibrary.org',
		pattern: /^OpenLibrary (?:(?:Book|Edition) OL\d+M|Work OL\d+W)$/i,
		id: /^OL\d+[MWA]$/i,
	},
	{
		provider: 'spotify',
		host: 'open.spotify.com',
		pattern: /^(?:Spotify )?(?:Track|Album|Artist|Playlist|Show|Episode) [A-Za-z0-9]{8,}$/i,
		id: /^[A-Za-z0-9]{8,}$/,
	},
	{ provider: 'steam', host: 'steampowered.com', pattern: /^Steam App \d+$/i, id: /^\d+$/ },
	{ provider: 'tiktok', host: 'tiktok.com', pattern: /^TikTok Video \d+$/i, id: /^\d+$/ },
	{
		provider: 'tmdb',
		host: 'themoviedb.org',
		pattern: /^TMDB (?:Movie|TV Series) \d+$/i,
		id: /^\d+$/,
	},
	{
		provider: 'youtube',
		host: 'youtube.com',
		pattern: /^YouTube Video [A-Za-z0-9_-]+$/i,
		id: /^[A-Za-z0-9_-]{11}$/,
	},
	{ provider: 'default-url', pattern: /^Website [a-z0-9.-]+$/i },
] satisfies Array<{ provider: string; host?: string; pattern: RegExp; id?: RegExp }>;

export function isSynthesizedProviderPlaceholderTitle(
	request: EnrichmentRequest,
	title = getRequestName(request)
): boolean {
	if (!title) return false;
	const name = title.trim();
	const provider = request.input.source.provider?.trim().toLowerCase();
	const stage = request.input.source.fallbackStage?.trim().toLowerCase();
	for (const placeholder of providerPlaceholders) {
		const matchesProvider =
			provider === placeholder.provider || provider === `${placeholder.provider}-url`;
		const displayMatches = placeholder.pattern.test(name);
		let bareIdMatches = false;
		if ('id' in placeholder && placeholder.id?.test(name) && 'host' in placeholder) {
			const requestUrl = getRequestUrl(request);
			if (requestUrl) {
				try {
					const url = new URL(requestUrl);
					const host = url.hostname.toLowerCase().replace(/^www\./, '');
					const pathId = decodeURIComponent(url.pathname.split('/').filter(Boolean).pop() ?? '');
					bareIdMatches =
						(host === placeholder.host || host.endsWith(`.${placeholder.host}`)) &&
						(pathId === name ||
							pathId.startsWith(`${name}-`) ||
							pathId.startsWith(`${name}.`) ||
							url.searchParams.get('v') === name);
				} catch {
					/* Bare IDs require a valid corroborating source URL. */
				}
			}
		}
		if (matchesProvider && stage === 'generic' && (displayMatches || bareIdMatches)) return true;
		// v2's legacy Goodreads host fallback applies only when no stage is available.
		if (
			!displayMatches ||
			placeholder.provider !== 'goodreads' ||
			stage !== undefined ||
			(provider !== undefined && !matchesProvider) ||
			!('host' in placeholder)
		)
			continue;
		const url = getRequestUrl(request);
		if (!url) continue;
		try {
			const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
			if (host === placeholder.host || host.endsWith(`.${placeholder.host}`)) return true;
		} catch {
			/* Invalid source URLs provide no provenance. */
		}
	}
	return false;
}

export function getIdentifier(request: EnrichmentRequest, ...keys: string[]): string | undefined {
	const identifiers = request.input.hints?.identifiers;
	if (!identifiers) {
		return undefined;
	}

	for (const key of keys) {
		const value = identifiers[key];
		if (typeof value === 'string' && value.trim().length > 0) {
			return value.trim();
		}
	}

	return undefined;
}

export function getGitHubTarget(request: EnrichmentRequest): GitHubTarget | undefined {
	return request.input.targets?.github;
}

export function getAmazonTarget(request: EnrichmentRequest): AmazonTarget | undefined {
	return request.input.targets?.amazon;
}

export function getXTarget(request: EnrichmentRequest): XTarget | undefined {
	return request.input.targets?.x;
}

export function getDomainFromUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		return parsed.hostname;
	} catch {
		return undefined;
	}
}

export function getDoiFromRequest(request: EnrichmentRequest): string | undefined {
	const identifier = getIdentifier(request, 'doi');
	if (identifier) {
		return identifier;
	}

	const url = getRequestUrl(request);
	if (url) {
		const fromUrl = parseDoiFromUrl(url);
		if (fromUrl) {
			return fromUrl;
		}
	}

	const name = getRequestName(request);
	if (name && doiPattern.test(name)) {
		return name;
	}

	return undefined;
}

export function parseDoiFromUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes('doi.org')) {
			return undefined;
		}

		const normalized = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
		return normalized.length > 0 ? normalized : undefined;
	} catch {
		return undefined;
	}
}

export function parseWikipediaTitleFromUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes('wikipedia.org')) {
			return undefined;
		}

		const wikiPrefix = '/wiki/';
		if (!parsed.pathname.startsWith(wikiPrefix)) {
			return undefined;
		}

		const slug = decodeURIComponent(parsed.pathname.slice(wikiPrefix.length));
		const title = slug.replace(/_/g, ' ').trim();
		return title.length > 0 ? title : undefined;
	} catch {
		return undefined;
	}
}

export function parseNpmPackageFromUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes('npmjs.com')) {
			return undefined;
		}

		const match = parsed.pathname.match(/^\/package\/(.+)$/);
		if (!match?.[1]) {
			return undefined;
		}

		return decodeURIComponent(match[1]);
	} catch {
		return undefined;
	}
}
