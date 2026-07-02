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
