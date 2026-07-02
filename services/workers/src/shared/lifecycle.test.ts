import { afterEach, describe, expect, it, mock } from 'bun:test';
import { startLifecycleServer } from './lifecycle';

function createLogger() {
	return {
		info: mock(() => {}),
		warn: mock(() => {}),
		error: mock(() => {}),
		debug: mock(() => {}),
		child: () => createLogger(),
	};
}

function createMetrics() {
	return {
		renderPrometheus: mock(() => ''),
	};
}

describe('startLifecycleServer', () => {
	afterEach(() => {
		mock.restore();
	});

	it('caches the shutdown promise so concurrent shutdown calls are idempotent', async () => {
		const logger = createLogger();
		const stop = mock(() => {});
		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: createMetrics() as never,
			shutdownTimeoutMs: 15_000,
			serve: () => ({ port: 4110, stop }),
		});

		try {
			await Promise.all([
				lifecycle.requestShutdown({ reason: 'manual' }),
				lifecycle.requestShutdown({ reason: 'manual' }),
			]);

			expect(stop).toHaveBeenCalledTimes(1);
			expect(lifecycle.signal.aborted).toBe(true);
			expect(logger.debug).toHaveBeenCalledWith(
				'worker shutdown already in progress',
				expect.objectContaining({ service: 'unit-test-worker' })
			);
		} finally {
			lifecycle.dispose();
		}
	});

	it('installs an unrefd hard-exit fallback for signal-triggered shutdown', async () => {
		const logger = createLogger();
		const stop = mock(() => {});
		const exitProcess = mock(() => {});
		const unref = mock(() => {});
		const clearShutdownTimeout = mock(() => {});
		let timeoutCallback: (() => void) | undefined;
		const setShutdownTimeout = mock((callback: () => void, ms: number) => {
			timeoutCallback = callback;
			return { ms, unref } as never;
		});

		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: createMetrics() as never,
			shutdownTimeoutMs: 12_345,
			exitProcess,
			serve: () => ({ port: 4110, stop }),
			setShutdownTimeout,
			clearShutdownTimeout,
		});

		try {
			await lifecycle.requestShutdown({ reason: 'SIGTERM', exitCode: 0, forceExit: true });

			expect(setShutdownTimeout).toHaveBeenCalledWith(expect.any(Function), 12_345);
			expect(unref).toHaveBeenCalledTimes(1);
			expect(exitProcess).not.toHaveBeenCalled();

			await lifecycle.completeShutdown(0);
			expect(clearShutdownTimeout).toHaveBeenCalledTimes(1);
			expect(exitProcess).toHaveBeenCalledWith(0);

			timeoutCallback?.();
			expect(exitProcess).toHaveBeenCalledTimes(1);
		} finally {
			lifecycle.dispose();
		}
	});

	it('does not let a later zero exit code overwrite an earlier failure', async () => {
		const logger = createLogger();
		const stop = mock(() => {});
		const exitProcess = mock(() => {});

		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: createMetrics() as never,
			shutdownTimeoutMs: 12_345,
			exitProcess,
			serve: () => ({ port: 4110, stop }),
		});

		try {
			await lifecycle.requestShutdown({
				reason: 'workerError',
				exitCode: 1,
				forceExit: true,
				error: new Error('boom'),
			});
			await lifecycle.requestShutdown({ reason: 'SIGTERM', exitCode: 0, forceExit: true });

			await lifecycle.completeShutdown();
			expect(exitProcess).toHaveBeenCalledWith(1);
		} finally {
			lifecycle.dispose();
		}
	});

	it('awaits server stop before requestShutdown resolves', async () => {
		const logger = createLogger();
		let resolveStop: (() => void) | undefined;
		const stop = mock(
			() =>
				new Promise<void>((resolve) => {
					resolveStop = resolve;
				})
		);
		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: createMetrics() as never,
			shutdownTimeoutMs: 15_000,
			serve: () => ({ port: 4110, stop }),
		});

		try {
			let resolved = false;
			const shutdown = lifecycle.requestShutdown({ reason: 'manual' }).then(() => {
				resolved = true;
			});
			await Bun.sleep(0);

			expect(stop).toHaveBeenCalledWith(true);
			expect(resolved).toBe(false);

			resolveStop?.();
			await shutdown;
			expect(resolved).toBe(true);
		} finally {
			lifecycle.dispose();
		}
	});

	it('installs a fallback for manual stop paths', async () => {
		const logger = createLogger();
		const stop = mock(() => new Promise<void>(() => {}));
		const exitProcess = mock(() => {});
		const unref = mock(() => {});
		let timeoutCallback: (() => void) | undefined;
		const setShutdownTimeout = mock((callback: () => void, ms: number) => {
			timeoutCallback = callback;
			return { ms, unref } as never;
		});

		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: createMetrics() as never,
			shutdownTimeoutMs: 12_345,
			exitProcess,
			serve: () => ({ port: 4110, stop }),
			setShutdownTimeout,
		});

		try {
			void lifecycle.stop();
			await Bun.sleep(0);

			expect(setShutdownTimeout).toHaveBeenCalledWith(expect.any(Function), 12_345);
			timeoutCallback?.();
			expect(exitProcess).toHaveBeenCalledWith(1);
		} finally {
			lifecycle.dispose();
		}
	});

	it('routes SIGTERM through shutdown', async () => {
		const logger = createLogger();
		const stop = mock(() => {});
		const exitProcess = mock(() => {});

		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: createMetrics() as never,
			shutdownTimeoutMs: 12_345,
			exitProcess,
			serve: () => ({ port: 4110, stop }),
		});

		try {
			process.emit('SIGTERM');
			await Bun.sleep(0);

			expect(stop).toHaveBeenCalledWith(true);
			expect(lifecycle.signal.aborted).toBe(true);
			await lifecycle.completeShutdown();
			expect(exitProcess).toHaveBeenCalledWith(0);
		} finally {
			lifecycle.dispose();
		}
	});

	it('preserves fatal shutdown exit codes through completion', async () => {
		const logger = createLogger();
		const stop = mock(() => {});
		const exitProcess = mock(() => {});

		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: createMetrics() as never,
			shutdownTimeoutMs: 12_345,
			exitProcess,
			serve: () => ({ port: 4110, stop }),
		});

		try {
			await lifecycle.requestShutdown({
				reason: 'uncaughtException',
				exitCode: 1,
				forceExit: true,
				error: new Error('boom'),
			});

			await lifecycle.completeShutdown();
			expect(exitProcess).toHaveBeenCalledWith(1);
		} finally {
			lifecycle.dispose();
		}
	});

	it('does not let completeShutdown lower an earlier fatal exit code', async () => {
		const logger = createLogger();
		const stop = mock(() => {});
		const exitProcess = mock(() => {});

		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: createMetrics() as never,
			shutdownTimeoutMs: 12_345,
			exitProcess,
			serve: () => ({ port: 4110, stop }),
		});

		try {
			await lifecycle.requestShutdown({
				reason: 'uncaughtException',
				exitCode: 1,
				forceExit: true,
				error: new Error('boom'),
			});

			await lifecycle.completeShutdown(0);
			expect(exitProcess).toHaveBeenCalledWith(1);
		} finally {
			lifecycle.dispose();
		}
	});

	it('routes uncaughtException through fatal shutdown', async () => {
		const logger = createLogger();
		const stop = mock(() => {});
		const exitProcess = mock(() => {});

		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: createMetrics() as never,
			shutdownTimeoutMs: 12_345,
			exitProcess,
			serve: () => ({ port: 4110, stop }),
		});

		try {
			process.emit('uncaughtException', new Error('boom'));
			await Bun.sleep(0);

			expect(stop).toHaveBeenCalledWith(true);
			expect(lifecycle.signal.aborted).toBe(true);
			expect(logger.error).toHaveBeenCalledWith(
				'worker shutdown requested after error',
				expect.objectContaining({
					reason: 'uncaughtException',
					error: expect.stringContaining('boom'),
				})
			);
			await lifecycle.completeShutdown();
			expect(exitProcess).toHaveBeenCalledWith(1);
		} finally {
			lifecycle.dispose();
		}
	});

	it('routes unhandledRejection through fatal shutdown', async () => {
		const logger = createLogger();
		const stop = mock(() => {});
		const exitProcess = mock(() => {});

		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: createMetrics() as never,
			shutdownTimeoutMs: 12_345,
			exitProcess,
			serve: () => ({ port: 4110, stop }),
		});

		try {
			process.emit('unhandledRejection', new Error('rejected'), Promise.resolve());
			await Bun.sleep(0);

			expect(stop).toHaveBeenCalledWith(true);
			expect(lifecycle.signal.aborted).toBe(true);
			expect(logger.error).toHaveBeenCalledWith(
				'worker shutdown requested after error',
				expect.objectContaining({
					reason: 'unhandledRejection',
					error: expect.stringContaining('rejected'),
				})
			);
			await lifecycle.completeShutdown();
			expect(exitProcess).toHaveBeenCalledWith(1);
		} finally {
			lifecycle.dispose();
		}
	});

	it('serves debug state and collects metrics before rendering', async () => {
		const logger = createLogger();
		const stop = mock(() => {});
		const collectMetrics = mock(() => {});
		let fetch: ((request: Request) => Response | Promise<Response>) | undefined;
		const metrics = createMetrics();

		const lifecycle = startLifecycleServer({
			port: 4110,
			service: 'unit-test-worker',
			logger,
			metrics: metrics as never,
			shutdownTimeoutMs: 12_345,
			debugState: () => ({ ok: true }),
			collectMetrics,
			serve: (input) => {
				fetch = input.fetch;
				return { port: 4110, stop };
			},
		});

		try {
			const debugResponse = await fetch?.(new Request('http://127.0.0.1/debug/state'));
			expect(await debugResponse?.json()).toEqual({ ok: true });

			await fetch?.(new Request('http://127.0.0.1/metrics'));
			expect(collectMetrics).toHaveBeenCalledTimes(1);
			expect(metrics.renderPrometheus).toHaveBeenCalledTimes(1);
		} finally {
			lifecycle.dispose();
		}
	});
});
