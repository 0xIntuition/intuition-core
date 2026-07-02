import {
	type ClassificationResultLike,
	normalizeResolvedClassificationInput,
	resolveClassifiedAtomPolicy,
	resolvePreferredEnrichmentUrl,
	toClassifiedAtomInput,
} from '@0xintuition/atom-enrichment/handoff';
import {
	type AiEntitiesData,
	type AiSummaryData,
	type AppleMusicData,
	type ArxivData,
	aiEntitiesDataSchema,
	aiSummaryDataSchema,
	appleMusicDataSchema,
	arxivDataSchema,
	type BrandData,
	brandDataSchema,
	type ColorPaletteData,
	type CompanyProfileData,
	type CrunchbaseData,
	colorPaletteDataSchema,
	companyProfileDataSchema,
	crunchbaseDataSchema,
	type DictionaryData,
	type DoiData,
	dictionaryDataSchema,
	doiDataSchema,
	type EnsData,
	type EtherscanData,
	ensDataSchema,
	etherscanDataSchema,
	type FaviconData,
	faviconDataSchema,
	type GeocodeData,
	type GitHubRepoData,
	type GitHubUserData,
	geocodeDataSchema,
	githubRepoDataSchema,
	githubUserDataSchema,
	type IsbnData,
	isbnDataSchema,
	type MicrodataData,
	type MusicBrainzData,
	microdataDataSchema,
	musicbrainzDataSchema,
	type NftMetadataData,
	type NpmPackageData,
	nftMetadataDataSchema,
	npmPackageDataSchema,
	type OEmbedData,
	type OpenGraphData,
	oembedDataSchema,
	opengraphDataSchema,
	type PlacesData,
	type ProductListingData,
	type PubmedData,
	placesDataSchema,
	productListingDataSchema,
	pubmedDataSchema,
	type RedditPostData,
	redditPostDataSchema,
	type ScreenshotData,
	type SpotifyData,
	screenshotDataSchema,
	spotifyDataSchema,
	type TmdbData,
	type TokenMetadataData,
	tmdbDataSchema,
	tokenMetadataDataSchema,
	type VimeoData,
	vimeoDataSchema,
	type WikidataData,
	type WikipediaData,
	wikidataDataSchema,
	wikipediaDataSchema,
	type XProfileData,
	xProfileDataSchema,
	type YouTubeData,
	youtubeDataSchema,
} from '@0xintuition/atom-enrichment/provider-data';
import {
	canonicalizeEnrichmentSlug,
	canonicalizeEnrichmentSlugs,
	expandEnrichmentSlugAliases,
	expandEnrichmentSlugAliasesList,
} from '@0xintuition/atom-enrichment/slug-aliases';
import {
	type AmazonTarget,
	amazonTargetSchema,
	atomTypeSchema,
	type ClassifiedAtomInput,
	type ClassifiedAtomPolicy,
	type ClassifiedAtomTargets,
	classifiedAtomInputSchema,
	classifiedAtomPolicySchema,
	classifiedAtomTargetsSchema,
	type EnrichmentArtifact,
	type EnrichmentArtifactMeta,
	type EnrichmentRequest,
	type EnrichmentRunResult,
	type EnrichmentRuntime,
	type EnrichmentSkippedPlugin,
	enrichmentArtifactMetaSchema,
	enrichmentArtifactSchema,
	enrichmentRequestSchema,
	enrichmentRunResultSchema,
	enrichmentRuntimeSchema,
	type GitHubTarget,
	githubTargetSchema,
	type PluginExecutionError,
	type PluginExecutionErrorCode,
	type PluginRuntime,
	pluginExecutionErrorCodeSchema,
	pluginExecutionErrorSchema,
	pluginRuntimeSchema,
	type RawInputKind,
	rawInputKindSchema,
	type XTarget,
	xTargetSchema,
} from '@0xintuition/atom-enrichment/types';
import { z } from 'zod/v4';
import {
	classificationClientHintsSchema,
	classificationInputIntentSchema,
	classificationModeSchema,
	classificationPluginIdSchema,
	classificationRequestSchema,
	classificationResultSchema,
	classificationSessionIdSchema,
	enhancementPolicyOverrideSchema,
} from '../classification';

export type {
	AnyCanonicalEnrichmentArtifact,
	CanonicalEnrichmentArtifact,
	CanonicalEnrichmentArtifactDataBySlug,
	CanonicalEnrichmentArtifactMeta,
	CanonicalEnrichmentArtifactSlug,
	PersistedEnrichmentArtifactInput,
	ProcessEnrichmentArtifactInput,
} from './artifacts';
export {
	canonicalizeKnownArtifactSlug,
	normalizePersistedEnrichmentArtifacts,
	normalizeProcessEnrichmentArtifacts,
} from './artifacts';

export type {
	AmazonTarget,
	ClassifiedAtomInput,
	ClassifiedAtomPolicy,
	ClassifiedAtomTargets,
	ClassificationResultLike,
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
};

export {
	amazonTargetSchema,
	atomTypeSchema,
	classifiedAtomInputSchema,
	classifiedAtomPolicySchema,
	classifiedAtomTargetsSchema,
	canonicalizeEnrichmentSlug,
	canonicalizeEnrichmentSlugs,
	enrichmentArtifactMetaSchema,
	enrichmentArtifactSchema,
	enrichmentRequestSchema,
	enrichmentRunResultSchema,
	enrichmentRuntimeSchema,
	expandEnrichmentSlugAliases,
	expandEnrichmentSlugAliasesList,
	githubTargetSchema,
	normalizeResolvedClassificationInput,
	pluginExecutionErrorCodeSchema,
	pluginExecutionErrorSchema,
	pluginRuntimeSchema,
	rawInputKindSchema,
	resolveClassifiedAtomPolicy,
	resolvePreferredEnrichmentUrl,
	toClassifiedAtomInput,
	xTargetSchema,
};

export type {
	AiEntitiesData,
	AiSummaryData,
	AppleMusicData,
	ArxivData,
	BrandData,
	ColorPaletteData,
	CompanyProfileData,
	CrunchbaseData,
	DictionaryData,
	DoiData,
	EnsData,
	EtherscanData,
	FaviconData,
	GeocodeData,
	GitHubRepoData,
	GitHubUserData,
	IsbnData,
	MicrodataData,
	MusicBrainzData,
	NftMetadataData,
	NpmPackageData,
	OEmbedData,
	OpenGraphData,
	PlacesData,
	ProductListingData,
	PubmedData,
	RedditPostData,
	ScreenshotData,
	SpotifyData,
	TmdbData,
	TokenMetadataData,
	XProfileData,
	VimeoData,
	WikidataData,
	WikipediaData,
	YouTubeData,
};

export {
	aiEntitiesDataSchema,
	aiSummaryDataSchema,
	appleMusicDataSchema,
	arxivDataSchema,
	brandDataSchema,
	colorPaletteDataSchema,
	companyProfileDataSchema,
	crunchbaseDataSchema,
	dictionaryDataSchema,
	doiDataSchema,
	ensDataSchema,
	etherscanDataSchema,
	faviconDataSchema,
	geocodeDataSchema,
	githubRepoDataSchema,
	githubUserDataSchema,
	isbnDataSchema,
	microdataDataSchema,
	musicbrainzDataSchema,
	nftMetadataDataSchema,
	npmPackageDataSchema,
	oembedDataSchema,
	opengraphDataSchema,
	placesDataSchema,
	productListingDataSchema,
	pubmedDataSchema,
	redditPostDataSchema,
	screenshotDataSchema,
	spotifyDataSchema,
	tmdbDataSchema,
	tokenMetadataDataSchema,
	xProfileDataSchema,
	vimeoDataSchema,
	wikidataDataSchema,
	wikipediaDataSchema,
	youtubeDataSchema,
};

export const enrichmentSlugSchema = z
	.string()
	.min(2)
	.max(40)
	.regex(/^[a-z][a-z0-9-]{0,38}[a-z0-9]$/);

export const enrichmentPresetSchema = z.enum([
	'default',
	'company',
	'music',
	'crypto',
	'academic',
	'custom',
]);

export const enrichmentOptionsSchema = z
	.object({
		preset: enrichmentPresetSchema.default('default'),
		plugins: z.array(enrichmentSlugSchema).max(128).optional(),
		artifactClasses: z.array(enrichmentSlugSchema).max(128).optional(),
		concurrency: z.number().int().min(1).max(64).optional(),
		timeoutMs: z.number().int().min(1).max(120_000).optional(),
		traceId: z.string().min(1).max(128).optional(),
	})
	.strict();

export const processClassificationInputSchema = z
	.object({
		mode: classificationModeSchema.optional(),
		inputIntent: classificationInputIntentSchema.optional(),
		classificationSessionId: classificationSessionIdSchema.optional(),
		pluginIds: z.array(classificationPluginIdSchema).max(32).optional(),
		policy: enhancementPolicyOverrideSchema.optional(),
		clientHints: classificationClientHintsSchema.optional(),
	})
	.strict();

export const enrichRequestSchema = z
	.object({
		input: classifiedAtomInputSchema,
		enrichment: enrichmentOptionsSchema.default({ preset: 'default' }),
	})
	.strict();

export const manualBatchEnrichRequestSchema = z
	.object({
		input: classifiedAtomInputSchema,
		urls: z.array(z.string().url()).min(1).max(12),
		enrichment: enrichmentOptionsSchema.default({ preset: 'default' }),
		traceId: z.string().min(1).max(128).optional(),
	})
	.strict();

export const processRequestSchema = z
	.object({
		rawInput: z.string().min(1).max(10_000),
		classification: processClassificationInputSchema.optional(),
		enrichment: enrichmentOptionsSchema.default({ preset: 'default' }),
		traceId: z.string().min(1).max(128).optional(),
	})
	.strict();

export const classificationSpecSlugSchema = z
	.string()
	.min(2)
	.max(64)
	.regex(/^[a-z][a-z0-9-]{0,62}[a-z0-9]$/);

// The enrichment preset is derived from the target classification on the
// server; callers may override it explicitly but there is no implicit default.
export const extractFieldsEnrichmentOptionsSchema = z
	.object({
		preset: enrichmentPresetSchema.optional(),
		plugins: z.array(enrichmentSlugSchema).max(128).optional(),
		concurrency: z.number().int().min(1).max(64).optional(),
		timeoutMs: z.number().int().min(1).max(120_000).optional(),
	})
	.strict();

export const extractFieldsRequestSchema = z
	.object({
		url: z.string().url().max(2048),
		classification: classificationSpecSlugSchema,
		enrichment: extractFieldsEnrichmentOptionsSchema.optional(),
		traceId: z.string().min(1).max(128).optional(),
	})
	.strict();

export const extractedClassificationFieldSchema = z
	.object({
		key: z.string().min(1).max(64),
		value: z.unknown(),
		source: z.string().min(1).max(64),
		confidence: z.number().min(0).max(1),
		evidenceUrl: z.string().url().optional(),
	})
	.strict();

export const extractExistingMatchSchema = z
	.object({
		atomId: z.string().min(1).max(256),
		band: z.enum(['exact', 'strong', 'similar']),
		matchedOn: z
			.array(
				z
					.object({
						channel: z.enum([
							'url',
							'alias',
							'identity-key',
							'content-hash',
							'lexical',
							'semantic',
						]),
						value: z.string().min(1).max(2048),
						score: z.number().min(0).max(1).optional(),
					})
					.strict()
			)
			.min(1)
			.max(8),
	})
	.strict();

export const extractFieldsResponseSchema = z
	.object({
		status: z.enum(['success', 'partial', 'failed']),
		classification: classificationSpecSlugSchema,
		values: z.record(z.string(), z.unknown()),
		fields: z.record(z.string(), extractedClassificationFieldSchema),
		missingRequired: z.array(z.string().min(1).max(64)),
		/**
		 * Classification slugs the URL family / gathered artifacts indicate,
		 * most specific first. Non-empty + disagreeing with the requested
		 * classification ⇒ the UI shows the type-mismatch guard.
		 */
		suggestedClassifications: z.array(classificationSpecSlugSchema).max(8),
		/**
		 * Existing atoms this URL/extraction appears to match, banded by
		 * confidence (entity-resolution-spec.md §10). Exact-band matches drive
		 * the "already exists" interstitial; matching never blocks creation.
		 */
		existingMatches: z.array(extractExistingMatchSchema).max(5),
		/** True when match search timed out or a channel errored. */
		matchSearchDegraded: z.boolean().optional(),
		droppedFields: z.array(
			z
				.object({
					key: z.string().min(1).max(64),
					source: z.string().min(1).max(64),
					reason: z.string().min(1).max(512),
				})
				.strict()
		),
		enrichment: enrichmentRunResultSchema,
		traceId: z.string().min(1).max(128).optional(),
	})
	.strict();

export const processObservabilitySchema = z
	.object({
		phases: z
			.object({
				totalMs: z.number().int().min(0),
				classifyMs: z.number().int().min(0),
				enrichMs: z.number().int().min(0).optional(),
			})
			.strict(),
		plugins: z
			.object({
				executed: z.number().int().min(0),
				failed: z.number().int().min(0),
				skipped: z.number().int().min(0),
				artifacts: z.number().int().min(0),
				perPluginMs: z.record(z.string(), z.number().int().min(0)),
			})
			.strict()
			.nullable(),
	})
	.strict();

export const processCoreResponseSchema = z
	.object({
		runId: z.string().min(1).max(128),
		status: z.enum(['success', 'partial', 'failed']),
		mode: z.literal('process'),
		classification: classificationResultSchema,
		enrichment: enrichmentRunResultSchema.nullable(),
		timings: z
			.object({
				totalMs: z.number().int().min(0),
				classifyMs: z.number().int().min(0),
				enrichMs: z.number().int().min(0).optional(),
			})
			.strict(),
		observability: processObservabilitySchema,
		traceId: z.string().min(1).max(128).optional(),
	})
	.strict();

function createKnownArtifactSchema<TType extends string, TSchema extends z.ZodTypeAny>(
	artifactType: TType,
	dataSchema: TSchema
) {
	return z
		.object({
			artifact_type: z.literal(artifactType),
			data: dataSchema,
			meta: enrichmentArtifactMetaSchema,
		})
		.strict();
}

export const brandArtifactSchema = createKnownArtifactSchema('brand', brandDataSchema);
export const doiArtifactSchema = createKnownArtifactSchema('doi', doiDataSchema);
export const etherscanArtifactSchema = createKnownArtifactSchema('etherscan', etherscanDataSchema);
export const faviconArtifactSchema = createKnownArtifactSchema('favicon', faviconDataSchema);
export const githubRepoArtifactSchema = createKnownArtifactSchema(
	'github-repo',
	githubRepoDataSchema
);
export const githubUserArtifactSchema = createKnownArtifactSchema(
	'github-user',
	githubUserDataSchema
);
export const musicbrainzArtifactSchema = createKnownArtifactSchema(
	'musicbrainz',
	musicbrainzDataSchema
);
export const npmPackageArtifactSchema = createKnownArtifactSchema(
	'npm-package',
	npmPackageDataSchema
);
export const oembedArtifactSchema = createKnownArtifactSchema('oembed', oembedDataSchema);
export const opengraphArtifactSchema = createKnownArtifactSchema('opengraph', opengraphDataSchema);
export const productListingArtifactSchema = createKnownArtifactSchema(
	'product-listing',
	productListingDataSchema
);
export const spotifyArtifactSchema = createKnownArtifactSchema('spotify', spotifyDataSchema);
export const tmdbArtifactSchema = createKnownArtifactSchema('tmdb', tmdbDataSchema);
export const tokenMetadataArtifactSchema = createKnownArtifactSchema(
	'token-metadata',
	tokenMetadataDataSchema
);
export const xProfileArtifactSchema = createKnownArtifactSchema('x-profile', xProfileDataSchema);
export const legacyXProfileArtifactSchema = createKnownArtifactSchema(
	'twitter-profile',
	xProfileDataSchema
);
export const wikidataArtifactSchema = createKnownArtifactSchema('wikidata', wikidataDataSchema);
export const wikipediaArtifactSchema = createKnownArtifactSchema('wikipedia', wikipediaDataSchema);
export const youtubeArtifactSchema = createKnownArtifactSchema('youtube', youtubeDataSchema);

export const knownEnrichmentArtifactSchemas = [
	brandArtifactSchema,
	doiArtifactSchema,
	etherscanArtifactSchema,
	faviconArtifactSchema,
	githubRepoArtifactSchema,
	githubUserArtifactSchema,
	musicbrainzArtifactSchema,
	npmPackageArtifactSchema,
	oembedArtifactSchema,
	opengraphArtifactSchema,
	productListingArtifactSchema,
	spotifyArtifactSchema,
	tmdbArtifactSchema,
	tokenMetadataArtifactSchema,
	xProfileArtifactSchema,
	legacyXProfileArtifactSchema,
	wikidataArtifactSchema,
	wikipediaArtifactSchema,
	youtubeArtifactSchema,
] as const;

export const knownEnrichmentArtifactSchema = z.discriminatedUnion(
	'artifact_type',
	knownEnrichmentArtifactSchemas
);

export const knownEnrichmentArtifactSchemaByType = {
	brand: brandArtifactSchema,
	doi: doiArtifactSchema,
	etherscan: etherscanArtifactSchema,
	favicon: faviconArtifactSchema,
	'github-repo': githubRepoArtifactSchema,
	'github-user': githubUserArtifactSchema,
	musicbrainz: musicbrainzArtifactSchema,
	'npm-package': npmPackageArtifactSchema,
	oembed: oembedArtifactSchema,
	opengraph: opengraphArtifactSchema,
	'product-listing': productListingArtifactSchema,
	spotify: spotifyArtifactSchema,
	tmdb: tmdbArtifactSchema,
	'token-metadata': tokenMetadataArtifactSchema,
	'x-profile': xProfileArtifactSchema,
	'twitter-profile': legacyXProfileArtifactSchema,
	wikidata: wikidataArtifactSchema,
	wikipedia: wikipediaArtifactSchema,
	youtube: youtubeArtifactSchema,
} as const;

export const classifyRequestSchema = classificationRequestSchema;
export const classifyResponseSchema = classificationResultSchema;
export const enrichProcedureInputSchema = enrichRequestSchema;
export const extractFieldsProcedureInputSchema = extractFieldsRequestSchema;
export const extractFieldsProcedureOutputSchema = extractFieldsResponseSchema;
export const manualBatchEnrichProcedureInputSchema = manualBatchEnrichRequestSchema;
export const processProcedureInputSchema = processRequestSchema;
export const processProcedureOutputSchema = processCoreResponseSchema;

export type KnownEnrichmentArtifact = z.infer<typeof knownEnrichmentArtifactSchema>;
export type KnownEnrichmentArtifactType = KnownEnrichmentArtifact['artifact_type'];
export type EnrichmentPreset = z.infer<typeof enrichmentPresetSchema>;
export type EnrichmentOptions = z.infer<typeof enrichmentOptionsSchema>;
export type ProcessClassificationInput = z.infer<typeof processClassificationInputSchema>;
export type EnrichRequest = z.infer<typeof enrichRequestSchema>;
export type ExtractFieldsRequest = z.infer<typeof extractFieldsRequestSchema>;
export type ExtractFieldsResponse = z.infer<typeof extractFieldsResponseSchema>;
export type ExtractExistingMatch = z.infer<typeof extractExistingMatchSchema>;
export type ExtractedClassificationField = z.infer<typeof extractedClassificationFieldSchema>;
export type ManualBatchEnrichRequest = z.infer<typeof manualBatchEnrichRequestSchema>;
export type ProcessRequest = z.infer<typeof processRequestSchema>;
export type ProcessCoreResponse = z.infer<typeof processCoreResponseSchema>;
export type ClassifyRequest = z.infer<typeof classifyRequestSchema>;
export type ClassifyResponse = z.infer<typeof classifyResponseSchema>;
export type EnrichmentOptionsInput = EnrichmentOptions;
