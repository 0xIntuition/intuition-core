import { parseAtom } from '@0xintuition/atom-parser/parse';
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
import { toCompactParseResult } from '../../core/parse';
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
import { getProcessingMetaString } from '../processing';

const WORKER = 'kg-parse-worker';

export async function runKgParsingWorker(input: {
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
	const processNode = async (nodeId: string) => {
		const node = await input.circuits.database.execute(() =>
			getNodeForProcessing(input.db, nodeId)
		);
		if (!node) {
			return;
		}

		const claimed = await input.circuits.database.execute(() =>
			claimNodeProcessingStage(input.db, {
				stage: 'parse',
				nodeId,
				workerId: input.config.workerId,
				leaseMs: input.config.leaseMs,
				maxAttempts: input.config.maxAttempts,
			})
		);
		if (!claimed) {
			return;
		}

		const runId = getProcessingMetaString(claimed.processingMeta, 'parseRunId');
		const startedAt = Date.now();
		const logger = input.logger.child({
			stage: 'kg-parse',
			nodeId: claimed.id,
			runId,
			attempt: claimed.parseAttempts,
		});

		try {
			const rawInput = resolveParseInput(claimed);
			if (!rawInput) {
				// Wrap the parse-skip and the cascade skip of downstream stages in a
				// single transaction. If the worker dies between the two writes the
				// node would otherwise sit with `parse_status = skipped` and
				// `classification_status = pending`, and prerequisite-driven candidate
				// selection would never pick it up again.
				await input.circuits.database.execute(() =>
					inKgTransaction(input.db, async (tx) => {
						await markNodeProcessingStageSkipped(tx, {
							stage: 'parse',
							nodeId: claimed.id,
							runId,
							reason: 'Node has no data or dataHex to parse.',
						});
						await markNodeProcessingStagesSkipped(tx, {
							nodeId: claimed.id,
							stages: ['classification', 'enrichment'],
							reason: 'Parse skipped because node has no data or dataHex.',
						});
					})
				);
				input.metrics.increment('skipped', 'parse');
				return;
			}

			const result = await input.circuits.runtime.execute(() =>
				parseAtom(rawInput, input.config.parseOptions)
			);
			const compact = toCompactParseResult(result);
			await input.circuits.database.execute(() =>
				completeNodeProcessingStage(input.db, {
					stage: 'parse',
					nodeId: claimed.id,
					runId,
					data: compact,
					promotedFields: {
						searchText: resolveSearchText(compact, rawInput),
						...(compact.structuredDocument?.data !== undefined
							? { dataResolved: compact.structuredDocument.data }
							: {}),
					},
				})
			);
			input.metrics.increment('completed', 'parse');
			input.metrics.recordDuration('parse_duration_ms', Date.now() - startedAt);
			logger.info('kg parse completed', {
				durationMs: Date.now() - startedAt,
				kind: compact.kind,
			});
		} catch (error) {
			const classified = classifyWorkerError(error);
			const processingError = toProcessingError(error, {
				maxAttempts: input.config.maxAttempts,
			});
			await input.circuits.database.execute(() =>
				failNodeProcessingStage(input.db, {
					stage: 'parse',
					nodeId: claimed.id,
					runId,
					error: processingError,
				})
			);
			input.metrics.increment(processingError.retriable ? 'retried' : 'failed', 'parse');
			if (claimed.parseAttempts >= input.config.maxAttempts) {
				input.metrics.incrementDeadLetters({ worker: WORKER, stage: 'parse' });
			}
			logger.error('kg parse failed', {
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
		stage: 'parse',
		worker: WORKER,
		signal: input.signal,
		run: processNode,
		metrics: input.metrics,
		onProgress: ({ kind }) => input.heartbeat.beat(`${WORKER}:${kind}`),
	});

	const reconcileLogger = input.logger.child({ stage: 'kg-parse', source: 'reconcile' });
	try {
		await runReconciliationLoop({
			name: 'kg-parse-reconcile',
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
				// Reap rows stuck in `processing` past `maxAttempts` with an expired
				// lease before listing candidates. Without this sweep such rows are
				// never re-claimed (the claim filter requires `attempts < maxAttempts`)
				// and never appear as terminal failures in operator dashboards.
				const reaped = await input.circuits.database.execute(() =>
					reapStuckProcessingNodes(input.db, {
						stage: 'parse',
						maxAttempts: input.config.maxAttempts,
						limit: maxPending,
					})
				);
				if (reaped.reaped > 0) {
					input.metrics.increment('reaped', 'parse', reaped.reaped);
					input.metrics.incrementDeadLetters({
						worker: WORKER,
						stage: 'parse',
						value: reaped.reaped,
					});
					reconcileLogger.warn('reaped stuck parse rows', {
						count: reaped.reaped,
						ids: reaped.ids.slice(0, 25),
					});
				}

				const limit = input.config.concurrency * RECONCILE_BATCH_SIZE_MULTIPLIER;
				const nodes = await input.circuits.database.execute(() =>
					listNodeProcessingCandidates(input.db, {
						stage: 'parse',
						limit,
						maxAttempts: input.config.maxAttempts,
						includeFailed: true,
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
			stage: 'parse',
			timeoutMs: input.config.shutdownTimeoutMs,
			signal: input.signal,
		});

		// Best-effort lease release: rows that did not finish in time during the
		// drain window are still in `processing` with a live lease. Expire those
		// leases now so the next worker's reconcile can re-claim immediately
		// instead of waiting up to `WORKERS_LEASE_MS` for natural expiry.
		try {
			const released = await input.circuits.database.execute(() =>
				releaseClaimedProcessingStageLeases(input.db, {
					stage: 'parse',
					workerId: input.config.workerId,
				})
			);
			if (released.released > 0) {
				input.logger.info('released parse leases on shutdown', {
					count: released.released,
					ids: released.ids.slice(0, 25),
				});
			}
		} catch (error) {
			input.logger.warn('failed to release parse leases on shutdown', {
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
}

function resolveParseInput(node: { data: string | null; dataHex: string | null }): string | null {
	return node.data ?? node.dataHex ?? null;
}

function resolveSearchText(
	compact: ReturnType<typeof toCompactParseResult>,
	rawInput: string
): string {
	const structuredData =
		compact.structuredDocument?.data &&
		typeof compact.structuredDocument.data === 'object' &&
		!Array.isArray(compact.structuredDocument.data)
			? (compact.structuredDocument.data as Record<string, unknown>)
			: undefined;
	const name = resolveString(structuredData?.name);
	const description = resolveString(structuredData?.description);

	return [name, description, compact.canonicalId, compact.normalizedInput, rawInput]
		.filter((value): value is string => Boolean(value?.trim()))
		.join(' ')
		.slice(0, 20_000);
}

function resolveString(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim().length > 0) {
		return value.trim();
	}

	if (Array.isArray(value)) {
		const first = value.find(
			(entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
		);
		return first?.trim();
	}

	return undefined;
}
