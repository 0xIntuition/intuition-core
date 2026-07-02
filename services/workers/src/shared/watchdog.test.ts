import { afterEach, describe, expect, it, mock } from 'bun:test';
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

describe('startHeartbeatWatchdog', () => {
	afterEach(() => {
		mock.restore();
	});

	it('does not report while heartbeat stays fresh', () => {
		const logger = createLogger();
		const controller = new AbortController();
		let now = 0;
		const heartbeat = new Heartbeat('unit-worker', () => now);
		const onTimeout = mock(() => {});
		let check: (() => void) | undefined;

		const stop = startHeartbeatWatchdog({
			heartbeat,
			logger,
			signal: controller.signal,
			intervalMs: 1,
			timeoutMs: 10,
			onTimeout,
			setIntervalFn: (callback) => {
				check = callback;
				return {} as never;
			},
			clearIntervalFn: mock(() => {}),
		});

		now = 9;
		check?.();
		stop();

		expect(onTimeout).not.toHaveBeenCalled();
		expect(logger.error).not.toHaveBeenCalled();
	});

	it('reports stale heartbeat timeouts once per stale period and resets on recovery', () => {
		const logger = createLogger();
		const controller = new AbortController();
		let now = 0;
		const heartbeat = new Heartbeat('unit-worker', () => now);
		const onTimeout = mock(() => {});
		const onRecovery = mock(() => {});
		let check: (() => void) | undefined;

		const stop = startHeartbeatWatchdog({
			heartbeat,
			logger,
			signal: controller.signal,
			intervalMs: 1,
			timeoutMs: 10,
			onTimeout,
			onRecovery,
			setIntervalFn: (callback) => {
				check = callback;
				return {} as never;
			},
			clearIntervalFn: mock(() => {}),
		});

		now = 11;
		check?.();
		check?.();
		expect(onTimeout).toHaveBeenCalledTimes(1);

		heartbeat.beat('recovered');
		check?.();
		expect(onRecovery).toHaveBeenCalledTimes(1);

		now = 22;
		check?.();
		stop();

		expect(onTimeout).toHaveBeenCalledTimes(2);
		expect(logger.error).toHaveBeenCalledWith(
			'worker heartbeat watchdog timed out',
			expect.objectContaining({ service: 'unit-worker' })
		);
		expect(logger.info).toHaveBeenCalledWith(
			'worker heartbeat watchdog recovered',
			expect.objectContaining({ service: 'unit-worker' })
		);
	});
});
