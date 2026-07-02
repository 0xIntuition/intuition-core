import type { ResolverAtom } from '../../plugins';
import type { ClassificationCanonicalFieldPolicyMap } from '../../types';
import { normalizeStringArray } from '../shared/domain-html/document';
import {
	type DomainHtmlFetchLike,
	fetchJsonDocument,
	resolveDomainHtmlFetch,
} from '../shared/domain-html/fetch';
import { toRecordMaybe, toStringMaybe } from '../shared/helpers';
import {
	createPublicMetadataPlatformAdapter,
	type PublicMetadataPlatformAdapter,
} from '../shared/public-metadata';
import { buildXPostAtom, normalizeXCanonicalUrl, normalizeXHandle } from './shared';

const X_PUBLIC_FIELD_POLICIES: ClassificationCanonicalFieldPolicyMap = {
	text: {
		promotionTier: 'rich-public',
		sourceFamily: 'public-json',
	},
	author: {
		promotionTier: 'rich-public',
		sourceFamily: 'public-json',
	},
	media: {
		promotionTier: 'rich-public',
		sourceFamily: 'public-json',
	},
	datePublished: {
		promotionTier: 'rich-public',
		sourceFamily: 'public-json',
	},
};

export type XPublicMetadataAdapterOptions = {
	fetch?: DomainHtmlFetchLike;
	headers?: Record<string, string>;
};

export type XPublicMetadataAdapter = PublicMetadataPlatformAdapter;

export function createXPublicMetadataAdapter(
	options: XPublicMetadataAdapterOptions = {}
): XPublicMetadataAdapter {
	const fetcher = resolveDomainHtmlFetch(options.fetch);

	return createPublicMetadataPlatformAdapter({
		domains: ['x'],
		sources: [
			{
				id: 'x-syndication',
				family: 'public-json',
				resolve: async ({ classification, canonicalUrl }) => {
					if (!fetcher || classification.subtype !== 'post') {
						return null;
					}

					const postId = toStringMaybe(classification.meta.postId);
					if (!postId) {
						return null;
					}

					const payload = await fetchJsonDocument<Record<string, unknown>>(fetcher, {
						url: buildXSyndicationUrl(postId),
						headers: options.headers,
					});
					const record = toRecordMaybe(payload);
					if (!record || isTweetTombstone(record)) {
						return null;
					}

					const atom = buildXSyndicationAtom({
						canonicalUrl,
						handle: toStringMaybe(classification.meta.handle),
						postId,
						payload: record,
					});

					return atom
						? {
								atom,
								fieldPolicies: X_PUBLIC_FIELD_POLICIES,
							}
						: null;
				},
			},
		],
	});
}

function buildXSyndicationUrl(postId: string): string {
	return `https://cdn.syndication.twimg.com/tweet-result?id=${postId}&token=${buildXSyndicationToken(postId)}`;
}

function buildXSyndicationToken(postId: string): string {
	return ((Number(postId) / 1e15) * Math.PI).toString(36).replace(/(0+|\.)/g, '');
}

function isTweetTombstone(payload: Record<string, unknown>): boolean {
	return (
		toStringMaybe(payload.__typename) === 'TweetTombstone' || !!toRecordMaybe(payload.tombstone)
	);
}

function buildXSyndicationAtom(input: {
	canonicalUrl: string;
	handle?: string;
	postId: string;
	payload: Record<string, unknown>;
}): ResolverAtom | null {
	const text = resolveSyndicationText(input.payload);
	const authorRecord = toRecordMaybe(input.payload.user) ?? {};
	const authorHandle = normalizeXHandle(
		toStringMaybe(authorRecord.screen_name) ?? input.handle ?? undefined
	);
	const authorName = toStringMaybe(authorRecord.name);
	const media = resolveSyndicationMedia(input.payload);
	const datePublished = toStringMaybe(input.payload.created_at);
	if (!text && media.length === 0 && !datePublished) {
		return null;
	}

	const canonicalUrl = normalizeXCanonicalUrl(input.canonicalUrl) ?? input.canonicalUrl;
	const authorImage =
		toStringMaybe(authorRecord.profile_image_url_https) ??
		toStringMaybe(authorRecord.profile_image_url);

	return buildXPostAtom({
		canonicalUrl,
		identifier: input.postId,
		handle: input.handle,
		authorHandle,
		authorDisplayName: authorName ?? (authorHandle ? `@${authorHandle}` : undefined),
		authorImage,
		text,
		media,
		datePublished,
		provider: 'x-syndication',
		resolutionMode: 'enriched',
	});
}

function resolveSyndicationText(payload: Record<string, unknown>): string | undefined {
	return toStringMaybe(payload.full_text) ?? toStringMaybe(payload.text);
}

function resolveSyndicationMedia(payload: Record<string, unknown>): string[] {
	const urls: string[] = [];
	const appendMediaUrls = (value: unknown) => {
		const record = toRecordMaybe(value);
		if (!record) {
			return;
		}

		for (const key of ['url', 'url_https', 'url_expanded', 'media_url_https', 'media_url']) {
			const candidate = toStringMaybe(record[key]);
			if (candidate) {
				urls.push(candidate);
			}
		}

		const variants = Array.isArray(record.variants) ? record.variants : [];
		for (const variant of variants) {
			appendMediaUrls(variant);
		}
	};

	for (const collectionKey of ['photos', 'mediaDetails']) {
		const collection = Array.isArray(payload[collectionKey]) ? payload[collectionKey] : [];
		for (const item of collection) {
			appendMediaUrls(item);
		}
	}

	appendMediaUrls(payload.video);
	return normalizeStringArray(urls);
}
