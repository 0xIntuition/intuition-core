import type { Logger } from './logger';
import type { WorkerMetrics } from './metrics';
import { sleep } from './reconciliation';

export const RECONCILE_BATCH_SIZE_MULTIPLIER = 4;
export type WorkerStage = 'parse' | 'classification' | 'enrichment';
export type SchedulerProgressEvent = {
	kind: 'started' | 'settled';
	stage: WorkerStage;
	atomId: string;
	inflight: number;
	pending: number;
};

export function createBoundedScheduler(input: {
	concurrency: number;
	maxPending: number;
	logger: Logger;
	stage: WorkerStage;
	worker?: string;
	signal: AbortSignal;
	run: (atomId: string) => Promise<void>;
	metrics?: WorkerMetrics;
	onProgress?: (event: SchedulerProgressEvent) => void;
}) {
	const inflight = new Set<string>();
	const pending = new Set<string>();
	let workerError: unknown;

	const recordDepth = () => {
		if (!input.metrics) {
			return;
		}
		input.metrics.setSchedulerDepth({
			worker: input.worker ?? input.stage,
			stage: input.stage,
			inflight: inflight.size,
			pending: pending.size,
		});
	};

	const notifyProgress = (kind: SchedulerProgressEvent['kind'], atomId: string) => {
		input.onProgress?.({
			kind,
			stage: input.stage,
			atomId,
			inflight: inflight.size,
			pending: pending.size,
		});
	};

	const launch = (atomId: string) => {
		inflight.add(atomId);
		recordDepth();
		notifyProgress('started', atomId);
		void input
			.run(atomId)
			.catch((error) => {
				workerError = error;
				input.logger.error('worker task crashed before completion', {
					stage: input.stage,
					atomId,
					error: error instanceof Error ? error.message : String(error),
				});
			})
			.finally(() => {
				inflight.delete(atomId);
				recordDepth();
				notifyProgress('settled', atomId);
				void drain();
			});
	};

	const drain = async () => {
		while (!input.signal.aborted && inflight.size < input.concurrency && pending.size > 0) {
			const next = pending.values().next();
			if (next.done) {
				return;
			}

			pending.delete(next.value);
			recordDepth();
			if (inflight.has(next.value)) {
				continue;
			}

			launch(next.value);
		}
	};

	const schedule = async (atomId: string): Promise<boolean> => {
		if (input.signal.aborted || inflight.has(atomId) || pending.has(atomId)) {
			return false;
		}

		if (inflight.size < input.concurrency && pending.size === 0) {
			launch(atomId);
			return true;
		}

		if (pending.size >= input.maxPending) {
			recordDepth();
			input.logger.warn('worker queue at capacity; dropping schedule request', {
				stage: input.stage,
				atomId,
				concurrency: input.concurrency,
				pending: pending.size,
				maxPending: input.maxPending,
			});
			return false;
		}

		pending.add(atomId);
		recordDepth();
		await drain();
		return true;
	};

	return {
		inflight,
		pending,
		schedule,
		takeWorkerError: () => {
			const error = workerError;
			workerError = undefined;
			return error;
		},
	};
}

export async function waitForInflightDrain(input: {
	inflight: Set<string>;
	pending?: Set<string>;
	logger: Logger;
	stage: WorkerStage;
	timeoutMs: number;
	pollMs?: number;
	signal?: AbortSignal;
}): Promise<void> {
	const timeoutMs = input.timeoutMs;
	const pollMs = input.pollMs ?? 100;
	const startedAt = Date.now();
	let lastProgressLogAt = startedAt;

	while (input.inflight.size > 0 && Date.now() - startedAt < timeoutMs && !input.signal?.aborted) {
		await sleep(pollMs, input.signal);
		const now = Date.now();
		if (input.inflight.size > 0 && now - lastProgressLogAt >= 2_000) {
			input.logger.info('worker shutdown waiting for inflight work to finish', {
				stage: input.stage,
				inflight: input.inflight.size,
				pending: input.pending?.size ?? 0,
				elapsedMs: now - startedAt,
				timeoutMs,
			});
			lastProgressLogAt = now;
		}
	}

	if (input.inflight.size > 0) {
		const aborted = Boolean(input.signal?.aborted);
		input.logger.warn(
			aborted
				? 'worker shutdown aborted while waiting for inflight work to finish'
				: 'worker shutdown timed out waiting for inflight work to finish',
			{
				stage: input.stage,
				inflight: input.inflight.size,
				pending: input.pending?.size ?? 0,
				aborted,
				timeoutMs,
			}
		);
	}

	if ((input.pending?.size ?? 0) > 0) {
		input.logger.warn('worker shutdown left queued work unprocessed', {
			stage: input.stage,
			pending: input.pending?.size ?? 0,
		});
	}
}
