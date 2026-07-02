import { CircuitBreaker } from './shared/circuit-breaker';
import { loadWorkerConfig } from './shared/config';
import { classifyWorkerError, WorkerConfigurationError } from './shared/errors';
import { startLifecycleServer } from './shared/lifecycle';
import { createLogger } from './shared/logger';
import { WorkerMetrics } from './shared/metrics';
import { runSupervised } from './shared/supervisor';
import { Heartbeat, startHeartbeatWatchdog } from './shared/watchdog';

const [mode, ...args] = process.argv.slice(2);
const config = loadWorkerConfig();
const logger = createLogger({
	worker: mode ?? 'unknown',
	workerId: config.workerId,
});
const metrics = new WorkerMetrics();

type KgWorkerMode = 'kg-parse-worker' | 'kg-classification-worker' | 'kg-enrichment-worker';

type DependencyCircuit = {
	dependency: string;
	circuit: CircuitBreaker;
};

type KgWorkerCircuits = {
	database: CircuitBreaker;
	runtime: CircuitBreaker;
	all: DependencyCircuit[];
};

async function main() {
	if (
		mode === 'kg-parse-worker' ||
		mode === 'kg-classification-worker' ||
		mode === 'kg-enrichment-worker'
	) {
		await runKgWorkerMode(mode);
		return;
	}

	if (mode?.startsWith('kg-')) {
		assertKgEnv(config.env, mode);
		const { createEnvKgConnection } = await import('@0xintuition/database-kg/client-env');
		const connection = createEnvKgConnection(config.env);
		try {
			const { runKgCommand } = await import('./kg/commands');
			await runKgCommand(connection.db, [mode, ...args]);
		} finally {
			await connection.close();
		}
		return;
	}

	throw new WorkerConfigurationError(
		`Unknown worker mode "${mode ?? '<none>'}". Supported modes: kg-parse-worker, kg-classification-worker, kg-enrichment-worker, and kg-* maintenance commands.`
	);
}

async function runKgWorkerMode(workerMode: KgWorkerMode): Promise<void> {
	const isParseWorker = workerMode === 'kg-parse-worker';
	const isClassificationWorker = workerMode === 'kg-classification-worker';
	const heartbeat = new Heartbeat(workerMode);
	const circuits = createKgDependencyCircuits(workerMode);
	const collectMetrics = () => collectRuntimeMetrics(workerMode, heartbeat, circuits);
	const lifecycle = startLifecycleServer({
		port: isParseWorker
			? config.parseHealthPort
			: isClassificationWorker
				? config.classificationHealthPort
				: config.enrichmentHealthPort,
		service: workerMode,
		logger,
		metrics,
		shutdownTimeoutMs: config.shutdownTimeoutMs,
		debugState: () => ({
			service: workerMode,
			workerId: config.workerId,
			heartbeat: heartbeat.snapshot(),
			circuits: circuits.all.map((entry) => ({
				dependency: entry.dependency,
				...entry.circuit.snapshot(),
			})),
		}),
		collectMetrics,
	});
	metrics.setWatchdogTimedOut(workerMode, false);
	const stopWatchdog = startHeartbeatWatchdog({
		heartbeat,
		logger,
		signal: lifecycle.signal,
		intervalMs: config.watchdogIntervalMs,
		timeoutMs: config.watchdogTimeoutMs,
		onTimeout: (ageMs) => {
			metrics.incrementWatchdogTimeout(workerMode);
			metrics.setWatchdogTimedOut(workerMode, true);
			void lifecycle.requestShutdown({
				reason: 'watchdog',
				exitCode: 1,
				forceExit: true,
				error: new Error(`Worker heartbeat stale for ${ageMs}ms.`),
			});
		},
		onRecovery: () => metrics.setWatchdogTimedOut(workerMode, false),
	});

	try {
		assertKgEnv(config.env, workerMode);
		await runSupervised({
			name: workerMode,
			signal: lifecycle.signal,
			logger,
			baseDelayMs: config.retryBaseMs,
			maxDelayMs: config.retryMaxMs,
			onRestart: ({ errorClass }) => {
				metrics.incrementSupervisorRestart({ worker: workerMode, errorClass });
			},
			run: async () => {
				// Defer importing KG modules until we know we are running a KG worker so
				// command invocations do not pay the startup cost of loading the
				// Drizzle schemas and database-kg client validators.
				const { createEnvKgConnection } = await import('@0xintuition/database-kg/client-env');
				const connection = createEnvKgConnection(config.env);
				// /readyz reflects "the worker can actually do work". The KG connection
				// is created above; flipping ready only after that runs avoids reporting
				// healthy while the connection setup throws (bad URL, validator error,
				// future async pool init, etc.).
				lifecycle.setReady(true);
				try {
					if (isParseWorker) {
						const { runKgParsingWorker } = await import('./kg/atom-parsing');
						await runKgParsingWorker({
							db: connection.db,
							config,
							logger,
							metrics,
							signal: lifecycle.signal,
							heartbeat,
							circuits,
						});
					} else if (isClassificationWorker) {
						const { runKgClassificationWorker } = await import('./kg/atom-classification');
						await runKgClassificationWorker({
							db: connection.db,
							config,
							logger,
							metrics,
							signal: lifecycle.signal,
							heartbeat,
							circuits,
						});
					} else {
						const { runKgEnrichmentWorker } = await import('./kg/atom-enrichment');
						await runKgEnrichmentWorker({
							db: connection.db,
							config,
							logger,
							metrics,
							signal: lifecycle.signal,
							heartbeat,
							circuits,
						});
					}
				} finally {
					lifecycle.setReady(false);
					try {
						await connection.close();
					} catch (closeError) {
						logger.warn('kg connection close failed during shutdown', {
							service: workerMode,
							error: formatError(closeError),
						});
					}
				}
			},
		});
	} catch (error) {
		if (lifecycle.isShuttingDown()) {
			logger.warn('kg worker stopped after shutdown request', {
				service: workerMode,
				error: formatError(error),
			});
			return;
		}
		await lifecycle.requestShutdown({
			reason: 'workerError',
			exitCode: 1,
			forceExit: true,
			error,
		});
	} finally {
		stopWatchdog();
		await lifecycle.stop('workerCompleted');
		await lifecycle.completeShutdown();
		lifecycle.dispose();
	}
}

function createKgDependencyCircuits(workerMode: KgWorkerMode): KgWorkerCircuits {
	const database = createCircuit(workerMode, 'database-kg');
	const runtime = createCircuit(workerMode, runtimeDependencyFor(workerMode));

	return {
		database: database.circuit,
		runtime: runtime.circuit,
		all: [database, runtime],
	};
}

function createCircuit(workerMode: KgWorkerMode, dependency: string): DependencyCircuit {
	return {
		dependency,
		circuit: new CircuitBreaker({
			name: `${workerMode}:${dependency}`,
			failureThreshold: config.circuitFailureThreshold,
			resetAfterMs: config.circuitResetMs,
			shouldRecordFailure: (error) => classifyWorkerError(error).class === 'circuitProtected',
		}),
	};
}

function runtimeDependencyFor(workerMode: KgWorkerMode): string {
	switch (workerMode) {
		case 'kg-parse-worker':
			return 'atom-parser';
		case 'kg-classification-worker':
			return 'classification-runtime';
		case 'kg-enrichment-worker':
			return 'enrichment-runtime';
		default:
			return workerMode satisfies never;
	}
}

function collectRuntimeMetrics(
	service: KgWorkerMode,
	heartbeat: Heartbeat,
	circuits: KgWorkerCircuits
): void {
	metrics.setHeartbeat(service, heartbeat.snapshot());
	for (const entry of circuits.all) {
		metrics.setCircuitBreaker({
			worker: service,
			dependency: entry.dependency,
			snapshot: entry.circuit.snapshot(),
		});
	}
}

function assertKgEnv(env: Record<string, string | undefined>, kgMode: string): void {
	if (!env.DATABASE_KG_URL || env.DATABASE_KG_URL.trim().length === 0) {
		throw new WorkerConfigurationError(
			`KG worker mode "${kgMode}" requires DATABASE_KG_URL to be set. Provide it in the worker environment (see example.env at the repo root) before starting the worker.`
		);
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
	logger.error('worker process failed', {
		error: formatError(error),
	});
	process.exitCode = 1;
});
