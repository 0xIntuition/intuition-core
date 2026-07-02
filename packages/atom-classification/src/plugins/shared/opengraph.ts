import type { ResolverAtom } from '../../plugins';
import type { ClassificationClientClassificationHint, ClassificationRuntime } from '../../types';
import {
	extractDocumentTitle,
	extractMetaContent,
	normalizeWhitespace,
} from './domain-html/document';
import {
	type DomainHtmlFetchLike,
	fetchHtmlDocument,
	resolveDomainHtmlFetch,
} from './domain-html/fetch';
import type { PlatformDomain, PlatformStageAdapter } from './platform';

export type OpenGraphMetadata = {
	title?: string;
	description?: string;
	image?: string;
	url?: string;
	siteName?: string;
	twitterSite?: string;
	documentTitle?: string;
};

export type OpenGraphPlatformAdapterInput = {
	runtime: ClassificationRuntime;
	domain: PlatformDomain;
	classification: ClassificationClientClassificationHint;
	canonicalUrl: string;
	metadata: OpenGraphMetadata;
};

export type OpenGraphPlatformAdapterOptions = {
	fetch?: DomainHtmlFetchLike;
	domains?: PlatformDomain[];
	headers?: Record<string, string>;
	map: (input: OpenGraphPlatformAdapterInput) => ResolverAtom | null | undefined;
};

export type OpenGraphPlatformAdapter = PlatformStageAdapter;

export function createOpenGraphPlatformAdapter(
	options: OpenGraphPlatformAdapterOptions
): OpenGraphPlatformAdapter {
	const fetcher = resolveDomainHtmlFetch(options.fetch);

	return async ({ runtime, domain, classification, canonicalUrl }) => {
		if (runtime !== 'server' || !fetcher) {
			return null;
		}

		if (options.domains && !options.domains.includes(domain)) {
			return null;
		}

		const metadata = await fetchOpenGraphMetadata(fetcher, {
			url: canonicalUrl,
			headers: options.headers,
		});
		if (!metadata) {
			return null;
		}

		return (
			options.map({
				runtime,
				domain,
				classification,
				canonicalUrl,
				metadata,
			}) ?? null
		);
	};
}

export async function fetchOpenGraphMetadata(
	fetcher: DomainHtmlFetchLike,
	input: {
		url: string;
		headers?: Record<string, string>;
	}
): Promise<OpenGraphMetadata | undefined> {
	const html = await fetchHtmlDocument(fetcher, input);
	if (!html) {
		return undefined;
	}

	return extractOpenGraphMetadata(html);
}

export function extractOpenGraphMetadata(html: string): OpenGraphMetadata | undefined {
	const metadata: OpenGraphMetadata = {
		title: firstDefined(
			normalizeWhitespace(extractMetaContent(html, 'og:title')),
			normalizeWhitespace(extractMetaContent(html, 'twitter:title'))
		),
		description: firstDefined(
			normalizeWhitespace(extractMetaContent(html, 'og:description')),
			normalizeWhitespace(extractMetaContent(html, 'twitter:description'))
		),
		image: normalizeHttpUrl(
			firstDefined(extractMetaContent(html, 'og:image'), extractMetaContent(html, 'twitter:image'))
		),
		url: normalizeHttpUrl(extractMetaContent(html, 'og:url')),
		siteName: normalizeWhitespace(extractMetaContent(html, 'og:site_name')),
		twitterSite: normalizeWhitespace(extractMetaContent(html, 'twitter:site')),
		documentTitle: normalizeWhitespace(extractDocumentTitle(html)),
	};

	return hasOpenGraphSignals(metadata) ? metadata : undefined;
}

function hasOpenGraphSignals(metadata: OpenGraphMetadata): boolean {
	return !!(
		metadata.title ||
		metadata.description ||
		metadata.image ||
		metadata.url ||
		metadata.siteName ||
		metadata.twitterSite
	);
}

function firstDefined(...values: Array<string | undefined>): string | undefined {
	return values.find((value) => typeof value === 'string' && value.length > 0);
}

function normalizeHttpUrl(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	try {
		const parsed = new URL(value);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return undefined;
		}

		return parsed.toString();
	} catch {
		return undefined;
	}
}
