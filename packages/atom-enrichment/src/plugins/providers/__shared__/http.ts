import type { z } from 'zod/v4';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchJson<TData>(
	fetcher: FetchLike,
	url: string,
	init?: RequestInit
): Promise<TData> {
	const response = await fetcher(url, init);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} from ${url}`);
	}

	return (await response.json()) as TData;
}

export async function fetchJsonWithSchema<TSchema extends z.ZodTypeAny>(
	fetcher: FetchLike,
	url: string,
	schema: TSchema,
	init?: RequestInit
): Promise<z.infer<TSchema>> {
	const payload = await fetchJson<unknown>(fetcher, url, init);
	return schema.parse(payload);
}

export async function fetchText(
	fetcher: FetchLike,
	url: string,
	init?: RequestInit
): Promise<string> {
	const response = await fetcher(url, init);
	if (!response.ok) {
		throw new Error(`HTTP ${response.status} from ${url}`);
	}

	return await response.text();
}

// Browser-like headers for page-scraping fetches (opengraph, microdata).
// Many publishers serve challenge pages or empty shells to non-browser user
// agents; identifying as a browser recovers the real markup (verified live:
// Letterboxd serves Movie JSON-LD only with a browser UA).
export const BROWSER_FETCH_HEADERS: Record<string, string> = {
	'User-Agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36',
	Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'Accept-Language': 'en-US,en;q=0.9',
};
