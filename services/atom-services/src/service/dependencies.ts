import type { ServiceConfig } from '../config';
import type {
	ClassifyRequest,
	ClassifyResponse,
	EnrichRequest,
	ProcessCoreResponse,
	ProcessRequest,
} from '../contracts';
import { MetricsRegistry } from '../metrics';
import { createPersistenceController, type PersistenceController } from './persistence';
import { createProcessingRuntime } from './processing';

export type ServiceDependencies = {
	classify: (input: ClassifyRequest) => Promise<ClassifyResponse>;
	enrich: (input: EnrichRequest) => Promise<ProcessCoreResponse['enrichment']>;
	process: (input: ProcessRequest, requestId: string) => Promise<ProcessCoreResponse>;
	metrics: MetricsRegistry;
	persistence: PersistenceController;
	readiness: () => {
		ok: boolean;
		status: 'ready' | 'degraded';
		dependencies: {
			presetRegistry: boolean;
			persistence: boolean;
			cacheProvider: 'memory' | 'none' | 'upstash';
		};
		presets: Record<string, string[]>;
		warnings: string[];
	};
};

export function createServiceDependencies(config: ServiceConfig): ServiceDependencies {
	const metrics = new MetricsRegistry();
	const persistence = createPersistenceController({
		enabled: config.persistenceEnabled,
	});
	const processingRuntime = createProcessingRuntime({
		defaultPreset: config.defaultPreset,
		cacheProvider: config.cacheProvider,
		memoryCacheMaxEntries: config.memoryCacheMaxEntries,
		classificationMemoryCacheMaxEntries: config.classificationMemoryCacheMaxEntries,
		classificationResolverCacheTtlMs: config.classificationResolverCacheTtlMs,
		cacheHttpTimeoutMs: config.cacheHttpTimeoutMs,
		env: config.env,
	});

	return {
		classify: processingRuntime.classify,
		enrich: processingRuntime.enrich,
		process: processingRuntime.process,
		metrics,
		persistence,
		readiness: () => {
			const persistenceReady = persistence.isReady();
			const presetRegistryReady = Object.keys(processingRuntime.presetSummary).length > 0;
			const ok = presetRegistryReady && persistenceReady;

			return {
				ok,
				status: ok ? ('ready' as const) : ('degraded' as const),
				dependencies: {
					presetRegistry: presetRegistryReady,
					persistence: persistenceReady,
					cacheProvider: processingRuntime.cacheProvider,
				},
				presets: processingRuntime.presetSummary,
				warnings: processingRuntime.warnings,
			};
		},
	};
}
