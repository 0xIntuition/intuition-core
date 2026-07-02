import { createClassificationRuntime } from '@0xintuition/atom-services/runtime';
import {
	claimNodeProcessingStage,
	completeNodeProcessingStage,
	failNodeProcessingStage,
	getNodeForProcessing,
	inKgTransaction,
	type KgActionDb,
	listNodeProcessingCandidates,
	markNodeProcessingStageSkipped,
	markNodeProcessingStagesSkipped,
	reapStuckProcessingNodes,
	releaseClaimedProcessingStageLeases,
} from '@0xintuition/database-kg/actions';
import {
	deriveClassificationPlan,
	deriveClassificationResultFromRuntime,
	resolveClassificationType,
} from '../../core/classification';
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
import { getProcessingMetaString, toCompactParseResultMaybe } from '../processing';

const WORKER = 'kg-classification-worker';

export async function runKgClassificationWorker(input: {
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
	const classificationRuntime = createClassificationRuntime({
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
		if (!node || node.parseStatus !== 'completed') {
			return;
		}

		const claimed = await input.circuits.database.execute(() =>
			claimNodeProcessingStage(input.db, {
				stage: 'classification',
				nodeId,
				workerId: input.config.workerId,
				leaseMs: input.config.leaseMs,
				maxAttempts: input.config.maxAttempts,
				prerequisiteStage: { stage: 'parse' },
			})
		);
		if (!claimed) {
			return;
		}

		const runId = getProcessingMetaString(claimed.processingMeta, 'classificationRunId');
		const startedAt = Date.now();
		const logger = input.logger.child({
			stage: 'kg-classification',
			nodeId: claimed.id,
			runId,
			attempt: claimed.classificationAttempts,
		});

		try {
			const parseResult = toCompactParseResultMaybe(claimed.parseResult);
			const rawInput = claimed.data ?? claimed.dataHex;
			const plan = deriveClassificationPlan({ parseResult, rawInput });
			let classificationResult = plan.classificationResult;

			if (!plan.usesStructuredDocument) {
				if (!plan.runtimeInput) {
					// See atom-parsing for the rationale: classification-skip +
					// downstream-skip must commit atomically or prerequisite-driven
					// candidate selection will leave enrichment orphaned in `pending`.
					await input.circuits.database.execute(() =>
						inKgTransaction(input.db, async (tx) => {
							await markNodeProcessingStageSkipped(tx, {
								stage: 'classification',
								nodeId: claimed.id,
								runId,
								reason: 'Node has no parse result or raw input to classify.',
							});
							await markNodeProcessingStagesSkipped(tx, {
								nodeId: claimed.id,
								stages: ['enrichment'],
								reason: 'Classification skipped because no classification input was available.',
							});
						})
					);
					input.metrics.increment('skipped', 'classification');
					return;
				}

				const runtimeInput = plan.runtimeInput;
				const runtimeClassification = await input.circuits.runtime.execute(() =>
					classificationRuntime.engine.classify({
						input: runtimeInput,
						mode: 'progressive',
						classificationSessionId: runId,
					})
				);
				classificationResult = deriveClassificationResultFromRuntime({
					classification: runtimeClassification,
					targetUrl: plan.targetUrl,
					targetSource: plan.targetSource,
				});
			}

			await input.circuits.database.execute(() =>
				completeNodeProcessingStage(input.db, {
					stage: 'classification',
					nodeId: claimed.id,
					runId,
					data: classificationResult,
					promotedFields: {
						classificationType: resolveClassificationType(classificationResult),
					},
				})
			);
			input.metrics.increment('completed', 'classification');
			input.metrics.recordDuration('classification_duration_ms', Date.now() - startedAt);
			logger.info('kg classification completed', {
				durationMs: Date.now() - startedAt,
				status: classificationResult.status,
				classificationType: resolveClassificationType(classificationResult),
			});
		} catch (error) {
			const classified = classifyWorkerError(error);
			const processingError = toProcessingError(error, {
				maxAttempts: input.config.maxAttempts,
			});
			await input.circuits.database.execute(() =>
				failNodeProcessingStage(input.db, {
					stage: 'classification',
					nodeId: claimed.id,
					runId,
					error: processingError,
				})
			);
			input.metrics.increment(processingError.retriable ? 'retried' : 'failed', 'classification');
			if (claimed.classificationAttempts >= input.config.maxAttempts) {
				input.metrics.incrementDeadLetters({ worker: WORKER, stage: 'classification' });
			}
			logger.error('kg classification failed', {
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
		stage: 'classification',
		worker: WORKER,
		signal: input.signal,
		run: processNode,
		metrics: input.metrics,
		onProgress: ({ kind }) => input.heartbeat.beat(`${WORKER}:${kind}`),
	});

	const reconcileLogger = input.logger.child({ stage: 'kg-classification', source: 'reconcile' });
	try {
		await runReconciliationLoop({
			name: 'kg-classification-reconcile',
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
						stage: 'classification',
						maxAttempts: input.config.maxAttempts,
						limit: maxPending,
					})
				);
				if (reaped.reaped > 0) {
					input.metrics.increment('reaped', 'classification', reaped.reaped);
					input.metrics.incrementDeadLetters({
						worker: WORKER,
						stage: 'classification',
						value: reaped.reaped,
					});
					reconcileLogger.warn('reaped stuck classification rows', {
						count: reaped.reaped,
						ids: reaped.ids.slice(0, 25),
					});
				}

				const limit = input.config.concurrency * RECONCILE_BATCH_SIZE_MULTIPLIER;
				const nodes = await input.circuits.database.execute(() =>
					listNodeProcessingCandidates(input.db, {
						stage: 'classification',
						limit,
						maxAttempts: input.config.maxAttempts,
						includeFailed: true,
						prerequisiteStage: { stage: 'parse' },
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
			stage: 'classification',
			timeoutMs: input.config.shutdownTimeoutMs,
			signal: input.signal,
		});

		try {
			const released = await input.circuits.database.execute(() =>
				releaseClaimedProcessingStageLeases(input.db, {
					stage: 'classification',
					workerId: input.config.workerId,
				})
			);
			if (released.released > 0) {
				input.logger.info('released classification leases on shutdown', {
					count: released.released,
					ids: released.ids.slice(0, 25),
				});
			}
		} catch (error) {
			input.logger.warn('failed to release classification leases on shutdown', {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}
