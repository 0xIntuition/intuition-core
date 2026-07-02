import {
	slugify,
	toRecordMaybe,
	toStringMaybe,
	tryParseUrl,
	withPlatformMetadata,
} from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformCredential,
	type PlatformStageInput,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';
import { createXDomainApiAdapter } from './domain-api-adapter';
import { createXOpenGraphAdapter } from './opengraph-adapter';
import { createXPublicMetadataAdapter } from './public-metadata-adapter';
import {
	buildXPostAtom,
	buildXProfileAtom,
	normalizeUnknownStringArray,
	normalizeXHandle,
} from './shared';

export type { XDomainApiAdapter, XDomainApiAdapterOptions } from './domain-api-adapter';
export type { XOpenGraphAdapter, XOpenGraphAdapterOptions } from './opengraph-adapter';
export type {
	XPublicMetadataAdapter,
	XPublicMetadataAdapterOptions,
} from './public-metadata-adapter';
export type { XResolutionMode } from './shared';

export type XEnrichmentPayload = {
	provider: string;
	text?: string;
	authorName?: string;
	authorHandle?: string;
	authorImage?: string;
	media?: string[];
	quotedPostId?: string;
	replyToPostId?: string;
	datePublished?: string;
	canonicalUrl?: string;
};

export type XEnrichmentAdapterInput = {
	runtime: PlatformStageInput['runtime'];
	canonicalUrl: string;
	handle?: string;
	postId?: string;
	credential?: PlatformCredential;
};

export type XEnrichmentAdapter = (
	input: XEnrichmentAdapterInput
) => XEnrichmentPayload | Promise<XEnrichmentPayload | null | undefined> | null | undefined;

export type XPluginOptions = Omit<PlatformV0PluginOptions, 'adapters'> & {
	adapters?: PlatformV0PluginOptions['adapters'];
	enrichment?: XEnrichmentAdapter;
	useDefaultDomainApiAdapter?: boolean;
	useDefaultOpenGraphAdapter?: boolean;
	useDefaultPublicMetadataAdapter?: boolean;
};

const X_RESERVED_SEGMENTS = new Set([
	'explore',
	'hashtag',
	'home',
	'i',
	'intent',
	'login',
	'messages',
	'notifications',
	'search',
	'settings',
	'share',
	'tos',
	'privacy',
]);

export const xProfile: PlatformV0Profile = {
	domain: 'x',
	supportsOEmbed: true,
	classifier: {
		id: 'x-url-classifier',
		priority: 10,
		classify(input: string) {
			const parsed = tryParseUrl(input);
			if (!parsed) {
				return null;
			}

			const isXDomain = parsed.hostname === 'x.com' || parsed.hostname.endsWith('.x.com');
			const isTwitterDomain =
				parsed.hostname === 'twitter.com' || parsed.hostname.endsWith('.twitter.com');
			if (!isXDomain && !isTwitterDomain) {
				return null;
			}

			const segments = parsed.pathname.split('/').filter(Boolean);
			const handle = segments[0];
			const secondSegment = segments[1];
			const thirdSegment = segments[2];

			if (!handle) {
				return null;
			}

			const normalizedHandle = normalizeXHandle(handle);
			if (!normalizedHandle || X_RESERVED_SEGMENTS.has(normalizedHandle.toLowerCase())) {
				return null;
			}

			if (handle && secondSegment === 'status' && thirdSegment) {
				return {
					type: 'url' as const,
					domain: 'x',
					subtype: 'post',
					confidence: 0.98,
					meta: {
						handle: normalizedHandle,
						postId: thirdSegment,
						canonicalUrl: `https://x.com/${normalizedHandle}/status/${thirdSegment}`,
					},
				};
			}

			return {
				type: 'url' as const,
				domain: 'x',
				subtype: 'profile',
				confidence: 0.92,
				meta: {
					handle: normalizedHandle,
					canonicalUrl: `https://x.com/${normalizedHandle}`,
				},
			};
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		if (classification.subtype === 'profile') {
			const handle = toStringMaybe(classification.meta.handle) ?? 'unknown';
			return withPlatformMetadata(
				buildXProfileAtom({
					canonicalUrl,
					handle,
					provider: 'x',
					resolutionMode: 'identity-only',
				}),
				'x',
				classification.subtype,
				{
					pluginId: 'x',
					provider: 'x',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
					resolutionMode: 'identity-only',
				}
			);
		}

		const postId = toStringMaybe(classification.meta.postId) ?? '';
		const handle = toStringMaybe(classification.meta.handle);
		return withPlatformMetadata(
			buildXPostAtom({
				canonicalUrl,
				identifier: postId || slugify(canonicalUrl),
				handle,
				includeAuthor: false,
				provider: 'x',
				resolutionMode: 'identity-only',
			}),
			'x',
			classification.subtype,
			{
				pluginId: 'x',
				provider: 'x',
				fetchedAt: now,
				sourceUrl: canonicalUrl,
				confidence: classification.confidence,
				resolutionMode: 'identity-only',
			}
		);
	},
};

export function createXPlugin(options: XPluginOptions = {}) {
	const {
		enrichment,
		useDefaultDomainApiAdapter = true,
		useDefaultOpenGraphAdapter = false,
		useDefaultPublicMetadataAdapter = true,
		...platformOptions
	} = options;
	const domainApiAdapter =
		platformOptions.adapters?.domainApi ??
		composeXDomainApiAdapters([
			useDefaultDomainApiAdapter ? createXDomainApiAdapter() : undefined,
			enrichment ? createXEnrichmentDomainApiAdapter(enrichment) : undefined,
		]);
	const publicMetadataAdapter =
		platformOptions.adapters?.publicMetadata ??
		(useDefaultPublicMetadataAdapter ? createXPublicMetadataAdapter() : undefined);
	const openGraphAdapter =
		platformOptions.adapters?.openGraph ??
		(useDefaultOpenGraphAdapter ? createXOpenGraphAdapter() : undefined);
	// X should stay identity-first by default. Richer paths can participate, but
	// they compose behind the same platform fallback chain rather than bypassing it.
	const profile =
		domainApiAdapter || publicMetadataAdapter || openGraphAdapter
			? {
					...xProfile,
					allowDomainApiWithoutCredentials: !!domainApiAdapter,
				}
			: xProfile;

	return createPlatformPlugin({
		pluginId: 'x',
		resolverId: 'x-resolver',
		profile,
		options: {
			...platformOptions,
			adapters: {
				...platformOptions.adapters,
				domainApi: domainApiAdapter,
				publicMetadata: publicMetadataAdapter,
				openGraph: openGraphAdapter,
			},
		},
	});
}

function composeXDomainApiAdapters(
	adapters: Array<NonNullable<PlatformV0PluginOptions['adapters']>['domainApi'] | undefined>
): NonNullable<PlatformV0PluginOptions['adapters']>['domainApi'] | undefined {
	const activeAdapters = adapters.filter((adapter) => typeof adapter === 'function');
	if (activeAdapters.length === 0) {
		return undefined;
	}

	return async (input) => {
		for (const adapter of activeAdapters) {
			const result = await Promise.resolve(adapter(input));
			if (result) {
				return result;
			}
		}

		return null;
	};
}

function createXEnrichmentDomainApiAdapter(
	adapter: XEnrichmentAdapter
): NonNullable<PlatformV0PluginOptions['adapters']>['domainApi'] {
	return async ({ runtime, canonicalUrl, classification, credential }) => {
		if (classification.subtype !== 'post') {
			return null;
		}

		const payload = await Promise.resolve(
			adapter({
				runtime,
				canonicalUrl,
				handle: toStringMaybe(classification.meta.handle),
				postId: toStringMaybe(classification.meta.postId),
				credential,
			})
		);
		const record = toRecordMaybe(payload);
		if (!record) {
			return null;
		}

		return buildEnrichedXPostAtom({
			canonicalUrl,
			handle: toStringMaybe(classification.meta.handle),
			postId: toStringMaybe(classification.meta.postId),
			payload: record,
		});
	};
}

function buildEnrichedXPostAtom(input: {
	canonicalUrl: string;
	handle?: string;
	postId?: string;
	payload: Record<string, unknown>;
}) {
	const canonicalUrl = toStringMaybe(input.payload.canonicalUrl) ?? input.canonicalUrl;
	const identifier = input.postId ?? slugify(canonicalUrl);
	const text = toStringMaybe(input.payload.text);
	const authorHandle = normalizeXHandle(
		toStringMaybe(input.payload.authorHandle) ?? input.handle ?? undefined
	);
	const authorName = toStringMaybe(input.payload.authorName);
	const authorImage = toStringMaybe(input.payload.authorImage);
	const provider = toStringMaybe(input.payload.provider) ?? 'x-enrichment';
	const media = normalizeUnknownStringArray(input.payload.media);
	const datePublished = toStringMaybe(input.payload.datePublished);
	const quotedPostId = toStringMaybe(input.payload.quotedPostId);
	const replyToPostId = toStringMaybe(input.payload.replyToPostId);

	return buildXPostAtom({
		canonicalUrl,
		identifier,
		handle: input.handle,
		authorHandle,
		authorDisplayName: authorName,
		authorImage,
		includeAlternateName: false,
		text,
		media,
		datePublished,
		quotedPostId,
		replyToPostId,
		provider,
		resolutionMode: 'enriched',
	});
}
