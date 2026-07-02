export type DomainHtmlFetchLike = (
	input: string,
	init?: {
		method?: string;
		headers?: Record<string, string>;
		body?: string;
	}
) => Promise<{
	ok: boolean;
	status: number;
	text(): Promise<string>;
}>;

export const DEFAULT_BROWSER_REQUEST_HEADERS = {
	accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
	'accept-language': 'en-US,en;q=0.9',
	'user-agent':
		'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
} as const;

export function resolveDomainHtmlFetch(
	fetcher: DomainHtmlFetchLike | undefined
): DomainHtmlFetchLike | undefined {
	if (fetcher) {
		return fetcher;
	}

	const globalFetch = (globalThis as { fetch?: DomainHtmlFetchLike }).fetch;
	return typeof globalFetch === 'function' ? globalFetch : undefined;
}

export async function fetchHtmlDocument(
	fetcher: DomainHtmlFetchLike,
	input: {
		url: string;
		headers?: Record<string, string>;
	}
): Promise<string | undefined> {
	const response = await fetcher(input.url, {
		headers: {
			...DEFAULT_BROWSER_REQUEST_HEADERS,
			...(input.headers ?? {}),
		},
	});
	if (!response.ok) {
		return undefined;
	}

	return response.text();
}

export async function fetchJsonDocument<TValue>(
	fetcher: DomainHtmlFetchLike,
	input: {
		url: string;
		headers?: Record<string, string>;
	}
): Promise<TValue | undefined> {
	const response = await fetcher(input.url, {
		headers: {
			accept: 'application/json,text/plain;q=0.9,*/*;q=0.8',
			'user-agent': DEFAULT_BROWSER_REQUEST_HEADERS['user-agent'],
			...(input.headers ?? {}),
		},
	});
	if (!response.ok) {
		return undefined;
	}

	try {
		return JSON.parse(await response.text()) as TValue;
	} catch {
		return undefined;
	}
}
