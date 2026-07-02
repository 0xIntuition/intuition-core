export type { CacheAdapter, CachedEntry } from './cache';
export {
	buildCacheKey,
	createMemoryCacheAdapter,
	createUpstashCacheAdapter,
	createUpstashCacheAdapterFromEnv,
	isCachedEntryFresh,
} from './cache';

export type {
	ClassificationCategory,
	ClassificationDefinition,
	ClassificationRegistry,
	RegisterClassificationOptions,
} from './classifications';
export {
	builtinClassificationDefinitions,
	classificationCategorySchema,
	classificationSlugSchema,
	createClassificationRegistry,
	createDefaultClassificationRegistry,
	listBuiltinClassificationSlugs,
	registerBuiltinClassifications,
} from './classifications';

export type { EnrichmentEngine, EnrichmentEngineConfig } from './engine';
export { createEnrichmentEngine } from './engine';
export type { ClassificationResultLike } from './handoff';
export {
	normalizeResolvedClassificationInput,
	resolveClassifiedAtomPolicy,
	resolvePreferredEnrichmentUrl,
	toClassifiedAtomInput,
} from './handoff';
export type {
	EnrichmentPluginRegistry,
	RegisterPluginOptions,
	ResolvePluginsResult,
} from './plugin-registry';
export { createEnrichmentPluginRegistry } from './plugin-registry';
export type {
	EnrichmentPlugin,
	EnrichmentPluginContext,
	EnrichmentPluginLogger,
	EnrichmentPluginManifest,
	ParsedEnrichmentPluginManifest,
} from './plugins';
export {
	defineEnrichmentPlugin,
	enrichmentPluginManifestSchema,
	isPluginRuntimeCompatible,
	validateEnrichmentPluginManifest,
} from './plugins';
export type { FetchLike } from './plugins/providers';
export {
	createBrandPlugin,
	createCoinGeckoPlugin,
	createCrossrefPlugin,
	createEtherscanPlugin,
	createFaviconPlugin,
	createGitHubPlugin,
	createMusicBrainzPlugin,
	createNpmPlugin,
	createOEmbedPlugin,
	createOpenGraphPlugin,
	createProductListingPlugin,
	createSpotifyPlugin,
	createTmdbPlugin,
	createWikidataPlugin,
	createWikipediaPlugin,
	createXProfilePlugin,
	createYouTubePlugin,
} from './plugins/providers';
export type {
	AcademicPresetOptions,
	CompanyPresetOptions,
	CryptoPresetOptions,
	EnrichmentPreset,
	MusicPresetOptions,
	ServerDefaultPresetEnvironment,
	ServerDefaultPresetOptions,
} from './presets';
export {
	academicPreset,
	companyPreset,
	createServerDefaultPresetOptions,
	cryptoPreset,
	musicPreset,
	serverDefaultPreset,
} from './presets';
export type {
	CanopyAmazonProduct,
	CanopyAmazonProductResponse,
	GitHubRepoResponse,
	GitHubUserResponse,
	SpotifyAlbumResponse,
	SpotifyArtistResponse,
	SpotifyEpisodeResponse,
	SpotifyPlaylistResponse,
	SpotifyShowResponse,
	SpotifyTokenResponse,
	SpotifyTrackResponse,
	XPublicMetricsResponse,
	XUserLookupResponse,
	XUserLookupUser,
} from './provider-external-data';
export {
	canopyAmazonProductResponseSchema,
	canopyAmazonProductSchema,
	gitHubRepoResponseSchema,
	gitHubUserResponseSchema,
	spotifyAlbumResponseSchema,
	spotifyArtistResponseSchema,
	spotifyEpisodeResponseSchema,
	spotifyPlaylistResponseSchema,
	spotifyShowResponseSchema,
	spotifyTokenResponseSchema,
	spotifyTrackResponseSchema,
	xPublicMetricsResponseSchema,
	xUserLookupResponseSchema,
	xUserLookupUserSchema,
} from './provider-external-data';
export {
	canonicalizeEnrichmentSlug,
	canonicalizeEnrichmentSlugs,
	expandEnrichmentSlugAliases,
	expandEnrichmentSlugAliasesList,
} from './slug-aliases';
export type {
	AmazonTarget,
	AtomType,
	ClassifiedAtomInput,
	ClassifiedAtomPolicy,
	ClassifiedAtomTargets,
	EnrichmentArtifact,
	EnrichmentArtifactMeta,
	EnrichmentRequest,
	EnrichmentRunResult,
	EnrichmentRuntime,
	EnrichmentSkippedPlugin,
	GitHubTarget,
	PluginExecutionError,
	PluginExecutionErrorCode,
	PluginRuntime,
	RawInputKind,
	XTarget,
} from './types';
export {
	amazonTargetSchema,
	atomTypeSchema,
	classifiedAtomInputSchema,
	classifiedAtomPolicySchema,
	classifiedAtomTargetsSchema,
	enrichmentArtifactMetaSchema,
	enrichmentArtifactSchema,
	enrichmentRequestSchema,
	enrichmentRunResultSchema,
	enrichmentRuntimeSchema,
	githubTargetSchema,
	pluginExecutionErrorCodeSchema,
	pluginExecutionErrorSchema,
	pluginRuntimeSchema,
	rawInputKindSchema,
	xTargetSchema,
} from './types';
