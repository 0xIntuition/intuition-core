import { createEnrichmentRuntime } from '@0xintuition/atom-services/runtime';
import {
	claimNodeProcessingStage,
	completeNodeEnrichmentStageWithArtifacts,
	failNodeProcessingStage,
	getNodeForProcessing,
	type KgActionDb,
	listNodeProcessingCandidates,
	markNodeProcessingStageSkipped,
	reapStuckProcessingNodes,
	releaseClaimedProcessingStageLeases,
} from '@0xintuition/database-kg/actions';
import {
	buildClassifiedInputFromPlan,
	deriveEnrichmentPlan,
	getArtifactTypeAllowListForEnrichmentPlan,
} from '../../core/enrichment';
import type { CircuitBreaker } from '../../shared/circuit-breaker';
import type { WorkerConfig } from '../../shared/config';
import { classifyWorkerError, toProcessingError } from '../../shared/errors';
import {
	createBoundedScheduler,
	RECONCILE_BATCH_SIZE_MULTIPLIER,
	waitForInflightDrain,
} from '../../shared/inflight';
import type { Logger } from '../../shared/logger';
import type { WorkerMetrics } from '../../shared/metrics';
import {
	DEFAULT_RECONCILE_FAILURE_RESTART_THRESHOLD,
	runReconciliationLoop,
} from '../../shared/reconciliation';
import type { Heartbeat } from '../../shared/watchdog';
import {
	getProcessingMetaString,
	toClassificationResultMaybe,
	toCompactParseResultMaybe,
} from '../processing';

const WORKER = 'kg-enrichment-worker';

export async function runKgEnrichmentWorker(input: {
	db: KgActionDb;
	config: WorkerConfig;
	logger: Logger;
	metrics: WorkerMetrics;
	signal: AbortSignal;
	heartbeat: Heartbeat;
	circuits: {
		database: CircuitBreaker;
		runtime: CircuitBreaker;
	};
}): Promise<void> {
	const enrichmentRuntime = createEnrichmentRuntime({
		defaultPreset: input.config.defaultPreset,
		cacheProvider: input.config.cacheProvider,
		memoryCacheMaxEntries: input.config.memoryCacheMaxEntries,
		classificationMemoryCacheMaxEntries: input.config.classificationMemoryCacheMaxEntries,
		classificationResolverCacheTtlMs: input.config.classificationResolverCacheTtlMs,
		cacheHttpTimeoutMs: input.config.cacheHttpTimeoutMs,
		env: input.config.env,
	});

	const processNode = async (nodeId: string) => {
		const node = await input.circuits.database.execute(() =>
			getNodeForProcessing(input.db, nodeId)
		);
		if (!node || node.parseStatus !== 'completed' || node.classificationStatus !== 'completed') {
			return;
		}

		const claimed = await input.circuits.database.execute(() =>
			claimNodeProcessingStage(input.db, {
				stage: 'enrichment',
				nodeId,
				workerId: input.config.workerId,
				leaseMs: input.config.leaseMs,
				maxAttempts: input.config.maxAttempts,
				prerequisiteStage: { stage: 'classification' },
			})
		);
		if (!claimed) {
			return;
		}

		const runId = getProcessingMetaString(claimed.processingMeta, 'enrichmentRunId');
		const startedAt = Date.now();
		const logger = input.logger.child({
			stage: 'kg-enrichment',
			nodeId: claimed.id,
			runId,
			attempt: claimed.enrichmentAttempts,
		});

		try {
			const parseResult = toCompactParseResultMaybe(claimed.parseResult);
			const classificationResult = toClassificationResultMaybe(claimed.classificationResult);
			if (!classificationResult) {
				await input.circuits.database.execute(() =>
					markNodeProcessingStageSkipped(input.db, {
						stage: 'enrichment',
						nodeId: claimed.id,
						runId,
						reason: 'Node has no classification result to enrich.',
					})
				);
				input.metrics.increment('skipped', 'enrichment');
				return;
			}

			const plan = deriveEnrichmentPlan({
				parseResult,
				classificationResult,
				rawInput: claimed.data ?? claimed.dataHex,
			});
			const classifiedInput = buildClassifiedInputFromPlan(plan);
			if (!classifiedInput) {
				await input.circuits.database.execute(() =>
					markNodeProcessingStageSkipped(input.db, {
						stage: 'enrichment',
						nodeId: claimed.id,
						runId,
						reason: 'No classified enrichment input produced.',
					})
				);
				input.metrics.increment('skipped', 'enrichment');
				return;
			}

			const engine = enrichmentRuntime.createEngine(input.config.defaultPreset);
			const artifactTypes = getArtifactTypeAllowListForEnrichmentPlan(plan);
			const enrichment = await input.circuits.runtime.execute(() =>
				engine.enrich({
					input: classifiedInput,
					runtime: 'server',
					...(artifactTypes ? { artifactTypes } : {}),
					traceId: runId,
				})
			);
			await input.circuits.database.execute(() =>
				completeNodeEnrichmentStageWithArtifacts(input.db, {
					nodeId: claimed.id,
					runId,
					artifactVersion: input.config.enrichmentVersion,
					targetUrl: plan.targetUrl,
					traceId: enrichment.traceId ?? runId,
					timings: enrichment.timings,
					errors: enrichment.errors,
					skipped: enrichment.skipped,
					artifacts: enrichment.artifacts.map((artifact) => ({
						artifactKind: artifact.artifact_type,
						data: artifact.data,
						meta: artifact.meta,
						sourceUri: artifact.meta.sourceUrl ?? plan.targetUrl,
					})),
				})
			);
			input.metrics.increment('completed', 'enrichment');
			input.metrics.recordDuration('enrichment_duration_ms', Date.now() - startedAt);
			input.metrics.increment('cache_hits', 'enrichment', enrichment.timings.cacheHits);
			input.metrics.increment('cache_misses', 'enrichment', enrichment.timings.cacheMisses);
			logger.info('kg enrichment completed', {
				durationMs: Date.now() - startedAt,
				artifacts: enrichment.artifacts.length,
			});
		} catch (error) {
			const classified = classifyWorkerError(error);
			const processingError = toProcessingError(error, {
				maxAttempts: input.config.maxAttempts,
			});
			await input.circuits.database.execute(() =>
				failNodeProcessingStage(input.db, {
					stage: 'enrichment',
					nodeId: claimed.id,
					runId,
					error: processingError,
				})
			);
			input.metrics.increment(processingError.retriable ? 'retried' : 'failed', 'enrichment');
			if (claimed.enrichmentAttempts >= input.config.maxAttempts) {
				input.metrics.incrementDeadLetters({ worker: WORKER, stage: 'enrichment' });
			}
			logger.error('kg enrichment failed', {
				durationMs: Date.now() - startedAt,
				code: processingError.code,
				retriable: processingError.retriable,
			});
			if (classified.class === 'circuitProtected') {
				throw error;
			}
		}
	};

	const maxPending = input.config.concurrency * RECONCILE_BATCH_SIZE_MULTIPLIER;
	const { inflight, pending, schedule, takeWorkerError } = createBoundedScheduler({
		concurrency: input.config.concurrency,
		maxPending,
		logger: input.logger,
		stage: 'enrichment',
		worker: WORKER,
		signal: input.signal,
		run: processNode,
		metrics: input.metrics,
		onProgress: ({ kind }) => input.heartbeat.beat(`${WORKER}:${kind}`),
	});

	const reconcileLogger = input.logger.child({ stage: 'kg-enrichment', source: 'reconcile' });
	try {
		await runReconciliationLoop({
			name: 'kg-enrichment-reconcile',
			intervalMs: input.config.reconcileIntervalMs,
			signal: input.signal,
			logger: reconcileLogger,
			heartbeat: input.heartbeat,
			shouldBeatHeartbeat: () => inflight.size === 0 && pending.size === 0,
			failureBackoffBaseMs: input.config.retryBaseMs,
			failureBackoffMaxMs: input.config.retryMaxMs,
			maxConsecutiveFailures: DEFAULT_RECONCILE_FAILURE_RESTART_THRESHOLD,
			shouldEscalateFailure: (error) => classifyWorkerError(error).class === 'circuitProtected',
			run: async () => {
				const workerError = takeWorkerError();
				if (workerError) {
					throw workerError;
				}
				// See kg-parse-reconcile for the rationale: rows stuck in `processing`
				// past `maxAttempts` would otherwise never reach a terminal state.
				const reaped = await input.circuits.database.execute(() =>
					reapStuckProcessingNodes(input.db, {
						stage: 'enrichment',
						maxAttempts: input.config.maxAttempts,
						limit: maxPending,
					})
				);
				if (reaped.reaped > 0) {
					input.metrics.increment('reaped', 'enrichment', reaped.reaped);
					input.metrics.incrementDeadLetters({
						worker: WORKER,
						stage: 'enrichment',
						value: reaped.reaped,
					});
					reconcileLogger.warn('reaped stuck enrichment rows', {
						count: reaped.reaped,
						ids: reaped.ids.slice(0, 25),
					});
				}

				const limit = input.config.concurrency * RECONCILE_BATCH_SIZE_MULTIPLIER;
				const nodes = await input.circuits.database.execute(() =>
					listNodeProcessingCandidates(input.db, {
						stage: 'enrichment',
						limit,
						maxAttempts: input.config.maxAttempts,
						includeFailed: true,
						prerequisiteStage: { stage: 'classification' },
					})
				);
				let accepted = 0;
				for (const node of nodes) {
					if (await schedule(node.id)) {
						accepted += 1;
					}
				}
				return {
					skipSleep: nodes.length >= limit && accepted > 0 && pending.size < maxPending,
				};
			},
		});
	} finally {
		await waitForInflightDrain({
			inflight,
			pending,
			logger: input.logger,
			stage: 'enrichment',
			timeoutMs: input.config.shutdownTimeoutMs,
			signal: input.signal,
		});

		try {
			const released = await input.circuits.database.execute(() =>
				releaseClaimedProcessingStageLeases(input.db, {
					stage: 'enrichment',
					workerId: input.config.workerId,
				})
			);
			if (released.released > 0) {
				input.logger.info('released enrichment leases on shutdown', {
					count: released.released,
					ids: released.ids.slice(0, 25),
				});
			}
		} catch (error) {
			input.logger.warn('failed to release enrichment leases on shutdown', {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
