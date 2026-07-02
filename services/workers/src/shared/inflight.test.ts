import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test';
import { createBoundedScheduler, waitForInflightDrain } from './inflight';

function createLogger() {
	return {
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		debug: mock(() => {}),
		child: () => createLogger(),
	};
}

describe('createBoundedScheduler', () => {
	afterEach(() => {
		mock.restore();
	});

	it('queues excess work and drains it when capacity frees up', async () => {
		const controller = new AbortController();
		const logger = createLogger();
		const started: string[] = [];
		const resolvers = new Map<string, () => void>();

		const scheduler = createBoundedScheduler({
			concurrency: 1,
			maxPending: 2,
			logger,
			stage: 'parse',
			signal: controller.signal,
			run: (atomId) =>
				new Promise<void>((resolve) => {
					started.push(atomId);
					resolvers.set(atomId, resolve);
				}),
		});

		await scheduler.schedule('atom-a');
		await scheduler.schedule('atom-b');
		await scheduler.schedule('atom-c');

		expect(started).toEqual(['atom-a']);
		expect([...scheduler.pending]).toEqual(['atom-b', 'atom-c']);

		resolvers.get('atom-a')?.();
		await Bun.sleep(0);
		expect(started).toEqual(['atom-a', 'atom-b']);
		expect([...scheduler.pending]).toEqual(['atom-c']);

		resolvers.get('atom-b')?.();
		await Bun.sleep(0);
		expect(started).toEqual(['atom-a', 'atom-b', 'atom-c']);
		expect(scheduler.pending.size).toBe(0);
	});

	it('logs and drops work when the queue is at capacity', async () => {
		const controller = new AbortController();
		const logger = createLogger();

		const scheduler = createBoundedScheduler({
			concurrency: 1,
			maxPending: 1,
			logger,
			stage: 'enrichment',
			signal: controller.signal,
			run: () => new Promise<void>(() => {}),
		});

		await scheduler.schedule('atom-a');
		await scheduler.schedule('atom-b');
		await scheduler.schedule('atom-c');

		expect(scheduler.inflight.has('atom-a')).toBe(true);
		expect([...scheduler.pending]).toEqual(['atom-b']);
		expect(logger.warn).toHaveBeenCalledTimes(1);
		expect(logger.warn).toHaveBeenCalledWith(
			'worker queue at capacity; dropping schedule request',
			expect.objectContaining({
				stage: 'enrichment',
				atomId: 'atom-c',
				maxPending: 1,
			})
		);
	});
});

describe('waitForInflightDrain', () => {
	afterEach(() => {
		mock.restore();
	});

	it('honors the configured shutdown drain timeout', async () => {
		const logger = createLogger();
		const inflight = new Set(['atom-a']);

		await waitForInflightDrain({
			inflight,
			logger,
			stage: 'parse',
			timeoutMs: 1,
			pollMs: 1,
		});

		expect(logger.warn).toHaveBeenCalledWith(
			'worker shutdown timed out waiting for inflight work to finish',
			expect.objectContaining({
				stage: 'parse',
				timeoutMs: 1,
			})
		);
	});

	it('stops waiting when the shutdown signal is aborted', async () => {
		const logger = createLogger();
		const inflight = new Set(['atom-a']);
		const controller = new AbortController();
		controller.abort();

		await waitForInflightDrain({
			inflight,
			logger,
			stage: 'parse',
			timeoutMs: 30_000,
			pollMs: 1,
			signal: controller.signal,
		});

		expect(logger.warn).toHaveBeenCalledWith(
			'worker shutdown aborted while waiting for inflight work to finish',
			expect.objectContaining({
				stage: 'parse',
				aborted: true,
			})
		);
	});

	it('returns without warning when inflight work completes during drain', async () => {
		const logger = createLogger();
		const inflight = new Set(['atom-a']);
		setTimeout(() => inflight.clear(), 1);

		await waitForInflightDrain({
			inflight,
			logger,
			stage: 'parse',
			timeoutMs: 100,
			pollMs: 1,
		});

		expect(logger.warn).not.toHaveBeenCalled();
	});

	it('logs progress while waiting for inflight work to drain', async () => {
		const logger = createLogger();
		const inflight = new Set(['atom-a']);
		const nowValues = [0, 1, 2_001, 2_002, 2_003];
		spyOn(Date, 'now').mockImplementation(() => nowValues.shift() ?? 2_003);

		await waitForInflightDrain({
			inflight,
			logger,
			stage: 'parse',
			timeoutMs: 2_002,
			pollMs: 1,
		});

		expect(logger.info).toHaveBeenCalledWith(
			'worker shutdown waiting for inflight work to finish',
			expect.objectContaining({
				stage: 'parse',
				inflight: 1,
				elapsedMs: 2_001,
				timeoutMs: 2_002,
			})
		);
	});
});
