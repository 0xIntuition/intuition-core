import { enrichmentPresetSchema } from '@0xintuition/atom-services/contracts';
import { z } from 'zod/v4';

const workerConfigSchema = z
	.object({
		NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
		WORKERS_PORT: z.coerce.number().int().min(1).max(65_535).default(4110),
		WORKERS_PARSE_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
		WORKERS_CLASSIFICATION_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
		WORKERS_ENRICHMENT_HEALTH_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
		WORKERS_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(4),
		WORKERS_LEASE_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(60_000),
		WORKERS_RECONCILE_INTERVAL_MS: z.coerce
			.number()
			.int()
			.min(1_000)
			.max(3_600_000)
			.default(10_000),
		WORKERS_LIVE_RECONNECT_MS: z.coerce.number().int().min(1_000).max(60_000).default(5_000),
		WORKERS_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(300_000).default(30_000),
		WORKERS_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(100).default(5),
		WORKERS_RETRY_BASE_MS: z.coerce.number().int().min(100).max(60_000).default(2_000),
		WORKERS_RETRY_MAX_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(300_000),
		WORKERS_WATCHDOG_INTERVAL_MS: z.coerce.number().int().min(1_000).max(300_000).default(10_000),
		WORKERS_WATCHDOG_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(3_600_000).default(120_000),
		WORKERS_CIRCUIT_FAILURE_THRESHOLD: z.coerce.number().int().min(1).max(100).default(5),
		WORKERS_CIRCUIT_RESET_MS: z.coerce.number().int().min(1_000).max(3_600_000).default(60_000),
		WORKERS_PARSE_VERSION: z.string().min(1).max(64).default('v1'),
		WORKERS_ENRICHMENT_VERSION: z.string().min(1).max(64).default('v1'),
		WORKERS_DEFAULT_PRESET: enrichmentPresetSchema.default('default'),
		WORKERS_CACHE_PROVIDER: z.enum(['memory', 'none', 'upstash']).default('memory'),
		WORKERS_MEMORY_CACHE_MAX_ENTRIES: z.coerce.number().int().min(10).default(500),
		WORKERS_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES: z.coerce.number().int().min(10).optional(),
		WORKERS_CLASSIFICATION_RESOLVER_CACHE_TTL_MS: z.coerce
			.number()
			.int()
			.min(1_000)
			.max(86_400_000)
			.default(300_000),
		WORKERS_CACHE_HTTP_TIMEOUT_MS: z.coerce.number().int().min(250).max(10_000).default(1_500),
		WORKERS_PARSE_REMOTE_FETCH: z
			.enum(['true', 'false'])
			.default('true')
			.transform((value) => value === 'true'),
		WORKERS_PARSE_ALLOW_HTTP: z
			.enum(['true', 'false'])
			.default('false')
			.transform((value) => value === 'true'),
		WORKERS_PARSE_ALLOW_PRIVATE_NETWORKS: z
			.enum(['true', 'false'])
			.default('false')
			.transform((value) => value === 'true'),
		WORKERS_PARSE_MAX_REDIRECTS: z.coerce.number().int().min(0).max(10).default(3),
		WORKERS_PARSE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(3_000),
		WORKERS_PARSE_REQUEST_TIMEOUT_MS: z.coerce.number().int().min(100).max(60_000).default(5_000),
		WORKERS_PARSE_IPFS_REQUEST_TIMEOUT_MS: z.coerce
			.number()
			.int()
			.min(100)
			.max(120_000)
			.default(8_000),
		WORKERS_PARSE_MAX_RESPONSE_BYTES: z.coerce
			.number()
			.int()
			.min(1_024)
			.max(10_485_760)
			.default(1_048_576),
		WORKERS_PARSE_INSPECT_BYTES: z.coerce.number().int().min(256).max(1_048_576).default(262_144),
		WORKERS_PARSE_IPFS_GATEWAY_BASE_URL: z.string().trim().url().optional(),
	})
	.passthrough();

export type WorkerConfig = {
	nodeEnv: 'development' | 'test' | 'production';
	workerId: string;
	healthPort: number;
	parseHealthPort: number;
	classificationHealthPort: number;
	enrichmentHealthPort: number;
	concurrency: number;
	leaseMs: number;
	reconcileIntervalMs: number;
	liveReconnectMs: number;
	shutdownTimeoutMs: number;
	maxAttempts: number;
	retryBaseMs: number;
	retryMaxMs: number;
	watchdogIntervalMs: number;
	watchdogTimeoutMs: number;
	circuitFailureThreshold: number;
	circuitResetMs: number;
	parseVersion: string;
	enrichmentVersion: string;
	defaultPreset: z.infer<typeof enrichmentPresetSchema>;
	cacheProvider: 'memory' | 'none' | 'upstash';
	memoryCacheMaxEntries: number;
	classificationMemoryCacheMaxEntries: number;
	classificationResolverCacheTtlMs: number;
	cacheHttpTimeoutMs: number;
	parseOptions: {
		remoteFetch: boolean;
		allowHttp: boolean;
		allowPrivateNetworks: boolean;
		maxRedirects: number;
		connectTimeoutMs: number;
		requestTimeoutMs: number;
		ipfsRequestTimeoutMs: number;
		maxResponseBytes: number;
		inspectBytes: number;
		ipfsGatewayBaseUrl?: string;
	};
	env: Record<string, string | undefined>;
};

export function loadWorkerConfig(
	source: Record<string, string | undefined> = process.env
): WorkerConfig {
	const parsed = workerConfigSchema.parse(source);

	return {
		nodeEnv: parsed.NODE_ENV,
		workerId:
			source.WORKERS_ID?.trim() ||
			`${process.pid}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
		healthPort: parsed.WORKERS_PORT,
		parseHealthPort: parsed.WORKERS_PARSE_HEALTH_PORT ?? parsed.WORKERS_PORT,
		classificationHealthPort: parsed.WORKERS_CLASSIFICATION_HEALTH_PORT ?? parsed.WORKERS_PORT + 2,
		enrichmentHealthPort: parsed.WORKERS_ENRICHMENT_HEALTH_PORT ?? parsed.WORKERS_PORT + 1,
		concurrency: parsed.WORKERS_CONCURRENCY,
		leaseMs: parsed.WORKERS_LEASE_MS,
		reconcileIntervalMs: parsed.WORKERS_RECONCILE_INTERVAL_MS,
		liveReconnectMs: parsed.WORKERS_LIVE_RECONNECT_MS,
		shutdownTimeoutMs: parsed.WORKERS_SHUTDOWN_TIMEOUT_MS,
		maxAttempts: parsed.WORKERS_MAX_ATTEMPTS,
		retryBaseMs: parsed.WORKERS_RETRY_BASE_MS,
		retryMaxMs: parsed.WORKERS_RETRY_MAX_MS,
		watchdogIntervalMs: parsed.WORKERS_WATCHDOG_INTERVAL_MS,
		watchdogTimeoutMs: parsed.WORKERS_WATCHDOG_TIMEOUT_MS,
		circuitFailureThreshold: parsed.WORKERS_CIRCUIT_FAILURE_THRESHOLD,
		circuitResetMs: parsed.WORKERS_CIRCUIT_RESET_MS,
		parseVersion: parsed.WORKERS_PARSE_VERSION,
		enrichmentVersion: parsed.WORKERS_ENRICHMENT_VERSION,
		defaultPreset: parsed.WORKERS_DEFAULT_PRESET,
		cacheProvider: parsed.WORKERS_CACHE_PROVIDER,
		memoryCacheMaxEntries: parsed.WORKERS_MEMORY_CACHE_MAX_ENTRIES,
		classificationMemoryCacheMaxEntries:
			parsed.WORKERS_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES ??
			parsed.WORKERS_MEMORY_CACHE_MAX_ENTRIES,
		classificationResolverCacheTtlMs: parsed.WORKERS_CLASSIFICATION_RESOLVER_CACHE_TTL_MS,
		cacheHttpTimeoutMs: parsed.WORKERS_CACHE_HTTP_TIMEOUT_MS,
		parseOptions: {
			remoteFetch: parsed.WORKERS_PARSE_REMOTE_FETCH,
			allowHttp: parsed.WORKERS_PARSE_ALLOW_HTTP,
			allowPrivateNetworks: parsed.WORKERS_PARSE_ALLOW_PRIVATE_NETWORKS,
			maxRedirects: parsed.WORKERS_PARSE_MAX_REDIRECTS,
			connectTimeoutMs: parsed.WORKERS_PARSE_CONNECT_TIMEOUT_MS,
			requestTimeoutMs: parsed.WORKERS_PARSE_REQUEST_TIMEOUT_MS,
			ipfsRequestTimeoutMs: parsed.WORKERS_PARSE_IPFS_REQUEST_TIMEOUT_MS,
			maxResponseBytes: parsed.WORKERS_PARSE_MAX_RESPONSE_BYTES,
			inspectBytes: parsed.WORKERS_PARSE_INSPECT_BYTES,
			ipfsGatewayBaseUrl: parsed.WORKERS_PARSE_IPFS_GATEWAY_BASE_URL,
		},
		env: source,
	};
}
