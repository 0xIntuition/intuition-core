import type { ResolverAtom } from '../../plugins';
import type { ClassificationCanonicalFieldPolicyMap } from '../../types';
import { normalizeStringArray } from '../shared/domain-html/document';
import { toRecordMaybe, toStringMaybe } from '../shared/helpers';
import type { PlatformStageAdapter } from '../shared/platform';
import { buildXPostAtom, buildXProfileAtom, normalizeXHandle } from './shared';

type FetchLike = (
	input: string,
	init?: {
		headers?: Record<string, string>;
	}
) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
	text(): Promise<string>;
}>;

type XPostsLookupPayload = {
	data?: Array<Record<string, unknown>>;
	includes?: {
		users?: Array<Record<string, unknown>>;
		media?: Array<Record<string, unknown>>;
		tweets?: Array<Record<string, unknown>>;
	};
};

type XUserLookupPayload = {
	data?: Record<string, unknown>;
};

const X_API_BASE_URL = 'https://api.x.com/2';
const X_POST_FIELD_POLICIES: ClassificationCanonicalFieldPolicyMap = {
	text: {
		promotionTier: 'rich-public',
		sourceFamily: 'domain-api',
	},
	author: {
		promotionTier: 'rich-public',
		sourceFamily: 'domain-api',
	},
	media: {
		promotionTier: 'rich-public',
		sourceFamily: 'domain-api',
	},
	datePublished: {
		promotionTier: 'rich-public',
		sourceFamily: 'domain-api',
	},
};

export type XDomainApiAdapterOptions = {
	token?: string;
	fetch?: FetchLike;
};

export type XDomainApiAdapter = PlatformStageAdapter;

export function createXDomainApiAdapter(options: XDomainApiAdapterOptions = {}): XDomainApiAdapter {
	const fetcher = options.fetch ?? resolveGlobalFetch();

	return async ({ domain, classification, canonicalUrl, credential }) => {
		if (domain !== 'x' || !fetcher) {
			return null;
		}

		const token =
			toStringMaybe(options.token) ??
			toStringMaybe(credential?.token) ??
			toStringMaybe(credential?.apiKey);
		if (!token) {
			return null;
		}

		const headers = {
			authorization: `Bearer ${token}`,
		};

		switch (classification.subtype) {
			case 'post':
				return resolveXPost(fetcher, headers, {
					canonicalUrl,
					handle: toStringMaybe(classification.meta.handle),
					postId: toStringMaybe(classification.meta.postId),
				});
			case 'profile':
				return resolveXProfile(fetcher, headers, {
					canonicalUrl,
					handle: toStringMaybe(classification.meta.handle),
				});
			default:
				return null;
		}
	};
}

async function resolveXPost(
	fetcher: FetchLike,
	headers: Record<string, string>,
	input: {
		canonicalUrl: string;
		handle?: string;
		postId?: string;
	}
): Promise<ResolverAtom | null> {
	const postId = toStringMaybe(input.postId);
	if (!postId) {
		return null;
	}

	const payload = await fetchXJson<XPostsLookupPayload>(
		fetcher,
		buildXPostLookupUrl(postId),
		headers
	);
	const post = Array.isArray(payload.data) ? toRecordMaybe(payload.data[0]) : undefined;
	if (!post) {
		return null;
	}

	const authorId = toStringMaybe(post.author_id);
	const users = Array.isArray(payload.includes?.users) ? payload.includes.users : [];
	const mediaItems = Array.isArray(payload.includes?.media) ? payload.includes.media : [];
	const authorRecord =
		users.find((user) => toStringMaybe(toRecordMaybe(user)?.id) === authorId) ?? undefined;
	const author = toRecordMaybe(authorRecord) ?? {};
	const authorHandle = normalizeXHandle(
		toStringMaybe(author.username) ?? toStringMaybe(input.handle) ?? undefined
	);
	const authorName = toStringMaybe(author.name);
	const text = toStringMaybe(post.text);
	const datePublished = toStringMaybe(post.created_at);
	const media = normalizeStringArray(mediaItems.flatMap(extractXMediaUrls));
	const authorImage = toStringMaybe(author.profile_image_url);

	return buildXPostAtom({
		canonicalUrl: input.canonicalUrl,
		identifier: postId,
		handle: input.handle,
		authorHandle,
		authorDisplayName: authorName ?? (authorHandle ? `@${authorHandle}` : undefined),
		authorImage,
		text,
		media,
		datePublished,
		provider: 'x-api-v2',
		resolutionMode: 'enriched',
		sourceFamily: 'domain-api',
		fieldPolicies: X_POST_FIELD_POLICIES,
	});
}

async function resolveXProfile(
	fetcher: FetchLike,
	headers: Record<string, string>,
	input: {
		canonicalUrl: string;
		handle?: string;
	}
): Promise<ResolverAtom | null> {
	const handle = normalizeXHandle(input.handle);
	if (!handle) {
		return null;
	}

	const payload = await fetchXJson<XUserLookupPayload>(
		fetcher,
		buildXUserLookupUrl(handle),
		headers
	);
	const user = toRecordMaybe(payload.data);
	if (!user) {
		return null;
	}

	const resolvedHandle = normalizeXHandle(toStringMaybe(user.username) ?? handle) ?? handle;
	const name = toStringMaybe(user.name) ?? `@${resolvedHandle}`;
	const description = toStringMaybe(user.description);
	const image = toStringMaybe(user.profile_image_url);
	const canonicalUrl = `https://x.com/${resolvedHandle}`;

	return buildXProfileAtom({
		canonicalUrl,
		handle: resolvedHandle,
		name,
		description,
		image,
		provider: 'x-api-v2',
		resolutionMode: 'enriched',
		sourceFamily: 'domain-api',
	});
}

async function fetchXJson<TValue>(
	fetcher: FetchLike,
	url: string,
	headers: Record<string, string>
): Promise<TValue> {
	const response = await fetcher(url, { headers });
	if (!response.ok) {
		const body = await safeReadBody(response);
		throw new Error(`HTTP ${response.status} from X API.${body ? ` ${body}` : ''}`);
	}

	return (await response.json()) as TValue;
}

function buildXPostLookupUrl(postId: string): string {
	const params = new URLSearchParams({
		ids: postId,
		expansions: 'author_id,attachments.media_keys',
		'tweet.fields': 'attachments,author_id,created_at,text',
		'user.fields': 'name,profile_image_url,username',
		'media.fields': 'preview_image_url,url',
	});
	return `${X_API_BASE_URL}/tweets?${params.toString()}`;
}

function buildXUserLookupUrl(handle: string): string {
	const params = new URLSearchParams({
		'user.fields': 'description,name,profile_image_url,username',
	});
	return `${X_API_BASE_URL}/users/by/username/${encodeURIComponent(handle)}?${params.toString()}`;
}

function extractXMediaUrls(item: Record<string, unknown>): string[] {
	const urls = [toStringMaybe(item.url), toStringMaybe(item.preview_image_url)]
		.filter((value): value is string => !!value)
		.map((value) => value.trim());

	return urls;
}

function resolveGlobalFetch(): FetchLike | undefined {
	const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
	return typeof globalFetch === 'function' ? globalFetch : undefined;
}

async function safeReadBody(response: { text(): Promise<string> }): Promise<string | undefined> {
	try {
		const text = (await response.text()).trim();
		return text.length > 0 ? text : undefined;
	} catch {
		return undefined;
	}
}
