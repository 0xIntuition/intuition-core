import type { Logger } from './logger';
import type { Heartbeat } from './watchdog';

export const DEFAULT_RECONCILE_FAILURE_RESTART_THRESHOLD = 3;

export type ReconciliationRunResult = {
	skipSleep?: boolean;
};

export async function runReconciliationLoop(input: {
	name: string;
	intervalMs: number;
	signal: AbortSignal;
	logger: Logger;
	run: () => Promise<ReconciliationRunResult | undefined> | Promise<void>;
	sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
	failureBackoffBaseMs?: number;
	failureBackoffMaxMs?: number;
	maxConsecutiveFailures?: number;
	shouldEscalateFailure?: (error: unknown, consecutiveFailures: number) => boolean;
	heartbeat?: Heartbeat;
	shouldBeatHeartbeat?: () => boolean;
}): Promise<void> {
	const sleepFor = input.sleep ?? sleep;
	const failureBackoffBaseMs = input.failureBackoffBaseMs ?? input.intervalMs;
	const failureBackoffMaxMs = input.failureBackoffMaxMs ?? input.intervalMs * 8;
	let consecutiveFailures = 0;
	while (!input.signal.aborted) {
		let result: ReconciliationRunResult | undefined;
		try {
			result = (await input.run()) ?? undefined;
			if (input.shouldBeatHeartbeat?.() ?? true) {
				input.heartbeat?.beat(input.name);
			}
			consecutiveFailures = 0;
		} catch (error) {
			consecutiveFailures += 1;
			input.logger.error('reconciliation iteration failed', {
				loop: input.name,
				consecutiveFailures,
				error: error instanceof Error ? error.message : String(error),
			});

			if (input.signal.aborted) {
				return;
			}
			if (input.shouldEscalateFailure?.(error, consecutiveFailures)) {
				throw error;
			}
			if (
				input.maxConsecutiveFailures !== undefined &&
				consecutiveFailures >= input.maxConsecutiveFailures
			) {
				throw error;
			}
			const delayMs = Math.min(
				failureBackoffMaxMs,
				failureBackoffBaseMs * 2 ** Math.max(0, consecutiveFailures - 1)
			);
			input.logger.warn('reconciliation loop backing off after failure', {
				loop: input.name,
				consecutiveFailures,
				delayMs,
			});
			await sleepFor(delayMs, input.signal);
			continue;
		}

		if (input.signal.aborted) {
			return;
		}
		if (result?.skipSleep) {
			input.logger.debug('reconciliation loop skipping sleep after full batch', {
				loop: input.name,
			});
			continue;
		}

		await sleepFor(input.intervalMs, input.signal);
	}
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
	await new Promise<void>((resolve) => {
		const timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, ms);
		const onAbort = () => {
			clearTimeout(timeout);
			cleanup();
			resolve();
		};
		const cleanup = () => signal?.removeEventListener('abort', onAbort);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
