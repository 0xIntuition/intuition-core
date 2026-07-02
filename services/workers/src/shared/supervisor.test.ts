import { afterEach, describe, expect, it, mock } from 'bun:test';
import { WorkerConfigurationError } from './errors';
import { runSupervised } from './supervisor';

function createLogger() {
	return {
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		debug: mock(() => {}),
		child: () => createLogger(),
	};
}

describe('runSupervised', () => {
	afterEach(() => {
		mock.restore();
	});

	it('restarts transient failures with backoff', async () => {
		const logger = createLogger();
		const controller = new AbortController();
		const delays: number[] = [];
		let attempts = 0;

		await runSupervised({
			name: 'unit-worker',
			signal: controller.signal,
			logger,
			baseDelayMs: 100,
			maxDelayMs: 1_000,
			computeDelayMs: (attempt) => attempt * 100,
			sleep: async (ms) => {
				delays.push(ms);
			},
			run: async () => {
				attempts += 1;
				if (attempts === 1) {
					throw new Error('network timeout');
				}
			},
		});

		expect(attempts).toBe(2);
		expect(delays).toEqual([100]);
		expect(logger.warn).toHaveBeenCalledWith(
			'supervised worker attempt failed; restarting after backoff',
			expect.objectContaining({
				service: 'unit-worker',
				consecutiveFailures: 1,
				delayMs: 100,
			})
		);
	});

	it('resets the backoff streak after a healthy runtime', async () => {
		const logger = createLogger();
		const controller = new AbortController();
		const delayAttempts: number[] = [];
		let attempts = 0;
		let now = 0;

		await runSupervised({
			name: 'unit-worker',
			signal: controller.signal,
			logger,
			baseDelayMs: 100,
			maxDelayMs: 1_000,
			healthyAfterMs: 1_000,
			now: () => now,
			computeDelayMs: (attempt) => {
				delayAttempts.push(attempt);
				return attempt * 100;
			},
			sleep: async () => {},
			run: async () => {
				attempts += 1;
				if (attempts === 1) {
					now = 10;
					throw new Error('network timeout');
				}
				if (attempts === 2) {
					now = 2_000;
					throw new Error('network timeout');
				}
			},
		});

		expect(delayAttempts).toEqual([1, 1]);
	});

	it('throws fatal failures without retrying', async () => {
		const logger = createLogger();
		const controller = new AbortController();
		const sleep = mock(async () => {});

		await expect(
			runSupervised({
				name: 'unit-worker',
				signal: controller.signal,
				logger,
				baseDelayMs: 100,
				maxDelayMs: 1_000,
				sleep,
				run: async () => {
					throw new WorkerConfigurationError('invalid configuration');
				},
			})
		).rejects.toThrow('invalid configuration');

		expect(sleep).not.toHaveBeenCalled();
		expect(logger.error).toHaveBeenCalledWith(
			'supervised worker stopped after fatal error',
			expect.objectContaining({
				service: 'unit-worker',
				errorClass: 'fatal',
			})
		);
	});

	it('stops restarting when aborted during backoff sleep', async () => {
		const logger = createLogger();
		const controller = new AbortController();
		let attempts = 0;

		await runSupervised({
			name: 'unit-worker',
			signal: controller.signal,
			logger,
			baseDelayMs: 100,
			maxDelayMs: 1_000,
			computeDelayMs: () => 100,
			sleep: async (_ms, signal) => {
				expect(signal).toBe(controller.signal);
				controller.abort();
			},
			run: async () => {
				attempts += 1;
				throw Object.assign(new Error('temporary db outage'), { code: 'ECONNRESET' });
			},
		});

		expect(attempts).toBe(1);
	});
});
