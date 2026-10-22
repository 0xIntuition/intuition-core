import { expect, test } from 'bun:test';
import type { KgActionDb } from '@0xintuition/database-kg/actions';
import { runKgClassificationWorker } from '../kg/atom-classification';
import { runKgEnrichmentWorker } from '../kg/atom-enrichment';
import { runKgParsingWorker } from '../kg/atom-parsing';
import { CircuitBreaker } from '../shared/circuit-breaker';
import { loadWorkerConfig } from '../shared/config';
import { WorkerConfigurationError } from '../shared/errors';
import type { Logger } from '../shared/logger';
import { WorkerMetrics } from '../shared/metrics';
import { Heartbeat } from '../shared/watchdog';
import { parseAtomWithIidRead } from './iid-inspection';
import { assertIidPackageVersions, createWorkerIdentityRuntime } from './worker-bootstrap';

const logger: Logger = { info() {}, warn() {}, error() {}, debug() {}, child: () => logger };

for (const run of [runKgParsingWorker, runKgClassificationWorker, runKgEnrichmentWorker]) {
	test(`${run.name} starts with WORKERS_IID_READ_ENABLED=true`, async () => {
		const config = loadWorkerConfig({
			...process.env,
			WORKERS_IID_READ_ENABLED: 'true',
			WORKERS_CACHE_PROVIDER: 'none',
		});
		const runtime = createWorkerIdentityRuntime(config.iidReadEnabled);
		expect(runtime.iidInspection).toBeDefined();
		expect(runtime.iidRegistry).toBeDefined();
		expect(runtime.iidLadder).toBeDefined();
		const controller = new AbortController();
		controller.abort();
		// Exercise real stage initialization and runtime construction, then stop before polling.
		const db = {
			update: () => ({ set: () => ({ where: () => ({ returning: async () => [] }) }) }),
		} as unknown as KgActionDb;
		await expect(
			run({
				...runtime,
				db,
				config,
				logger,
				signal: controller.signal,
				metrics: new WorkerMetrics(),
				heartbeat: new Heartbeat('bootstrap-test'),
				circuits: {
					database: new CircuitBreaker({
						name: 'database',
						failureThreshold: 5,
						resetAfterMs: 1000,
					}),
					runtime: new CircuitBreaker({ name: 'runtime', failureThreshold: 5, resetAfterMs: 1000 }),
				},
			})
		).resolves.toBeUndefined();
	});
}

test('installed IID packages parse, classify, plan, and project a real IID', async () => {
	const runtime = createWorkerIdentityRuntime(true);
	const { result } = await parseAtomWithIidRead({
		rawInput: 'int:isrc:USUM71703861',
		iidReadEnabled: true,
		adapter: runtime.iidInspection,
		parseLegacy: () => {
			throw new Error('Unexpected legacy parsing');
		},
	});
	expect(result.identity).toBeDefined();
	const identity = result.identity!;
	const resolution = runtime.iidRegistry!.resolve(identity);
	expect(resolution.identityDecision.schemaType).toBe('MusicRecording');
	expect(resolution.providerPlan.targets.length).toBeGreaterThan(0);
	expect(
		runtime.iidLadder!.projectIdentityRungs({ identity, schemaType: 'MusicRecording' }).primary?.iid
	).toBe(identity.canonical);
	expect(runtime.iidLadder!.resolveWikidataSchemaType?.(['Q11424'])).toBe('Movie');
	expect(createWorkerIdentityRuntime(false)).toEqual({});
});

test('bootstrap rejects missing, substituted, ranged, and wrong exact installed versions', () => {
	const names = ['@0xintuition/iid', '@0xintuition/iid-registry', '@0xintuition/iid-ladder'];
	const manifests = names.map((name) => ({ name, version: '0.1.0-alpha.0' }));
	expect(() => assertIidPackageVersions()).not.toThrow();
	for (let index = 0; index < manifests.length; index++) {
		for (const version of ['*', '^0.1.0', 'workspace:*', '0.1.0-alpha.1']) {
			expect(() =>
				assertIidPackageVersions(
					manifests.map((manifest, i) => (i === index ? { ...manifest, version } : manifest))
				)
			).toThrow(WorkerConfigurationError);
		}
		expect(() => assertIidPackageVersions(manifests.filter((_, i) => i !== index))).toThrow(
			WorkerConfigurationError
		);
		expect(() =>
			assertIidPackageVersions(
				manifests.map((manifest, i) =>
					i === index ? { ...manifest, name: '@other/iid' } : manifest
				)
			)
		).toThrow(WorkerConfigurationError);
	}
});
