import {
	type ClassificationResult,
	getDefaultEnhancementPolicy,
} from '@0xintuition/atom-classification';
import {
	type ClassifiedAtomInput,
	type EnrichmentRunResult,
	toClassifiedAtomInput,
} from '@0xintuition/atom-enrichment';
import type { z } from 'zod/v4';
import type {
	EnrichmentOptions,
	EnrichmentPreset,
	EnrichRequest,
	ProcessCoreResponse,
	ProcessRequest,
	processObservabilitySchema,
} from '../contracts';
import {
	createClassificationRuntime,
	createEnrichmentRuntime,
	type ProcessingRuntimeOptions,
} from './runtime';

type ProcessObservability = z.infer<typeof processObservabilitySchema>;

type ProcessingRuntime = {
	classify: (input: {
		input: string;
		mode?: 'client-only' | 'progressive' | 'server-only';
		inputIntent?: 'generic' | 'url-first';
		classificationSessionId?: string;
		pluginIds?: string[];
		policy?: Record<string, unknown>;
		clientHints?: Record<string, unknown>;
	}) => Promise<ClassificationResult>;
	enrich: (input: EnrichRequest) => Promise<EnrichmentRunResult>;
	process: (input: ProcessRequest, requestId: string) => Promise<ProcessCoreResponse>;
	presetSummary: Record<EnrichmentPreset, string[]>;
	cacheProvider: 'memory' | 'none' | 'upstash';
	warnings: string[];
};

export function createProcessingRuntime(options: ProcessingRuntimeOptions): ProcessingRuntime {
	const { engine: classificationEngine } = createClassificationRuntime(options);
	const { createEngine, presetSummary, cacheProvider, warnings } = createEnrichmentRuntime(options);

	if (warnings.length > 0) {
		console.warn('[atom-services] startup warnings', {
			warnings,
		});
	}
	console.info('[atom-services] plugin presets initialized', {
		defaultPreset: options.defaultPreset,
		cacheProvider,
		presets: presetSummary,
	});

	async function runEnrichment(input: ClassifiedAtomInput, enrichment: EnrichmentOptions) {
		const resolvedPreset = resolvePreset(options.defaultPreset, enrichment.preset);
		const engine = createEngine(resolvedPreset);

		return await engine.enrich({
			input,
			runtime: 'server',
			plugins: enrichment.plugins,
			artifactClasses: enrichment.artifactClasses,
			concurrency: enrichment.concurrency,
			timeoutMs: enrichment.timeoutMs,
			traceId: enrichment.traceId,
		});
	}

	return {
		async classify(input) {
			return await classificationEngine.classify({
				input: input.input,
				mode: input.mode ?? 'progressive',
				inputIntent: input.inputIntent ?? 'generic',
				classificationSessionId: input.classificationSessionId,
				pluginIds: input.pluginIds,
				policy: input.policy,
				clientHints: input.clientHints,
			});
		},
		async enrich(input) {
			return await runEnrichment(input.input, input.enrichment);
		},
		async process(input, requestId) {
			const startedAt = Date.now();
			const classifyStartedAt = Date.now();
			const classificationSessionId =
				input.classification?.classificationSessionId ?? `${requestId}-${Date.now().toString(36)}`;
			const classificationMode = input.classification?.mode ?? 'progressive';

			const classification = await classificationEngine.classify({
				input: input.rawInput,
				mode: classificationMode,
				inputIntent: input.classification?.inputIntent ?? 'generic',
				classificationSessionId,
				pluginIds: input.classification?.pluginIds,
				policy: input.classification?.policy ?? getDefaultEnhancementPolicy(classificationMode),
				clientHints: input.classification?.clientHints,
			});
			const classifyMs = Date.now() - classifyStartedAt;

			const classifiedInput = toClassifiedAtomInput(input.rawInput, classification);
			if (!classifiedInput) {
				const totalMs = Date.now() - startedAt;
				return {
					runId: classificationSessionId,
					status:
						classification.status === 'complete' ? ('success' as const) : ('partial' as const),
					mode: 'process' as const,
					classification,
					enrichment: null,
					timings: {
						totalMs,
						classifyMs,
					},
					observability: buildProcessObservability({
						totalMs,
						classifyMs,
					}),
					traceId: input.traceId,
				};
			}

			const enrichStartedAt = Date.now();
			const enrichment = await runEnrichment(classifiedInput, {
				...input.enrichment,
				traceId: input.enrichment.traceId ?? input.traceId,
			});
			const enrichMs = Date.now() - enrichStartedAt;
			const totalMs = Date.now() - startedAt;

			return {
				runId: classificationSessionId,
				status: resolveProcessStatus(classification, enrichment),
				mode: 'process' as const,
				classification,
				enrichment,
				timings: {
					totalMs,
					classifyMs,
					enrichMs,
				},
				observability: buildProcessObservability(
					{
						totalMs,
						classifyMs,
						enrichMs,
					},
					enrichment
				),
				traceId: input.traceId ?? enrichment.traceId,
			};
		},
		presetSummary,
		cacheProvider,
		warnings,
	};
}

function resolvePreset(
	defaultPreset: EnrichmentPreset,
	requestedPreset: EnrichmentPreset
): EnrichmentPreset {
	if (requestedPreset === 'default' || requestedPreset === 'custom') {
		return defaultPreset;
	}

	return requestedPreset;
}

function resolveProcessStatus(
	classificationResult: ClassificationResult,
	enrichmentResult: EnrichmentRunResult
): 'success' | 'partial' | 'failed' {
	if (enrichmentResult.status === 'failed') {
		return 'partial';
	}

	if (classificationResult.status !== 'complete') {
		return 'partial';
	}

	if (enrichmentResult.status === 'partial') {
		return 'partial';
	}

	return 'success';
}

function buildProcessObservability(
	timings: {
		totalMs: number;
		classifyMs: number;
		enrichMs?: number;
	},
	enrichmentResult?: EnrichmentRunResult
): ProcessObservability {
	if (!enrichmentResult) {
		return {
			phases: timings,
			plugins: null,
		};
	}

	return {
		phases: timings,
		plugins: {
			executed: Object.keys(enrichmentResult.timings.perPluginMs).length,
			failed: enrichmentResult.errors.length,
			skipped: enrichmentResult.skipped.length,
			artifacts: enrichmentResult.artifacts.length,
			perPluginMs: enrichmentResult.timings.perPluginMs,
		},
	};
}
