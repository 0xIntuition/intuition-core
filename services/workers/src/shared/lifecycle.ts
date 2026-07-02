import type { Logger } from './logger';
import type { WorkerMetrics } from './metrics';

export type ShutdownReason =
	| 'SIGINT'
	| 'SIGTERM'
	| 'manual'
	| 'workerCompleted'
	| 'watchdog'
	| 'workerError'
	| 'uncaughtException'
	| 'unhandledRejection';

type LifecycleStopReason = 'manual' | 'workerCompleted';

type ShutdownRequest = {
	reason: ShutdownReason;
	exitCode?: number;
	forceExit?: boolean;
	error?: unknown;
};

type TimeoutHandle = ReturnType<typeof setTimeout> & {
	unref?: () => void;
};

type LifecycleServer = {
	port?: number;
	stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

type Serve = (input: {
	port: number;
	fetch: (request: Request) => Response | Promise<Response>;
}) => LifecycleServer;

export type WorkerLifecycle = {
	signal: AbortSignal;
	isShuttingDown: () => boolean;
	requestShutdown: (request: ShutdownRequest) => Promise<void>;
	completeShutdown: (exitCode?: number) => Promise<void>;
	setReady: (ready: boolean) => void;
	stop: (reason?: LifecycleStopReason) => Promise<void>;
	dispose: () => void;
};

export function startLifecycleServer(input: {
	port: number;
	service: string;
	logger: Logger;
	metrics: WorkerMetrics;
	shutdownTimeoutMs: number;
	debugState?: () => unknown;
	collectMetrics?: () => void;
	exitProcess?: (code: number) => void;
	serve?: Serve;
	setShutdownTimeout?: (callback: () => void, ms: number) => TimeoutHandle;
	clearShutdownTimeout?: (handle: TimeoutHandle) => void;
}): WorkerLifecycle {
	const controller = new AbortController();
	const exitProcess = input.exitProcess ?? ((code: number) => process.exit(code));
	const serve: Serve = input.serve ?? ((serverInput) => Bun.serve(serverInput));
	const setShutdownTimeout =
		input.setShutdownTimeout ??
		((callback: () => void, ms: number) => setTimeout(callback, ms) as TimeoutHandle);
	const clearShutdownTimeout =
		input.clearShutdownTimeout ??
		((handle: TimeoutHandle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
	let ready = false;
	let shutdownPromise: Promise<void> | undefined;
	let fallbackTimer: TimeoutHandle | undefined;
	let shouldExitOnComplete = false;
	let requestedExitCode = 0;
	const shutdownReasons = new Set<ShutdownReason>();

	const server = serve({
		port: input.port,
		fetch: (request) => {
			const url = new URL(request.url);
			if (url.pathname === '/healthz') {
				return Response.json({
					ok: true,
					service: input.service,
					status: 'healthy',
					timestamp: new Date().toISOString(),
				});
			}

			if (url.pathname === '/readyz') {
				return Response.json(
					{
						ok: ready,
						service: input.service,
						status: ready ? 'ready' : 'starting',
						timestamp: new Date().toISOString(),
					},
					{ status: ready ? 200 : 503 }
				);
			}

			if (url.pathname === '/metrics') {
				input.collectMetrics?.();
				return new Response(input.metrics.renderPrometheus(), {
					headers: { 'content-type': 'text/plain; version=0.0.4' },
				});
			}

			if (url.pathname === '/debug/state') {
				// Assumes this health port is cluster-internal. Do not expose it to public ingress.
				return Response.json(input.debugState?.() ?? {});
			}

			return new Response('not found', { status: 404 });
		},
	});

	const clearFallback = () => {
		if (!fallbackTimer) {
			return;
		}
		clearShutdownTimeout(fallbackTimer);
		fallbackTimer = undefined;
	};

	const installFallback = () => {
		if (fallbackTimer) {
			return;
		}
		const timer = setShutdownTimeout(() => {
			if (fallbackTimer !== timer) {
				return;
			}
			input.logger.error('worker shutdown timeout, forcing exit', {
				service: input.service,
				reasons: [...shutdownReasons],
				timeoutMs: input.shutdownTimeoutMs,
			});
			exitProcess(1);
		}, input.shutdownTimeoutMs);
		fallbackTimer = timer;
		fallbackTimer.unref?.();
	};

	const formatShutdownError = (error: unknown): string => {
		if (error instanceof Error) {
			return error.stack ?? error.message;
		}
		return String(error);
	};

	const requestShutdown = async (request: ShutdownRequest): Promise<void> => {
		shutdownReasons.add(request.reason);
		if (request.exitCode !== undefined && request.exitCode > requestedExitCode) {
			requestedExitCode = request.exitCode;
		}
		shouldExitOnComplete = shouldExitOnComplete || Boolean(request.forceExit);
		installFallback();

		if (shutdownPromise) {
			if (request.error) {
				input.logger.warn('worker shutdown already in progress after another error', {
					service: input.service,
					reason: request.reason,
					error: formatShutdownError(request.error),
				});
			} else {
				input.logger.debug('worker shutdown already in progress', {
					service: input.service,
					reason: request.reason,
				});
			}
			return shutdownPromise;
		}

		shutdownPromise = (async () => {
			ready = false;
			if (request.error) {
				input.logger.error('worker shutdown requested after error', {
					service: input.service,
					reason: request.reason,
					error: formatShutdownError(request.error),
				});
			} else {
				input.logger.info('worker shutdown requested', {
					service: input.service,
					reason: request.reason,
				});
			}
			controller.abort();
			await server.stop(true);
		})();

		return shutdownPromise;
	};

	const onSigint = () => {
		void requestShutdown({ reason: 'SIGINT', exitCode: 0, forceExit: true });
	};
	const onSigterm = () => {
		void requestShutdown({ reason: 'SIGTERM', exitCode: 0, forceExit: true });
	};
	const onUncaughtException = (error: Error) => {
		void requestShutdown({
			reason: 'uncaughtException',
			exitCode: 1,
			forceExit: true,
			error,
		});
	};
	const onUnhandledRejection = (reason: unknown) => {
		void requestShutdown({
			reason: 'unhandledRejection',
			exitCode: 1,
			forceExit: true,
			error: reason,
		});
	};

	// NOTE: worker processes create one lifecycle server. Tests that create
	// lifecycles in-process must call dispose() so process-level handlers do not
	// leak between cases.
	process.on('SIGINT', onSigint);
	process.on('SIGTERM', onSigterm);
	process.on('uncaughtException', onUncaughtException);
	process.on('unhandledRejection', onUnhandledRejection);

	input.logger.info('worker lifecycle server started', {
		service: input.service,
		port: server.port,
	});

	return {
		signal: controller.signal,
		isShuttingDown: () => Boolean(shutdownPromise),
		requestShutdown,
		completeShutdown: async (exitCode) => {
			if (shutdownPromise) {
				await shutdownPromise;
			}
			clearFallback();
			if (shouldExitOnComplete) {
				exitProcess(Math.max(exitCode ?? 0, requestedExitCode));
			}
		},
		setReady: (value) => {
			ready = value;
		},
		stop: async (reason = 'manual') => {
			if (shutdownPromise) {
				await shutdownPromise;
				clearFallback();
				return;
			}
			await requestShutdown({ reason });
			clearFallback();
		},
		dispose: () => {
			process.off('SIGINT', onSigint);
			process.off('SIGTERM', onSigterm);
			process.off('uncaughtException', onUncaughtException);
			process.off('unhandledRejection', onUnhandledRejection);
			clearFallback();
		},
	};
}
