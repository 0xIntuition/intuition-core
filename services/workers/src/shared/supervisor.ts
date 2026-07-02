import { classifyWorkerError, computeRetryDelayMs } from './errors';
import type { Logger } from './logger';
import { sleep } from './reconciliation';

export type SupervisorAttempt = {
	attempt: number;
};

export async function runSupervised(input: {
	name: string;
	signal: AbortSignal;
	logger: Logger;
	baseDelayMs: number;
	maxDelayMs: number;
	healthyAfterMs?: number;
	run: (attempt: SupervisorAttempt) => Promise<void>;
	onRestart?: (context: {
		attempt: number;
		consecutiveFailures: number;
		delayMs: number;
		errorClass: string;
	}) => void;
	sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
	now?: () => number;
	computeDelayMs?: (attempt: number, baseMs: number, maxMs: number) => number;
}): Promise<void> {
	// A run that survives this long resets the backoff streak. The boundary is
	// inclusive so an exactly-threshold healthy period counts as recovered.
	const healthyAfterMs = input.healthyAfterMs ?? 60_000;
	const sleepFor = input.sleep ?? sleep;
	const now = input.now ?? Date.now;
	const computeDelayMs = input.computeDelayMs ?? computeRetryDelayMs;
	let attempt = 0;
	let consecutiveFailures = 0;

	while (!input.signal.aborted) {
		attempt += 1;
		const startedAt = now();
		try {
			await input.run({ attempt });
			return;
		} catch (error) {
			if (input.signal.aborted) {
				input.logger.info('supervised worker stopped after abort', {
					service: input.name,
					attempt,
				});
				return;
			}

			const classified = classifyWorkerError(error);
			if (classified.class === 'fatal') {
				input.logger.error('supervised worker stopped after fatal error', {
					service: input.name,
					attempt,
					errorClass: classified.class,
					code: classified.code,
					error: classified.message,
				});
				throw error;
			}

			const runtimeMs = Math.max(0, now() - startedAt);
			if (runtimeMs >= healthyAfterMs) {
				consecutiveFailures = 0;
			}
			consecutiveFailures += 1;
			const delayMs = computeDelayMs(consecutiveFailures, input.baseDelayMs, input.maxDelayMs);
			input.logger.warn('supervised worker attempt failed; restarting after backoff', {
				service: input.name,
				attempt,
				consecutiveFailures,
				runtimeMs,
				delayMs,
				code: classified.code,
				error: classified.message,
			});
			input.onRestart?.({
				attempt,
				consecutiveFailures,
				delayMs,
				errorClass: classified.class,
			});

			await sleepFor(delayMs, input.signal);
		}
	}
}
