import { buildCacheKey, type CacheAdapter, type CachedEntry, isCachedEntryFresh } from './cache';
import {
	type ClassificationRegistry,
	createDefaultClassificationRegistry,
} from './classifications';
import {
	createEnrichmentPluginRegistry,
	type RegisterPluginOptions,
	type ResolvePluginsResult,
} from './plugin-registry';
import type { EnrichmentPlugin, EnrichmentPluginContext, EnrichmentPluginLogger } from './plugins';
import { canonicalizeEnrichmentSlugs } from './slug-aliases';
import {
	type EnrichmentArtifact,
	type EnrichmentRequest,
	type EnrichmentRunResult,
	enrichmentRequestSchema,
	type PluginExecutionError,
	type PluginExecutionErrorCode,
} from './types';

const DEFAULT_CONCURRENCY = 5;
const DEFAULT_TIMEOUT_MS = 10_000;

type EnrichExecutionOptions = {
	signal?: AbortSignal;
};

export type EnrichmentEngineConfig = {
	plugins?: EnrichmentPlugin[];
	concurrency?: number;
	timeoutMs?: number;
	classifications?: ClassificationRegistry;
	logger?: EnrichmentPluginLogger;
	now?: () => string;
	secrets?: Record<string, string>;
	cache?: CacheAdapter;
};

export type EnrichmentEngine = {
	registerPlugin(plugin: EnrichmentPlugin, options?: RegisterPluginOptions): void;
	unregisterPlugin(pluginId: string): boolean;
	listPlugins(): EnrichmentPlugin[];
	resolvePlugins(request: EnrichmentRequest): ResolvePluginsResult;
	enrich(
		request: EnrichmentRequest,
		options?: EnrichExecutionOptions
	): Promise<EnrichmentRunResult>;
};

export function createEnrichmentEngine(config: EnrichmentEngineConfig = {}): EnrichmentEngine {
	const now = config.now ?? (() => new Date().toISOString());
	const pluginRegistry = createEnrichmentPluginRegistry(config.plugins ?? []);
	const classificationRegistry = config.classifications ?? createDefaultClassificationRegistry();

	return {
		registerPlugin(plugin, options) {
			pluginRegistry.register(plugin, options);
		},

		unregisterPlugin(pluginId) {
			return pluginRegistry.unregister(pluginId);
		},

		listPlugins() {
			return pluginRegistry.list();
		},

		resolvePlugins(request) {
			return pluginRegistry.resolve(request);
		},

		async enrich(request, options) {
			const parsedRequest = enrichmentRequestSchema.parse(request);
			const startedAt = now();
			const startedAtMs = Date.now();
			const perPluginMs: Record<string, number> = {};
			const errors: PluginExecutionError[] = [];
			const artifactsByPlugin = new Map<string, EnrichmentArtifact[]>();
			let cacheHits = 0;
			let cacheMisses = 0;

			const resolved = pluginRegistry.resolve(parsedRequest);
			const skipped = [...resolved.skipped];
			const applicablePlugins: EnrichmentPlugin[] = [];

			for (const plugin of resolved.plugins) {
				try {
					const supports = await Promise.resolve(plugin.supports(parsedRequest));

					if (!supports) {
						skipped.push({
							pluginId: plugin.id,
							reason: 'not_applicable',
						});
						continue;
					}

					applicablePlugins.push(plugin);
				} catch (error) {
					errors.push(
						createPluginError(
							plugin.id,
							'internal_error',
							`supports() failed: ${getErrorMessage(error)}`,
							false
						)
					);
				}
			}

			const concurrency = Math.max(
				1,
				parsedRequest.concurrency ?? config.concurrency ?? DEFAULT_CONCURRENCY
			);
			const timeoutMs = Math.max(
				1,
				parsedRequest.timeoutMs ?? config.timeoutMs ?? DEFAULT_TIMEOUT_MS
			);

			for (const chunk of chunkBy(applicablePlugins, concurrency)) {
				const settledChunk = await Promise.allSettled(
					chunk.map((plugin) =>
						executePluginWithCache({
							plugin,
							request: parsedRequest,
							timeoutMs,
							logger: config.logger,
							now,
							secrets: config.secrets,
							parentSignal: options?.signal,
							cache: config.cache,
						})
					)
				);

				for (const [index, settled] of settledChunk.entries()) {
					const plugin = chunk[index];
					if (!plugin) {
						continue;
					}

					if (settled.status === 'rejected') {
						errors.push(
							createPluginError(
								plugin.id,
								'internal_error',
								`Unexpected execution failure: ${getErrorMessage(settled.reason)}`,
								false
							)
						);
						continue;
					}

					if (settled.value.cacheHit) {
						cacheHits += 1;
					}
					if (settled.value.cacheMiss) {
						cacheMisses += 1;
					}

					perPluginMs[plugin.id] = settled.value.durationMs;

					if (settled.value.error) {
						errors.push(settled.value.error);
						continue;
					}

					const normalizedArtifacts = normalizeArtifacts({
						plugin,
						artifacts: settled.value.artifacts,
						classificationRegistry,
						now,
						errors,
					});

					if (
						!settled.value.fromCache &&
						config.cache &&
						settled.value.cacheKey &&
						typeof settled.value.TTL === 'number' &&
						settled.value.TTL > 0
					) {
						const ttlMs = toTtlMs(settled.value.TTL);
						if (ttlMs) {
							const cacheEntry: CachedEntry = {
								artifacts: normalizedArtifacts,
								cachedAt: now(),
								ttlMs,
							};
							try {
								await config.cache.set(settled.value.cacheKey, cacheEntry, ttlMs);
							} catch (error) {
								config.logger?.warn('Cache set failed for enrichment plugin.', {
									pluginId: plugin.id,
									error: getErrorMessage(error),
								});
							}
						}
					}

					artifactsByPlugin.set(plugin.id, normalizedArtifacts);
				}
			}

			const artifacts: EnrichmentArtifact[] = [];
			for (const plugin of applicablePlugins) {
				const pluginArtifacts = artifactsByPlugin.get(plugin.id) ?? [];
				for (const artifact of filterArtifactsForRequest(pluginArtifacts, parsedRequest)) {
					artifacts.push(artifact);
				}
			}

			const finishedAt = now();
			const durationMs = Math.max(0, Date.now() - startedAtMs);

			const status = resolveRunStatus(artifacts.length, errors.length);

			return {
				status,
				artifacts,
				errors,
				skipped,
				timings: {
					startedAt,
					finishedAt,
					durationMs,
					perPluginMs,
					cacheHits,
					cacheMisses,
				},
				traceId: parsedRequest.traceId,
			};
		},
	};
}

type ExecutePluginParams = {
	plugin: EnrichmentPlugin;
	request: EnrichmentRequest;
	timeoutMs: number;
	logger?: EnrichmentPluginLogger;
	now: () => string;
	secrets?: Record<string, string>;
	parentSignal?: AbortSignal;
	cache?: CacheAdapter;
};

type ExecutePluginResult = {
	artifacts: EnrichmentArtifact[];
	durationMs: number;
	error?: PluginExecutionError;
	fromCache: boolean;
	cacheHit: boolean;
	cacheMiss: boolean;
	cacheKey?: string;
	TTL?: number;
};

async function executePluginWithCache(params: ExecutePluginParams): Promise<ExecutePluginResult> {
	const startedAtMs = Date.now();
	const ttlMs = toTtlMs(params.plugin.TTL);
	const canUseCache = !!params.cache && typeof ttlMs === 'number';
	const cacheKey = canUseCache ? buildCacheKey(params.plugin.id, params.request.input) : undefined;

	if (canUseCache && params.cache && cacheKey) {
		try {
			const cachedEntry = await params.cache.get(cacheKey);
			if (cachedEntry && isCachedEntryFresh(cachedEntry)) {
				return {
					artifacts: cachedEntry.artifacts.map((artifact) => ({
						artifact_type: artifact.artifact_type,
						data: { ...artifact.data },
						meta: {
							...artifact.meta,
							pluginId: params.plugin.id,
							fromCache: true,
							cachedAt: cachedEntry.cachedAt,
						},
					})),
					durationMs: Math.max(0, Date.now() - startedAtMs),
					fromCache: true,
					cacheHit: true,
					cacheMiss: false,
					cacheKey,
					TTL: params.plugin.TTL,
				};
			}

			if (cachedEntry && !isCachedEntryFresh(cachedEntry)) {
				try {
					await params.cache.delete(cacheKey);
				} catch {
					// non-fatal cache cleanup failure
				}
			}
		} catch (error) {
			params.logger?.warn('Cache get failed for enrichment plugin.', {
				pluginId: params.plugin.id,
				error: getErrorMessage(error),
			});
		}
	}

	const executionResult = await executePlugin({
		plugin: params.plugin,
		request: params.request,
		timeoutMs: params.timeoutMs,
		logger: params.logger,
		now: params.now,
		secrets: params.secrets,
		parentSignal: params.parentSignal,
	});

	return {
		...executionResult,
		fromCache: false,
		cacheHit: false,
		cacheMiss: canUseCache,
		cacheKey,
		TTL: params.plugin.TTL,
	};
}

async function executePlugin(
	params: Omit<ExecutePluginParams, 'cache'>
): Promise<Omit<ExecutePluginResult, 'fromCache' | 'cacheHit' | 'cacheMiss' | 'cacheKey' | 'TTL'>> {
	const startedAtMs = Date.now();
	const controller = new AbortController();

	const parentAbortUnsubscribe = linkAbortSignals(params.parentSignal, controller);

	let timeout: ReturnType<typeof setTimeout> | undefined;

	try {
		const pluginContext: EnrichmentPluginContext = {
			now: params.now,
			signal: controller.signal,
			logger: params.logger,
			secrets: params.secrets,
		};

		const timeoutPromise = new Promise<never>((_resolve, reject) => {
			timeout = setTimeout(() => {
				controller.abort();
				reject(new PluginTimeoutError(params.timeoutMs));
			}, params.timeoutMs);
		});

		const artifacts = await Promise.race([
			Promise.resolve(params.plugin.enrich(params.request, pluginContext)),
			timeoutPromise,
		]);

		return {
			artifacts,
			durationMs: Math.max(0, Date.now() - startedAtMs),
		};
	} catch (error) {
		return {
			artifacts: [],
			durationMs: Math.max(0, Date.now() - startedAtMs),
			error: toPluginExecutionError(params.plugin.id, error),
		};
	} finally {
		if (timeout) {
			clearTimeout(timeout);
		}
		parentAbortUnsubscribe();
	}
}

type NormalizeArtifactsParams = {
	plugin: EnrichmentPlugin;
	artifacts: EnrichmentArtifact[];
	classificationRegistry: ClassificationRegistry;
	now: () => string;
	errors: PluginExecutionError[];
};

function normalizeArtifacts(params: NormalizeArtifactsParams): EnrichmentArtifact[] {
	const normalized: EnrichmentArtifact[] = [];

	for (const artifact of params.artifacts) {
		const hydratedMeta = {
			...artifact.meta,
			pluginId: params.plugin.id,
			provider: artifact.meta?.provider ?? params.plugin.id,
			fetchedAt: artifact.meta?.fetchedAt ?? params.now(),
		};

		const candidate: EnrichmentArtifact = {
			artifact_type: artifact.artifact_type,
			data: artifact.data,
			meta: hydratedMeta,
		};

		const dataSchemaResult = params.classificationRegistry.validate(
			candidate.artifact_type,
			candidate.data
		);
		if (!dataSchemaResult.success) {
			params.errors.push(
				createPluginError(
					params.plugin.id,
					'validation_error',
					`Artifact data validation failed for artifact type "${candidate.artifact_type}".`,
					false
				)
			);
			continue;
		}

		normalized.push(candidate);
	}

	return [...normalized].sort((left, right) => {
		const classificationDiff = left.artifact_type.localeCompare(right.artifact_type);
		if (classificationDiff !== 0) {
			return classificationDiff;
		}

		return left.meta.provider.localeCompare(right.meta.provider);
	});
}

function filterArtifactsForRequest(
	artifacts: EnrichmentArtifact[],
	request: EnrichmentRequest
): EnrichmentArtifact[] {
	const requestedArtifactTypes = canonicalizeEnrichmentSlugs(
		request.artifactTypes ?? request.artifactClasses
	);
	if (!requestedArtifactTypes || requestedArtifactTypes.length === 0) {
		return artifacts;
	}

	const allowList = new Set(requestedArtifactTypes);
	return artifacts.filter((artifact) => allowList.has(artifact.artifact_type));
}

function resolveRunStatus(
	artifactCount: number,
	errorCount: number
): EnrichmentRunResult['status'] {
	if (errorCount === 0) {
		return 'success';
	}

	if (artifactCount > 0) {
		return 'partial';
	}

	return 'failed';
}

function toPluginExecutionError(pluginId: string, error: unknown): PluginExecutionError {
	if (error instanceof PluginTimeoutError) {
		return createPluginError(pluginId, 'timeout', error.message, true);
	}

	const message = getErrorMessage(error);
	const lowered = message.toLowerCase();

	if (lowered.includes('rate limit') || lowered.includes('429')) {
		return createPluginError(pluginId, 'rate_limited', message, true);
	}

	if (
		lowered.includes('auth') ||
		lowered.includes('unauthorized') ||
		lowered.includes('forbidden')
	) {
		return createPluginError(pluginId, 'auth_failed', message, false);
	}

	if (lowered.includes('upstream') || lowered.includes('fetch') || lowered.includes('http')) {
		return createPluginError(pluginId, 'upstream_error', message, true);
	}

	return createPluginError(pluginId, 'internal_error', message, false);
}

function createPluginError(
	pluginId: string,
	code: PluginExecutionErrorCode,
	message: string,
	retriable: boolean
): PluginExecutionError {
	return {
		pluginId,
		code,
		message,
		retriable,
	};
}

function toTtlMs(ttlSeconds: number | undefined): number | undefined {
	if (typeof ttlSeconds !== 'number' || ttlSeconds <= 0) {
		return undefined;
	}

	return ttlSeconds * 1_000;
}

function chunkBy<TItem>(items: TItem[], size: number): TItem[][] {
	if (size <= 0) {
		return [items];
	}

	const chunks: TItem[][] = [];

	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}

	return chunks;
}

function getErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message;
	}

	if (typeof error === 'string') {
		return error;
	}

	return 'Unknown error';
}

function linkAbortSignals(
	source: AbortSignal | undefined,
	targetController: AbortController
): () => void {
	if (!source) {
		return () => {};
	}

	if (source.aborted) {
		targetController.abort(source.reason);
		return () => {};
	}

	const abortHandler = () => {
		targetController.abort(source.reason);
	};

	source.addEventListener('abort', abortHandler, { once: true });

	return () => {
		source.removeEventListener('abort', abortHandler);
	};
}

class PluginTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(`Plugin timed out after ${timeoutMs}ms`);
		this.name = 'PluginTimeoutError';
	}
}

export type {
	EnrichmentPluginRegistry,
	RegisterPluginOptions,
	ResolvePluginsResult,
} from './plugin-registry';
export { createEnrichmentPluginRegistry } from './plugin-registry';
