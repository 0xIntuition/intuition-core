import { z } from 'zod/v4';
import { enrichmentPresetSchema } from './contracts';

const serviceConfigSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		ATOM_SERVICES_PORT: z.coerce.number().int().min(1).max(65_535).default(4010),
		ATOM_SERVICES_AUTH_TOKEN: z.string().optional(),
		ATOM_SERVICES_RATE_LIMIT_MAX_REQUESTS: z.coerce.number().int().min(1).default(120),
		ATOM_SERVICES_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1_000).default(60_000),
		ATOM_SERVICES_DEFAULT_PRESET: enrichmentPresetSchema.default('default'),
		ATOM_SERVICES_PERSISTENCE_ENABLED: z
			.enum(['true', 'false'])
			.default('false')
			.transform((value) => value === 'true'),
		ATOM_SERVICES_BATCH_MAX_ITEMS: z.coerce.number().int().min(1).max(200).default(25),
		ATOM_SERVICES_BATCH_RETAIN_COMPLETED_MS: z.coerce
			.number()
			.int()
			.min(60_000)
			.max(86_400_000)
			.default(3_600_000),
		ATOM_SERVICES_CACHE_PROVIDER: z.enum(['memory', 'none', 'upstash']).default('memory'),
		ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES: z.coerce.number().int().min(10).default(500),
		ATOM_SERVICES_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES: z.coerce
			.number()
			.int()
			.min(10)
			.optional(),
		ATOM_SERVICES_CLASSIFICATION_RESOLVER_CACHE_TTL_MS: z.coerce
			.number()
			.int()
			.min(1_000)
			.max(86_400_000)
			.default(300_000),
		ATOM_SERVICES_CACHE_HTTP_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.min(250)
			.max(10_000)
			.default(1_500),
	})
	.passthrough();

export type ServiceConfig = {
	nodeEnv: 'development' | 'test' | 'production';
	port: number;
	authToken?: string;
	rateLimitMaxRequests: number;
	rateLimitWindowMs: number;
	defaultPreset: z.infer<typeof enrichmentPresetSchema>;
	persistenceEnabled: boolean;
	batchMaxItems: number;
	batchRetainCompletedMs: number;
	cacheProvider: 'memory' | 'none' | 'upstash';
	memoryCacheMaxEntries: number;
	classificationMemoryCacheMaxEntries: number;
	classificationResolverCacheTtlMs: number;
	cacheHttpTimeoutMs: number;
	env: Record<string, string | undefined>;
};

export function loadServiceConfig(
	source: Record<string, string | undefined> = process.env
): ServiceConfig {
	const parsed = serviceConfigSchema.parse(normalizeServiceConfigEnv(source));
	const authToken = parsed.ATOM_SERVICES_AUTH_TOKEN?.trim();

	return {
		nodeEnv: parsed.NODE_ENV,
		port: parsed.ATOM_SERVICES_PORT,
		authToken: authToken && authToken.length > 0 ? authToken : undefined,
		rateLimitMaxRequests: parsed.ATOM_SERVICES_RATE_LIMIT_MAX_REQUESTS,
		rateLimitWindowMs: parsed.ATOM_SERVICES_RATE_LIMIT_WINDOW_MS,
		defaultPreset: parsed.ATOM_SERVICES_DEFAULT_PRESET,
		persistenceEnabled: parsed.ATOM_SERVICES_PERSISTENCE_ENABLED,
		batchMaxItems: parsed.ATOM_SERVICES_BATCH_MAX_ITEMS,
		batchRetainCompletedMs: parsed.ATOM_SERVICES_BATCH_RETAIN_COMPLETED_MS,
		cacheProvider: parsed.ATOM_SERVICES_CACHE_PROVIDER,
		memoryCacheMaxEntries: parsed.ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES,
		classificationMemoryCacheMaxEntries:
			parsed.ATOM_SERVICES_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES ??
			parsed.ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES,
		classificationResolverCacheTtlMs: parsed.ATOM_SERVICES_CLASSIFICATION_RESOLVER_CACHE_TTL_MS,
		cacheHttpTimeoutMs: parsed.ATOM_SERVICES_CACHE_HTTP_TIMEOUT_MS,
		env: source,
	};
}

function normalizeServiceConfigEnv(source: Record<string, string | undefined>): {
	NODE_ENV: string | undefined;
	ATOM_SERVICES_PORT: string | undefined;
	ATOM_SERVICES_AUTH_TOKEN: string | undefined;
	ATOM_SERVICES_RATE_LIMIT_MAX_REQUESTS: string | undefined;
	ATOM_SERVICES_RATE_LIMIT_WINDOW_MS: string | undefined;
	ATOM_SERVICES_DEFAULT_PRESET: string | undefined;
	ATOM_SERVICES_PERSISTENCE_ENABLED: string | undefined;
	ATOM_SERVICES_BATCH_MAX_ITEMS: string | undefined;
	ATOM_SERVICES_BATCH_RETAIN_COMPLETED_MS: string | undefined;
	ATOM_SERVICES_CACHE_PROVIDER: string | undefined;
	ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES: string | undefined;
	ATOM_SERVICES_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES: string | undefined;
	ATOM_SERVICES_CLASSIFICATION_RESOLVER_CACHE_TTL_MS: string | undefined;
	ATOM_SERVICES_CACHE_HTTP_TIMEOUT_MS: string | undefined;
} {
	return {
		NODE_ENV: source.NODE_ENV,
		ATOM_SERVICES_PORT: resolveEnvValue(source, ['ATOM_SERVICES_PORT', 'ENRICHMENT_SERVICE_PORT']),
		ATOM_SERVICES_AUTH_TOKEN: resolveEnvValue(source, [
			'ATOM_SERVICES_AUTH_TOKEN',
			'ENRICHMENT_SERVICE_AUTH_TOKEN',
		]),
		ATOM_SERVICES_RATE_LIMIT_MAX_REQUESTS: resolveEnvValue(source, [
			'ATOM_SERVICES_RATE_LIMIT_MAX_REQUESTS',
			'ENRICHMENT_SERVICE_RATE_LIMIT_MAX_REQUESTS',
		]),
		ATOM_SERVICES_RATE_LIMIT_WINDOW_MS: resolveEnvValue(source, [
			'ATOM_SERVICES_RATE_LIMIT_WINDOW_MS',
			'ENRICHMENT_SERVICE_RATE_LIMIT_WINDOW_MS',
		]),
		ATOM_SERVICES_DEFAULT_PRESET: resolveEnvValue(source, [
			'ATOM_SERVICES_DEFAULT_PRESET',
			'ENRICHMENT_DEFAULT_PRESET',
		]),
		ATOM_SERVICES_PERSISTENCE_ENABLED: resolveEnvValue(source, [
			'ATOM_SERVICES_PERSISTENCE_ENABLED',
			'ENRICHMENT_PERSISTENCE_ENABLED',
		]),
		ATOM_SERVICES_BATCH_MAX_ITEMS: resolveEnvValue(source, [
			'ATOM_SERVICES_BATCH_MAX_ITEMS',
			'ENRICHMENT_BATCH_MAX_ITEMS',
		]),
		ATOM_SERVICES_BATCH_RETAIN_COMPLETED_MS: resolveEnvValue(source, [
			'ATOM_SERVICES_BATCH_RETAIN_COMPLETED_MS',
			'ENRICHMENT_BATCH_RETAIN_COMPLETED_MS',
		]),
		ATOM_SERVICES_CACHE_PROVIDER: resolveEnvValue(source, [
			'ATOM_SERVICES_CACHE_PROVIDER',
			'ENRICHMENT_CACHE_PROVIDER',
		]),
		ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES: resolveEnvValue(source, [
			'ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES',
			'ENRICHMENT_MEMORY_CACHE_MAX_ENTRIES',
		]),
		ATOM_SERVICES_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES: resolveEnvValue(source, [
			'ATOM_SERVICES_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES',
			'ENRICHMENT_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES',
			'ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES',
			'ENRICHMENT_MEMORY_CACHE_MAX_ENTRIES',
		]),
		ATOM_SERVICES_CLASSIFICATION_RESOLVER_CACHE_TTL_MS: resolveEnvValue(source, [
			'ATOM_SERVICES_CLASSIFICATION_RESOLVER_CACHE_TTL_MS',
			'ENRICHMENT_CLASSIFICATION_RESOLVER_CACHE_TTL_MS',
		]),
		ATOM_SERVICES_CACHE_HTTP_TIMEOUT_MS: resolveEnvValue(source, [
			'ATOM_SERVICES_CACHE_HTTP_TIMEOUT_MS',
			'ENRICHMENT_CACHE_HTTP_TIMEOUT_MS',
		]),
	};
}

function resolveEnvValue(
	source: Record<string, string | undefined>,
	keys: readonly string[]
): string | undefined {
	for (const key of keys) {
		const value = source[key];
		if (value !== undefined) {
			return value;
		}
	}

	return undefined;
}
