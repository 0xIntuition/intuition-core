import type { ResolverAtom } from '../../plugins';
import type {
	ClassificationCanonicalFieldPolicyMap,
	ClassificationSourceFamily,
} from '../../types';
import { slugify, toStringMaybe } from '../shared/helpers';

export type XResolutionMode = 'identity-only' | 'enriched';

type XPostAtomInput = {
	canonicalUrl: string;
	identifier: string;
	handle?: string;
	authorHandle?: string;
	authorDisplayName?: string;
	authorImage?: string;
	includeAuthor?: boolean;
	includeAlternateName?: boolean;
	text?: string;
	media?: string[];
	datePublished?: string;
	quotedPostId?: string;
	replyToPostId?: string;
	provider: string;
	resolutionMode: XResolutionMode;
	sourceFamily?: ClassificationSourceFamily;
	fieldPolicies?: ClassificationCanonicalFieldPolicyMap;
	extraMetadata?: Record<string, unknown>;
};

type XProfileAtomInput = {
	canonicalUrl: string;
	handle: string;
	name?: string;
	description?: string;
	image?: string;
	provider: string;
	resolutionMode: XResolutionMode;
	sourceFamily?: ClassificationSourceFamily;
	fieldPolicies?: ClassificationCanonicalFieldPolicyMap;
	extraMetadata?: Record<string, unknown>;
};

export function normalizeXHandle(handle: string | undefined): string | undefined {
	const normalized = toStringMaybe(handle)?.replace(/^@+/, '');
	return normalized && normalized.length > 0 ? normalized : undefined;
}

export function normalizeXCanonicalUrl(value: string | undefined): string | undefined {
	const url = toStringMaybe(value);
	if (!url) {
		return undefined;
	}

	try {
		const parsed = new URL(url);
		const host = parsed.hostname.toLowerCase();
		if (
			host !== 'x.com' &&
			host !== 'www.x.com' &&
			host !== 'twitter.com' &&
			host !== 'www.twitter.com'
		) {
			return undefined;
		}

		const pathname = parsed.pathname.replace(/\/+$/, '');
		return `https://x.com${pathname}`;
	} catch {
		return undefined;
	}
}

export function normalizeUnknownStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value
		.filter((entry): entry is string => typeof entry === 'string')
		.map((entry) => entry.trim())
		.filter(Boolean);
}

export function resolveIdentityXPostTitle(input: {
	authorHandle?: string;
	authorName?: string;
	handle?: string;
	identifier: string;
}): string {
	const handle = input.authorHandle ?? input.handle;
	if (handle) {
		return `X Post by @${handle}`;
	}

	if (input.authorName) {
		return `X Post by ${input.authorName}`;
	}

	return `X Post ${input.identifier}`;
}

// All X resolver stages should flow through the same builders so generic,
// API-backed, and public-metadata outputs do not drift apart over time.
export function buildXPostAtom(input: XPostAtomInput): ResolverAtom {
	const canonicalUrl = normalizeXCanonicalUrl(input.canonicalUrl) ?? input.canonicalUrl;
	const authorHandle = normalizeXHandle(input.authorHandle ?? input.handle);
	const title = resolveIdentityXPostTitle({
		authorHandle,
		authorName: input.authorDisplayName,
		handle: input.handle,
		identifier: input.identifier,
	});
	const author =
		input.includeAuthor === false
			? undefined
			: buildXAuthor({
					handle: authorHandle,
					displayName: input.authorDisplayName,
					image: input.authorImage,
				});

	return {
		schemaType: 'SocialMediaPosting',
		category: 'thing',
		title,
		description: input.text,
		canonicalId: `x:post:${input.identifier || slugify(canonicalUrl)}`,
		sameAs: [canonicalUrl],
		data: {
			'@context': 'https://schema.org/',
			'@type': 'SocialMediaPosting',
			name: title,
			url: canonicalUrl,
			sameAs: [canonicalUrl],
			identifier: input.identifier || slugify(canonicalUrl),
			...(input.includeAlternateName === false || !authorHandle
				? {}
				: { alternateName: `@${authorHandle}` }),
			...(input.text ? { text: input.text } : {}),
			...(author ? { author } : {}),
			...(input.media && input.media.length > 0 ? { media: input.media } : {}),
			...(input.datePublished ? { datePublished: input.datePublished } : {}),
			...(input.quotedPostId ? { quotedPostId: input.quotedPostId } : {}),
			...(input.replyToPostId ? { replyToPostId: input.replyToPostId } : {}),
		},
		metadata: buildXMetadata({
			canonicalUrl,
			provider: input.provider,
			resolutionMode: input.resolutionMode,
			sourceFamily: input.sourceFamily,
			fieldPolicies: input.fieldPolicies,
			extraMetadata: input.extraMetadata,
		}),
	};
}

export function buildXProfileAtom(input: XProfileAtomInput): ResolverAtom {
	const canonicalUrl = normalizeXCanonicalUrl(input.canonicalUrl) ?? input.canonicalUrl;
	const handle = normalizeXHandle(input.handle) ?? input.handle;

	return {
		schemaType: 'SocialMediaAccount',
		category: 'person',
		title: `@${handle}`,
		description: input.description,
		canonicalId: `x:user:${handle.toLowerCase()}`,
		sameAs: [canonicalUrl],
		data: {
			'@context': 'https://schema.org/',
			'@type': 'SocialMediaAccount',
			name: input.name ?? `@${handle}`,
			username: handle,
			platform: 'x',
			url: canonicalUrl,
			sameAs: [canonicalUrl],
			...(input.description ? { description: input.description } : {}),
			...(input.image ? { image: input.image } : {}),
		},
		metadata: buildXMetadata({
			canonicalUrl,
			provider: input.provider,
			resolutionMode: input.resolutionMode,
			sourceFamily: input.sourceFamily,
			fieldPolicies: input.fieldPolicies,
			extraMetadata: input.extraMetadata,
		}),
	};
}

function buildXAuthor(input: { handle?: string; displayName?: string; image?: string }) {
	if (!input.handle && !input.displayName) {
		return undefined;
	}

	const authorUrl = input.handle ? `https://x.com/${input.handle}` : undefined;

	return {
		name: input.displayName ?? (input.handle ? `@${input.handle}` : undefined),
		...(input.handle ? { identifier: `x:user:${input.handle.toLowerCase()}` } : {}),
		...(authorUrl ? { url: authorUrl, sameAs: [authorUrl] } : {}),
		...(input.image ? { image: input.image } : {}),
	};
}

function buildXMetadata(input: {
	canonicalUrl: string;
	provider: string;
	resolutionMode: XResolutionMode;
	sourceFamily?: ClassificationSourceFamily;
	fieldPolicies?: ClassificationCanonicalFieldPolicyMap;
	extraMetadata?: Record<string, unknown>;
}) {
	return {
		pluginId: 'x',
		provider: input.provider,
		sourceUrl: input.canonicalUrl,
		resolutionMode: input.resolutionMode,
		...(input.sourceFamily ? { sourceFamily: input.sourceFamily } : {}),
		...(input.fieldPolicies ? { fieldPolicies: input.fieldPolicies } : {}),
		...(input.extraMetadata ?? {}),
	};
}
