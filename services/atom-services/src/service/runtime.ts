import {
	type ClassificationCacheAdapter,
	createAmazonCanopyPluginOptions,
	createMemoryClassificationCacheAdapter,
	createServerEngine,
	createSpotifyDomainApiAdapter,
	createUpstashClassificationCacheAdapterFromEnv,
	createYouTubeOEmbedAdapter,
	defaultClassificationPreset,
} from '@0xintuition/atom-classification';
import {
	academicPreset,
	companyPreset,
	createEnrichmentEngine,
	createMemoryCacheAdapter,
	createServerDefaultPresetOptions,
	createUpstashCacheAdapterFromEnv,
	cryptoPreset,
	type CacheAdapter as EnrichmentCacheAdapter,
	type EnrichmentPlugin,
	musicPreset,
	serverDefaultPreset,
} from '@0xintuition/atom-enrichment';
import type { EnrichmentPreset } from '../contracts';

export type ProcessingRuntimeOptions = {
	defaultPreset: EnrichmentPreset;
	cacheProvider: 'memory' | 'none' | 'upstash';
	memoryCacheMaxEntries: number;
	classificationMemoryCacheMaxEntries: number;
	classificationResolverCacheTtlMs: number;
	cacheHttpTimeoutMs: number;
	env: Record<string, string | undefined>;
};

export type PresetFactoryRegistry = Record<EnrichmentPreset, () => EnrichmentPlugin[]>;

export type CacheRuntime = {
	enrichmentCache: EnrichmentCacheAdapter | undefined;
	classificationCache: ClassificationCacheAdapter | undefined;
	classificationResolverCacheTtlMs: number | undefined;
	cacheProvider: 'memory' | 'none' | 'upstash';
	warnings: string[];
};

export function createPresetFactories(
	env: Record<string, string | undefined>
): PresetFactoryRegistry {
	const serverDefaultPresetOptions = createServerDefaultPresetOptions(env);
	const allProviders = () => serverDefaultPreset(serverDefaultPresetOptions);

	return {
		default: allProviders,
		company: () =>
			companyPreset({
				brand: {
					apiKey: env.BRANDFETCH_API_KEY,
				},
			}),
		music: () =>
			musicPreset({
				spotify: serverDefaultPresetOptions.spotify,
			}),
		crypto: () =>
			cryptoPreset({
				etherscan: {
					apiKey: env.ETHERSCAN_API_KEY,
				},
				coingecko: {
					apiKey: env.COINGECKO_API_KEY,
				},
			}),
		academic: () => academicPreset(),
		custom: allProviders,
	};
}

export function createCacheRuntime(options: ProcessingRuntimeOptions): CacheRuntime {
	const warnings: string[] = [];
	const classificationResolverCacheTtlMs = options.classificationResolverCacheTtlMs;

	if (options.cacheProvider === 'none') {
		return {
			enrichmentCache: undefined,
			classificationCache: undefined,
			classificationResolverCacheTtlMs,
			cacheProvider: 'none',
			warnings,
		};
	}

	if (options.cacheProvider === 'upstash') {
		const enrichmentCache = createUpstashCacheAdapterFromEnv({
			env: options.env,
			httpTimeoutMs: options.cacheHttpTimeoutMs,
		});
		const classificationCache = createUpstashClassificationCacheAdapterFromEnv({
			env: options.env,
			httpTimeoutMs: options.cacheHttpTimeoutMs,
		});

		if (enrichmentCache && classificationCache) {
			return {
				enrichmentCache,
				classificationCache,
				classificationResolverCacheTtlMs,
				cacheProvider: 'upstash',
				warnings,
			};
		}

		warnings.push(
			'ATOM_SERVICES_CACHE_PROVIDER=upstash requested, but UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN are missing. Falling back to in-memory cache.'
		);
	}

	return {
		enrichmentCache: createMemoryCacheAdapter({
			maxEntries: options.memoryCacheMaxEntries,
		}),
		classificationCache: createMemoryClassificationCacheAdapter({
			maxEntries: options.classificationMemoryCacheMaxEntries,
		}),
		classificationResolverCacheTtlMs,
		cacheProvider: 'memory',
		warnings,
	};
}

export function createClassificationRuntime(options: ProcessingRuntimeOptions) {
	const canopyApiKey = options.env.CANOPY_API_KEY;
	const spotifyClientId = options.env.SPOTIFY_CLIENT_ID;
	const spotifyClientSecret = options.env.SPOTIFY_CLIENT_SECRET;
	const xBearerToken = options.env.X_BEARER_TOKEN;
	const cacheRuntime = createCacheRuntime(options);

	return {
		engine: createServerEngine({
			cache: cacheRuntime.classificationCache,
			resolverCacheTtlMs: cacheRuntime.classificationResolverCacheTtlMs,
			plugins: defaultClassificationPreset({
				amazonPluginOptions: createAmazonCanopyPluginOptions({
					apiKey: canopyApiKey,
				}),
				spotifyPluginOptions: {
					credentials: {
						spotify: {
							clientId: spotifyClientId,
							clientSecret: spotifyClientSecret,
						},
					},
					adapters: {
						domainApi: createSpotifyDomainApiAdapter({
							clientId: spotifyClientId,
							clientSecret: spotifyClientSecret,
							market: options.env.SPOTIFY_MARKET,
						}),
					},
				},
				etherscanPluginOptions: {
					apiKey: options.env.ETHERSCAN_API_KEY,
				},
				platformV0PluginOptions: {
					credentials: {
						spotify: {
							clientId: spotifyClientId,
							clientSecret: spotifyClientSecret,
						},
						x: {
							token: xBearerToken,
						},
					},
					adapters: {
						oEmbed: createYouTubeOEmbedAdapter(),
					},
				},
			}),
		}),
		...cacheRuntime,
	};
}

export function createEnrichmentRuntime(options: ProcessingRuntimeOptions) {
	const cacheRuntime = createCacheRuntime(options);
	const presetFactories = createPresetFactories(options.env);

	return {
		createEngine: (preset: EnrichmentPreset) =>
			createEnrichmentEngine({
				plugins: presetFactories[preset](),
				cache: cacheRuntime.enrichmentCache,
			}),
		presetFactories,
		presetSummary: {
			default: presetFactories.default().map((plugin) => plugin.id),
			company: presetFactories.company().map((plugin) => plugin.id),
			music: presetFactories.music().map((plugin) => plugin.id),
			crypto: presetFactories.crypto().map((plugin) => plugin.id),
			academic: presetFactories.academic().map((plugin) => plugin.id),
			custom: presetFactories.custom().map((plugin) => plugin.id),
		} satisfies Record<EnrichmentPreset, string[]>,
		...cacheRuntime,
	};
}
