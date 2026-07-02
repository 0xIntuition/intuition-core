import { afterEach, describe, expect, it, mock } from 'bun:test';
import { createBoundedScheduler } from './inflight';
import { runReconciliationLoop } from './reconciliation';
import { Heartbeat, startHeartbeatWatchdog } from './watchdog';

function createLogger() {
	return {
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		debug: mock(() => {}),
		child: () => createLogger(),
	};
}

describe('runReconciliationLoop', () => {
	afterEach(() => {
		mock.restore();
	});

	it('skips sleep when an iteration reports a full batch', async () => {
		const logger = createLogger();
		const controller = new AbortController();
		let runs = 0;
		const sleep = mock(async () => {
			controller.abort();
		});

		await runReconciliationLoop({
			name: 'unit-reconcile',
			intervalMs: 1_000,
			signal: controller.signal,
			logger,
			sleep,
			run: async () => {
				runs += 1;
				if (runs === 1) {
					return { skipSleep: true };
				}
				controller.abort();
			},
		});

		expect(runs).toBe(2);
		expect(sleep).not.toHaveBeenCalled();
		expect(logger.debug).toHaveBeenCalledWith(
			'reconciliation loop skipping sleep after full batch',
			expect.objectContaining({ loop: 'unit-reconcile' })
		);
	});

	it('sleeps after partial iterations', async () => {
		const logger = createLogger();
		const controller = new AbortController();
		const sleep = mock(async () => {
			controller.abort();
		});

		await runReconciliationLoop({
			name: 'unit-reconcile',
			intervalMs: 1_000,
			signal: controller.signal,
			logger,
			sleep,
			run: async () => ({ skipSleep: false }),
		});

		expect(sleep).toHaveBeenCalledWith(1_000, controller.signal);
	});

	it('backs off consecutive iteration failures and then surfaces the error', async () => {
		const logger = createLogger();
		const controller = new AbortController();
		const sleep = mock(async () => {});

		await expect(
			runReconciliationLoop({
				name: 'unit-reconcile',
				intervalMs: 1_000,
				signal: controller.signal,
				logger,
				sleep,
				failureBackoffBaseMs: 100,
				failureBackoffMaxMs: 250,
				maxConsecutiveFailures: 3,
				run: async () => {
					throw new Error('schema drift');
				},
			})
		).rejects.toThrow('schema drift');

		expect(sleep).toHaveBeenNthCalledWith(1, 100, controller.signal);
		expect(sleep).toHaveBeenNthCalledWith(2, 200, controller.signal);
		expect(logger.error).toHaveBeenCalledWith(
			'reconciliation iteration failed',
			expect.objectContaining({
				loop: 'unit-reconcile',
				consecutiveFailures: 3,
			})
		);
	});

	it('beats the heartbeat only after successful iterations', async () => {
		const logger = createLogger();
		const controller = new AbortController();
		let now = 0;
		const heartbeat = new Heartbeat('unit-worker', () => now);
		const sleep = mock(async () => {
			controller.abort();
		});

		await runReconciliationLoop({
			name: 'unit-reconcile',
			intervalMs: 1_000,
			signal: controller.signal,
			logger,
			sleep,
			heartbeat,
			run: async () => {
				now = 50;
				return {};
			},
		});

		expect(heartbeat.snapshot(50).ageMs).toBe(0);

		const failingHeartbeat = new Heartbeat('unit-worker', () => now);
		await expect(
			runReconciliationLoop({
				name: 'unit-reconcile',
				intervalMs: 1_000,
				signal: new AbortController().signal,
				logger,
				sleep: mock(async () => {}),
				heartbeat: failingHeartbeat,
				maxConsecutiveFailures: 1,
				run: async () => {
					now = 100;
					throw new Error('schema drift');
				},
			})
		).rejects.toThrow('schema drift');

		expect(failingHeartbeat.snapshot(100).ageMs).toBe(50);
	});

	it('does not refresh the heartbeat while scheduled work remains inflight', async () => {
		const logger = createLogger();
		const controller = new AbortController();
		let now = 0;
		let sleeps = 0;
		const heartbeat = new Heartbeat('unit-worker', () => now);
		const onTimeout = mock(() => {});
		let watchdogCheck: (() => void) | undefined;
		const stopWatchdog = startHeartbeatWatchdog({
			heartbeat,
			logger,
			signal: controller.signal,
			intervalMs: 1,
			timeoutMs: 10,
			onTimeout,
			setIntervalFn: (callback) => {
				watchdogCheck = callback;
				return {} as never;
			},
			clearIntervalFn: mock(() => {}),
		});
		const scheduler = createBoundedScheduler({
			concurrency: 1,
			maxPending: 1,
			logger,
			stage: 'parse',
			signal: controller.signal,
			run: async () =>
				new Promise<void>(() => {
					// Keep the scheduled task in-flight until the test aborts.
				}),
			onProgress: ({ kind }) => heartbeat.beat(`task:${kind}`),
		});
		const sleep = mock(async () => {
			now += 5;
			sleeps += 1;
			if (sleeps >= 3) {
				watchdogCheck?.();
				controller.abort();
			}
		});

		await runReconciliationLoop({
			name: 'unit-reconcile',
			intervalMs: 5,
			signal: controller.signal,
			logger,
			sleep,
			heartbeat,
			shouldBeatHeartbeat: () => scheduler.inflight.size === 0 && scheduler.pending.size === 0,
			run: async () => {
				await scheduler.schedule('atom-1');
			},
		});

		stopWatchdog();

		expect(scheduler.inflight.size).toBe(1);
		expect(heartbeat.snapshot(now).status).toBe('task:started');
		expect(heartbeat.snapshot(now).ageMs).toBe(15);
		expect(onTimeout).toHaveBeenCalledTimes(1);
	});

	it('surfaces failures immediately when the caller marks them escalatable', async () => {
		const logger = createLogger();
		const controller = new AbortController();
		const sleep = mock(async () => {});

		await expect(
			runReconciliationLoop({
				name: 'unit-reconcile',
				intervalMs: 1_000,
				signal: controller.signal,
				logger,
				sleep,
				shouldEscalateFailure: () => true,
				run: async () => {
					throw new Error('provider outage');
				},
			})
		).rejects.toThrow('provider outage');

		expect(sleep).not.toHaveBeenCalled();
	});
});
