// Amazon URL parsing shared by the amazon classifier and its stage adapters.
// Amazon blocks most server-side HTML fetches, so identity must come from the
// URL itself (ASIN + marketplace) — parsing breadth here directly determines
// how many pasted Amazon URLs classify as products and reach the Canopy API.
// atom-enrichment carries an equivalent copy in plugins/providers/__shared__/
// amazon.ts; keep the two in sync.

export const AMAZON_MARKETPLACE_BY_HOST_SUFFIX = new Map<string, string>([
	['amazon.ca', 'CA'],
	['amazon.co.uk', 'GB'],
	['amazon.de', 'DE'],
	['amazon.fr', 'FR'],
	['amazon.it', 'IT'],
	['amazon.es', 'ES'],
	['amazon.co.jp', 'JP'],
	['amazon.com.mx', 'MX'],
	['amazon.com.br', 'BR'],
	['amazon.in', 'IN'],
	['amazon.com.au', 'AU'],
	['amazon.nl', 'NL'],
	['amazon.se', 'SE'],
	['amazon.sg', 'SG'],
	['amazon.ae', 'AE'],
	['amazon.sa', 'SA'],
	['amazon.com.tr', 'TR'],
	['amazon.pl', 'PL'],
	['amazon.eg', 'EG'],
	['amazon.com.be', 'BE'],
]);

// Share-sheet and Associates short links. They carry no ASIN in the URL;
// resolving the redirect server-side recovers the full product URL. The
// shortener endpoints are plain 301s and are not behind Amazon's bot wall.
const AMAZON_SHORT_LINK_HOSTS = new Set(['a.co', 'amzn.to', 'amzn.eu', 'amzn.asia', 'amzn.in']);

// Path shapes that carry an ASIN: desktop /dp/, legacy /gp/product/ and
// /exec/obidos/ASIN/, mobile-web /gp/aw/d/. The trailing boundary keeps
// 11+ character segments from matching.
const ASIN_PATH_PATTERN =
	/\/(?:dp|gp\/product|gp\/aw\/d|exec\/obidos\/asin)\/([A-Z0-9]{10})(?![A-Z0-9])/i;

// Real marketplace hosts only — `amazon.` as a prefix of an unrelated domain
// (amazon.example.com) must not match, since query-param ASIN extraction
// trusts Amazon hosts.
const AMAZON_TLDS = [
	'com',
	'ca',
	'co.uk',
	'de',
	'fr',
	'it',
	'es',
	'co.jp',
	'com.mx',
	'com.br',
	'in',
	'com.au',
	'nl',
	'se',
	'sg',
	'ae',
	'sa',
	'com.tr',
	'pl',
	'eg',
	'com.be',
	'cn',
];

export function isAmazonHostname(hostname: string): boolean {
	const host = hostname.toLowerCase();
	return AMAZON_TLDS.some((tld) => {
		const suffix = `amazon.${tld}`;
		return host === suffix || host.endsWith(`.${suffix}`);
	});
}

export function isAmazonShortLinkUrl(value: string | undefined): boolean {
	if (!value) {
		return false;
	}

	try {
		const hostname = new URL(value).hostname.replace(/^www\./, '').toLowerCase();
		return AMAZON_SHORT_LINK_HOSTS.has(hostname);
	} catch {
		return false;
	}
}

export function extractAmazonAsinFromUrl(value: string): string | undefined {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		return undefined;
	}

	const pathMatch = parsed.pathname.match(ASIN_PATH_PATTERN);
	if (pathMatch?.[1]) {
		return pathMatch[1].toUpperCase();
	}

	if (!isAmazonHostname(parsed.hostname)) {
		return undefined;
	}

	// Sponsored-result wrappers (/sspa/click) and some affiliate links keep the
	// product path in a query parameter instead of the pathname.
	for (const key of ['url', 'asin']) {
		const candidate = parsed.searchParams.get(key);
		if (!candidate) {
			continue;
		}
		if (key === 'asin' && /^[A-Z0-9]{10}$/i.test(candidate)) {
			return candidate.toUpperCase();
		}
		const wrappedMatch = candidate.match(ASIN_PATH_PATTERN);
		if (wrappedMatch?.[1]) {
			return wrappedMatch[1].toUpperCase();
		}
	}

	return undefined;
}

export function resolveAmazonMarketplace(url: string): string {
	try {
		const hostname = new URL(url).hostname.toLowerCase();
		for (const [suffix, market] of AMAZON_MARKETPLACE_BY_HOST_SUFFIX) {
			if (hostname.endsWith(suffix)) {
				return market;
			}
		}
	} catch {
		// Fall through to US when the URL is malformed. The URL classifier already
		// narrows inputs to Amazon product pages, so this is only a final guardrail.
	}

	return 'US';
}

export function normalizeAmazonCanonicalUrl(value: string, asin: string): string {
	try {
		const parsed = new URL(value);
		return `https://${parsed.hostname}/dp/${asin}`;
	} catch {
		return value;
	}
}

type AmazonRedirectFetchLike = (
	input: string,
	init?: {
		redirect?: 'follow' | 'manual' | 'error';
		headers?: Record<string, string>;
	}
) => Promise<{ url?: string }>;

// Follows the shortener redirect and returns the destination product URL.
// Returns undefined when the redirect does not land on an Amazon host, so a
// hijacked or expired short link can never inject a foreign URL downstream.
export async function resolveAmazonShortLink(
	fetcher: AmazonRedirectFetchLike,
	url: string
): Promise<string | undefined> {
	try {
		const response = await fetcher(url, { redirect: 'follow' });
		const destination = typeof response.url === 'string' ? response.url : undefined;
		if (!destination) {
			return undefined;
		}
		return isAmazonHostname(new URL(destination).hostname) ? destination : undefined;
	} catch {
		return undefined;
	}
}
