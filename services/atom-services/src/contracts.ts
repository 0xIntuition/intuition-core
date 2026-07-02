import {
	classificationClientHintsSchema,
	classificationInputIntentSchema,
	classificationModeSchema,
	classificationPluginIdSchema,
	classificationRequestSchema,
	classificationResultSchema,
	classificationSessionIdSchema,
	enhancementPolicyOverrideSchema,
} from '@0xintuition/atom-classification';
import { classifiedAtomInputSchema, enrichmentRunResultSchema } from '@0xintuition/atom-enrichment';
import { z } from 'zod/v4';

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

export const enrichRequestSchema = z
	.object({
		input: classifiedAtomInputSchema,
		enrichment: enrichmentOptionsSchema.default({ preset: 'default' }),
	})
	.strict();

export const processRequestSchema = z
	.object({
		rawInput: z.string().min(1).max(10_000),
		classification: z
			.object({
				mode: classificationModeSchema.optional(),
				inputIntent: classificationInputIntentSchema.optional(),
				classificationSessionId: classificationSessionIdSchema.optional(),
				pluginIds: z.array(classificationPluginIdSchema).max(32).optional(),
				policy: enhancementPolicyOverrideSchema.optional(),
				clientHints: classificationClientHintsSchema.optional(),
			})
			.strict()
			.optional(),
		enrichment: enrichmentOptionsSchema.default({ preset: 'default' }),
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

export const persistenceRequestSchema = z
	.object({
		enabled: z.boolean().default(false),
		strategy: z.enum(['none', 'enqueue', 'sync']).default('none'),
	})
	.strict();

export const persistenceResultSchema = z
	.object({
		status: z.enum(['not_requested', 'disabled', 'queued', 'saved', 'failed']),
		recordId: z.string().min(1).max(256).optional(),
	})
	.strict();

export const processEndpointRequestSchema = processRequestSchema
	.extend({
		persistence: persistenceRequestSchema.optional(),
	})
	.strict();

export const processResponseSchema = processCoreResponseSchema
	.extend({
		persistence: persistenceResultSchema,
	})
	.strict();

export const processBatchSubmitRequestSchema = z
	.object({
		jobs: z.array(processEndpointRequestSchema).min(1).max(200),
	})
	.strict();

export const processBatchSubmitResponseSchema = z
	.object({
		jobId: z.string().min(1).max(128),
		status: z.literal('accepted'),
		submittedAt: z.string().datetime(),
		total: z.number().int().min(1),
	})
	.strict();

export const processBatchItemResultSchema = z
	.object({
		index: z.number().int().min(0),
		status: z.enum(['success', 'partial', 'failed']),
		response: processResponseSchema.nullable(),
		error: z
			.object({
				code: z.string().min(1).max(128),
				message: z.string().min(1).max(1_000),
			})
			.strict()
			.optional(),
	})
	.strict();

export const processBatchStatusResponseSchema = z
	.object({
		jobId: z.string().min(1).max(128),
		status: z.enum(['queued', 'running', 'complete', 'partial', 'failed']),
		submittedAt: z.string().datetime(),
		startedAt: z.string().datetime().optional(),
		finishedAt: z.string().datetime().optional(),
		total: z.number().int().min(1),
		completed: z.number().int().min(0),
		results: z.array(processBatchItemResultSchema),
	})
	.strict();

export const healthResponseSchema = z
	.object({
		ok: z.literal(true),
		service: z.literal('atom-services'),
		status: z.literal('healthy'),
		timestamp: z.string().datetime(),
		uptimeMs: z.number().int().min(0),
	})
	.strict();

export const readyResponseSchema = z
	.object({
		ok: z.boolean(),
		service: z.literal('atom-services'),
		status: z.enum(['ready', 'degraded']),
		timestamp: z.string().datetime(),
		dependencies: z
			.object({
				presetRegistry: z.boolean(),
				persistence: z.boolean(),
				cacheProvider: z.enum(['memory', 'none', 'upstash']),
			})
			.strict(),
		presets: z.record(z.string(), z.array(z.string())),
		warnings: z.array(z.string()),
	})
	.strict();

export const classifyRequestSchema = classificationRequestSchema;
export const classifyResponseSchema = classificationResultSchema;
export const enrichResponseSchema = enrichmentRunResultSchema;

export type EnrichmentPreset = z.infer<typeof enrichmentPresetSchema>;
export type ClassifyRequest = z.infer<typeof classifyRequestSchema>;
export type ClassifyResponse = z.infer<typeof classifyResponseSchema>;
export type EnrichmentOptions = z.infer<typeof enrichmentOptionsSchema>;
export type EnrichRequest = z.infer<typeof enrichRequestSchema>;
export type ProcessRequest = z.infer<typeof processRequestSchema>;
export type ProcessCoreResponse = z.infer<typeof processCoreResponseSchema>;
export type ProcessEndpointRequest = z.infer<typeof processEndpointRequestSchema>;
export type ProcessResponse = z.infer<typeof processResponseSchema>;
export type ProcessBatchSubmitRequest = z.infer<typeof processBatchSubmitRequestSchema>;
export type ProcessBatchSubmitResponse = z.infer<typeof processBatchSubmitResponseSchema>;
export type ProcessBatchItemResult = z.infer<typeof processBatchItemResultSchema>;
export type ProcessBatchStatusResponse = z.infer<typeof processBatchStatusResponseSchema>;
export type PersistenceRequest = z.infer<typeof persistenceRequestSchema>;
export type PersistenceResult = z.infer<typeof persistenceResultSchema>;
