import type { EnrichmentIdentityCapability } from '@0xintuition/atom-enrichment';
import {
	createAtomServicesProcessingRuntime,
	type EnrichmentPresetName,
} from '@0xintuition/atom-runtime';

export { createEnrichmentPresetFactories as createPresetFactories } from '@0xintuition/atom-runtime';

/** Core's operator settings mapped to the published composition runtime. */
export type ProcessingRuntimeOptions = {
	defaultPreset: EnrichmentPresetName;
	cacheProvider: 'memory' | 'none' | 'upstash';
	memoryCacheMaxEntries: number;
	classificationMemoryCacheMaxEntries: number;
	classificationResolverCacheTtlMs: number;
	cacheHttpTimeoutMs: number;
	cacheEnvVarName?: string;
	env: Record<string, string | undefined>;
};

export function createCoreProcessingRuntime(options: ProcessingRuntimeOptions) {
	const runtime = createAtomServicesProcessingRuntime(options);
	return {
		...runtime,
		warnings: runtime.warnings.map((warning) =>
			warning.replace(
				'ATOM_SERVICES_CACHE_PROVIDER',
				options.cacheEnvVarName ?? 'ATOM_SERVICES_CACHE_PROVIDER'
			)
		),
	};
}

// These adapters preserve the worker-facing interface. Package code owns
// provider composition, caches, and engine reuse (including identity scoping).
export function createClassificationRuntime(options: ProcessingRuntimeOptions) {
	const runtime = createCoreProcessingRuntime(options);
	return {
		engine: runtime.classification.engine(),
		cacheProvider: runtime.cacheProvider,
		warnings: runtime.warnings,
	};
}

export function createEnrichmentRuntime(options: ProcessingRuntimeOptions) {
	const runtime = createCoreProcessingRuntime(options);
	return {
		createEngine: (
			preset: EnrichmentPresetName,
			engineOptions?: { identity?: EnrichmentIdentityCapability }
		) => runtime.enrichment.engine(preset, engineOptions?.identity),
		presetFactories: runtime.enrichment.presetFactories,
		presetSummary: runtime.enrichment.presetSummary,
		cacheProvider: runtime.cacheProvider,
		warnings: runtime.warnings,
	};
}
