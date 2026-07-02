import { z } from 'zod/v4';

const slugPattern = /^[a-z][a-z0-9-]{0,38}[a-z0-9]$/;

export const atomTypeSchema = z.enum([
	'person',
	'place',
	'thing',
	'company',
	'product',
	'podcast',
	'song',
	'software',
	'unknown',
]);

export const enrichmentRuntimeSchema = z.enum(['client', 'server']);

export const pluginRuntimeSchema = z.enum(['client', 'server', 'universal']);

export const rawInputKindSchema = z.enum(['url', 'plain-text']);

export const githubTargetSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('repo'),
			owner: z.string().min(1).max(256),
			repo: z.string().min(1).max(256),
		})
		.strict(),
	z
		.object({
			kind: z.literal('user'),
			login: z.string().min(1).max(256),
		})
		.strict(),
]);

export const amazonTargetSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('product'),
			asin: z.string().length(10),
			canonicalUrl: z.string().url(),
			marketplace: z.string().min(2).max(8).optional(),
		})
		.strict(),
	z
		.object({
			kind: z.literal('storefront'),
			canonicalUrl: z.string().url(),
		})
		.strict(),
]);

export const xTargetSchema = z.discriminatedUnion('kind', [
	z
		.object({
			kind: z.literal('profile'),
			handle: z.string().min(1).max(256),
			canonicalUrl: z.string().url(),
		})
		.strict(),
	z
		.object({
			kind: z.literal('post'),
			handle: z.string().min(1).max(256).optional(),
			postId: z.string().min(1).max(256),
			canonicalUrl: z.string().url(),
		})
		.strict(),
]);

export const classifiedAtomTargetsSchema = z
	.object({
		github: githubTargetSchema.optional(),
		amazon: amazonTargetSchema.optional(),
		x: xTargetSchema.optional(),
	})
	.strict();

export const classifiedAtomPolicySchema = z
	.object({
		rawInputKind: rawInputKindSchema,
		allowUrlOnlyProviders: z.boolean(),
	})
	.strict();

export const classificationSlugLikeSchema = z
	.string()
	.min(2)
	.max(40)
	.regex(
		slugPattern,
		'Classification slug must be lowercase alphanumeric with hyphens (2-40 chars).'
	);

export const classifiedAtomInputSchema = z
	.object({
		atomType: atomTypeSchema,
		jsonLd: z.record(z.string(), z.unknown()),
		source: z
			.object({
				classificationEngine: z.string().min(1).max(128),
				classifiedAt: z.iso.datetime(),
			})
			.strict(),
		hints: z
			.object({
				name: z.string().min(1).max(512).optional(),
				description: z.string().min(1).max(2_000).optional(),
				url: z.string().url().optional(),
				identifiers: z.record(z.string(), z.string()).optional(),
				locale: z.string().min(2).max(20).optional(),
			})
			.strict()
			.optional(),
		targets: classifiedAtomTargetsSchema.optional(),
		policy: classifiedAtomPolicySchema.optional(),
	})
	.strict();

export const enrichmentRequestSchema = z
	.object({
		input: classifiedAtomInputSchema,
		runtime: enrichmentRuntimeSchema,
		plugins: z.array(classificationSlugLikeSchema).max(128).optional(),
		artifactTypes: z.array(classificationSlugLikeSchema).max(128).optional(),
		artifactClasses: z.array(classificationSlugLikeSchema).max(128).optional(),
		concurrency: z.number().int().min(1).max(64).optional(),
		timeoutMs: z.number().int().min(1).max(120_000).optional(),
		traceId: z.string().min(1).max(128).optional(),
	})
	.strict();

export const enrichmentArtifactMetaSchema = z
	.object({
		pluginId: classificationSlugLikeSchema,
		provider: z.string().min(1).max(128),
		fetchedAt: z.iso.datetime(),
		confidence: z.number().min(0).max(1).optional(),
		sourceUrl: z.string().url().optional(),
		fromCache: z.boolean().optional(),
		cachedAt: z.iso.datetime().optional(),
	})
	.strict();

export const enrichmentArtifactSchema = z
	.object({
		artifact_type: classificationSlugLikeSchema,
		data: z.record(z.string(), z.unknown()),
		meta: enrichmentArtifactMetaSchema,
	})
	.strict();

export const pluginExecutionErrorCodeSchema = z.enum([
	'not_applicable',
	'runtime_mismatch',
	'timeout',
	'rate_limited',
	'auth_failed',
	'upstream_error',
	'validation_error',
	'internal_error',
]);

export const pluginExecutionErrorSchema = z
	.object({
		pluginId: classificationSlugLikeSchema,
		code: pluginExecutionErrorCodeSchema,
		message: z.string().min(1).max(2_000),
		retriable: z.boolean(),
	})
	.strict();

export const enrichmentSkippedPluginSchema = z
	.object({
		pluginId: classificationSlugLikeSchema,
		reason: z.string().min(1).max(256),
	})
	.strict();

export const enrichmentRunResultSchema = z
	.object({
		status: z.enum(['success', 'partial', 'failed']),
		artifacts: z.array(enrichmentArtifactSchema),
		errors: z.array(pluginExecutionErrorSchema),
		skipped: z.array(enrichmentSkippedPluginSchema),
		timings: z
			.object({
				startedAt: z.iso.datetime(),
				finishedAt: z.iso.datetime(),
				durationMs: z.number().int().min(0),
				perPluginMs: z.record(z.string(), z.number().int().min(0)),
				cacheHits: z.number().int().min(0).default(0),
				cacheMisses: z.number().int().min(0).default(0),
			})
			.strict(),
		traceId: z.string().min(1).max(128).optional(),
	})
	.strict();

export type AtomType = z.infer<typeof atomTypeSchema>;
export type EnrichmentRuntime = z.infer<typeof enrichmentRuntimeSchema>;
export type PluginRuntime = z.infer<typeof pluginRuntimeSchema>;
export type RawInputKind = z.infer<typeof rawInputKindSchema>;
export type GitHubTarget = z.infer<typeof githubTargetSchema>;
export type AmazonTarget = z.infer<typeof amazonTargetSchema>;
export type XTarget = z.infer<typeof xTargetSchema>;
export type ClassifiedAtomTargets = z.infer<typeof classifiedAtomTargetsSchema>;
export type ClassifiedAtomPolicy = z.infer<typeof classifiedAtomPolicySchema>;
export type ClassifiedAtomInput = z.infer<typeof classifiedAtomInputSchema>;
export type EnrichmentRequest = z.infer<typeof enrichmentRequestSchema>;
export type EnrichmentArtifactMeta = z.infer<typeof enrichmentArtifactMetaSchema>;
export type EnrichmentArtifact = z.infer<typeof enrichmentArtifactSchema>;
export type PluginExecutionErrorCode = z.infer<typeof pluginExecutionErrorCodeSchema>;
export type PluginExecutionError = z.infer<typeof pluginExecutionErrorSchema>;
export type EnrichmentSkippedPlugin = z.infer<typeof enrichmentSkippedPluginSchema>;
export type EnrichmentRunResult = z.infer<typeof enrichmentRunResultSchema>;
