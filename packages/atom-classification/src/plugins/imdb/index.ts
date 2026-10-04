import type { DomainHtmlFetchLike } from '../shared/domain-html/fetch';
import { slugify, toStringMaybe, tryParseUrl, withPlatformMetadata } from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';
import { createImdbDomainHtmlAdapter } from './domain-html-adapter';
import { isImdbHostname } from './url';

export type ImdbPluginOptions = PlatformV0PluginOptions & {
	useDefaultDomainHtmlAdapter?: boolean;
	fetch?: DomainHtmlFetchLike;
};

export const imdbProfile: PlatformV0Profile = {
	domain: 'imdb',
	supportsOEmbed: false,
	classifier: {
		id: 'imdb-url-classifier',
		priority: 10,
		classify(input: string) {
			const parsed = tryParseUrl(input);
			if (!parsed || !isImdbHostname(parsed.hostname)) {
				return null;
			}

			const segments = parsed.pathname.split('/').filter(Boolean);
			if (segments.length < 2) {
				return null;
			}

			const firstSegment = segments[0];
			const secondSegment = segments[1];
			if (!firstSegment || !secondSegment) {
				return null;
			}

			if (firstSegment === 'title' && /^tt\d+$/.test(secondSegment)) {
				return {
					type: 'url' as const,
					domain: 'imdb',
					subtype: 'title',
					confidence: 0.98,
					meta: {
						titleId: secondSegment,
						canonicalUrl: `https://www.imdb.com/title/${secondSegment}/`,
					},
				};
			}

			if (firstSegment === 'name' && /^nm\d+$/.test(secondSegment)) {
				return {
					type: 'url' as const,
					domain: 'imdb',
					subtype: 'person',
					confidence: 0.97,
					meta: {
						personId: secondSegment,
						canonicalUrl: `https://www.imdb.com/name/${secondSegment}/`,
					},
				};
			}

			return null;
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		if (classification.subtype === 'person') {
			const personId = toStringMaybe(classification.meta.personId) ?? slugify(canonicalUrl);
			const name = `IMDb Person ${personId}`;
			return withPlatformMetadata(
				{
					schemaType: 'SocialMediaAccount',
					category: 'person',
					title: name,
					canonicalId: `imdb:name:${personId}`,
					sameAs: [canonicalUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'SocialMediaAccount',
						username: personId,
						platform: 'imdb',
						url: canonicalUrl,
						sameAs: [canonicalUrl],
					},
				},
				'imdb',
				classification.subtype,
				{
					pluginId: 'imdb',
					provider: 'imdb',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
				}
			);
		}

		return null;
	},
};

export function createImdbPlugin(options: ImdbPluginOptions = {}) {
	const { useDefaultDomainHtmlAdapter = true, fetch, ...platformOptions } = options;
	// Refuse legacy stage adapters: they cannot establish catalog-only title provenance.
	// Callers may inject the catalog fetch instead; person resolution stays offline.
	const hasLegacyAdapters = Object.values(platformOptions.adapters ?? {}).some(
		(adapter) => adapter != null
	);
	const domainHtmlAdapter =
		!hasLegacyAdapters && useDefaultDomainHtmlAdapter
			? createImdbDomainHtmlAdapter({ apiKey: platformOptions.credentials?.tmdb?.apiKey, fetch })
			: undefined;

	const plugin = createPlatformPlugin({
		pluginId: 'imdb',
		resolverId: 'imdb-resolver',
		profile: imdbProfile,
		options: {
			...platformOptions,
			adapters: undefined,
		},
	});

	// The shared fallback runner catches stage errors and continues to generic output.
	// Titles must instead terminate on a catalog miss and preserve resolver errors.
	const resolver = plugin.resolvers![0]!;
	const resolvePlatform = resolver.resolve;
	const resolveImdb: typeof resolver.resolve = async (context) => {
		const { classification, runtime, request, now } = context;
		if (classification.subtype !== 'title') return resolvePlatform(context);
		if (classification.domain !== 'imdb' || classification.type !== 'url') return null;
		const credential = platformOptions.credentials?.tmdb;
		if (
			runtime !== 'server' ||
			credential?.enabled === false ||
			!credential?.apiKey?.trim() ||
			!domainHtmlAdapter
		)
			return null;
		const canonicalUrl = toStringMaybe(classification.meta.canonicalUrl) ?? request.input;
		const atom = await domainHtmlAdapter({
			runtime,
			domain: 'imdb',
			classification,
			requestInput: request.input,
			canonicalUrl,
			credential,
		});
		if (!atom) return null;
		return {
			atoms: [
				{
					...atom,
					source: atom.source ?? 'platform-v0:domain-api',
					metadata: {
						...atom.metadata,
						fetchedAt: now,
						platform: 'imdb',
						fallbackStage: 'domain-api',
						fallbackChain: ['domain-api'],
					},
				},
			],
			fallbackUsed: false,
			metadata: {
				platformResolver: {
					domain: 'imdb',
					fallbackStage: 'domain-api',
					attemptedStages: ['domain-api'],
					skippedStages: [],
					stageErrors: [],
				},
			},
		};
	};
	resolver.resolve = async (context) => {
		try {
			return await resolveImdb(context);
		} catch (error) {
			// The engine records exception messages verbatim. Only fixed diagnostics may escape.
			const safeMessages = [
				'TMDB find 429 rate limit',
				'TMDB find auth 401',
				'TMDB find auth 403',
				'TMDB find upstream request failed',
			];
			const message = error instanceof Error ? error.message : '';
			if (safeMessages.includes(message) || /^TMDB find upstream 5\d{2}$/.test(message)) {
				throw new Error(message);
			}
			throw new Error('TMDB find upstream request failed');
		}
	};
	return plugin;
}
