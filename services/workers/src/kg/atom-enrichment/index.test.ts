import { expect, spyOn, test } from 'bun:test';
import type { EnrichmentPluginContext } from '@0xintuition/atom-enrichment';
import {
	createMockArtifact,
	createMockPlugin,
	createMockRequest,
} from '@0xintuition/atom-enrichment/testing';
import * as runtimeModule from '@0xintuition/atom-services/runtime';
import type { KgActionDb } from '@0xintuition/database-kg/actions';
import type { IidLadderAdapter } from '../../core/iid-ladder';
import { CircuitBreaker } from '../../shared/circuit-breaker';
import { loadWorkerConfig } from '../../shared/config';
import { WorkerConfigurationError } from '../../shared/errors';
import type { Logger } from '../../shared/logger';
import { WorkerMetrics } from '../../shared/metrics';
import { Heartbeat } from '../../shared/watchdog';
import { runKgEnrichmentWorker } from './index';

const createRuntime = runtimeModule.createEnrichmentRuntime;
const logger: Logger = { info() {}, warn() {}, error() {}, debug() {}, child: () => logger };

test('identity docs describe the worker forwarding and C14 entrypoint boundary', async () => {
	for (const name of ['configuration.md', 'writing-an-enrichment-plugin.md']) {
		const doc = await Bun.file(new URL(`../../../../../docs/${name}`, import.meta.url)).text();
		expect(doc).not.toContain('CORE-T2C-REPORT.md');
		expect(doc).not.toContain('pending outside the T2c file fence');
		expect(doc).not.toContain('production runtime still needs to forward');
		expect(doc).toContain('enrichment worker composes the capability');
		expect(doc).toContain('C14 composition boundary');
	}
});

function harness(enabled: boolean, iidLadder?: IidLadderAdapter) {
	const controller = new AbortController();
	let selections = 0;
	let writes = 0;
	let completion: Record<string, unknown> | undefined;
	const node = {
		id: `0x${'11'.repeat(32)}`,
		parseStatus: 'completed',
		classificationStatus: 'completed',
		enrichmentAttempts: 1,
		processingMeta: { enrichmentRunId: 'fixture-run' },
		data: null,
		dataHex: null,
		classificationResult: {
			status: 'recognized',
			source: 'inline_json',
			schemaType: 'Movie',
			category: 'thing',
		},
		parseResult: {
			kind: 'json',
			normalizedInput: '{}',
			structuredDocument: {
				source: 'inline_json',
				format: 'jsonld',
				topLevelType: 'object',
				schemaType: 'Movie',
				data: { '@type': 'Movie', name: 'Shared title' },
				urlCandidates: [],
			},
		},
	};
	const db = {
		async transaction<T>(run: (tx: KgActionDb) => Promise<T>) {
			return run(db as unknown as KgActionDb);
		},
		select() {
			const selection = ++selections;
			const query = {
				from: () => query,
				where: () => query,
				orderBy: () => query,
				limit: async () => (selection === 1 ? [] : [node]),
			};
			return query;
		},
		insert() {
			return { values: () => ({ onConflictDoUpdate: () => ({ returning: async () => [] }) }) };
		},
		update() {
			writes++;
			return {
				set(patch: Record<string, unknown>) {
					return {
						where: () => ({
							returning: async () => {
								if (['completed', 'failed', 'skipped'].includes(String(patch.enrichmentStatus))) {
									completion = patch;
									controller.abort();
								}
								return [node];
							},
						}),
					};
				},
			};
		},
	} as unknown as KgActionDb;
	return {
		controller,
		completion: () => completion,
		selections: () => selections,
		writes: () => writes,
		input: {
			db,
			config: loadWorkerConfig({
				WORKERS_IID_READ_ENABLED: String(enabled),
				WORKERS_CACHE_PROVIDER: 'none',
			}),
			logger,
			metrics: new WorkerMetrics(),
			signal: controller.signal,
			heartbeat: new Heartbeat('fixture'),
			circuits: {
				database: new CircuitBreaker({ name: 'database', failureThreshold: 5, resetAfterMs: 1000 }),
				runtime: new CircuitBreaker({ name: 'runtime', failureThreshold: 5, resetAfterMs: 1000 }),
			},
			iidLadder,
		},
	};
}

test('runtime forwards identity per engine without leaking it to subsequent engines', async () => {
	const runtime = createRuntime({
		defaultPreset: 'default',
		cacheProvider: 'none',
		memoryCacheMaxEntries: 10,
		classificationMemoryCacheMaxEntries: 10,
		classificationResolverCacheTtlMs: 1000,
		cacheHttpTimeoutMs: 1000,
		env: {},
	});
	const contexts: EnrichmentPluginContext[] = [];
	runtime.presetFactories.default = () => [
		createMockPlugin({
			enrich: async (_request, ctx) => {
				contexts.push(ctx);
				return [];
			},
		}),
	];
	const identity = { fingerprint: 'test-policy@1', resolveWikidataSchemaType: () => 'Movie' };
	await runtime.createEngine('default', { identity }).enrich(createMockRequest());
	await runtime.createEngine('default').enrich(createMockRequest());
	expect(contexts).toHaveLength(2);
	expect(contexts[0]?.identity).toBe(identity);
	expect(contexts[1]?.identity).toBeUndefined();
	expect(Object.hasOwn(contexts[1] ?? {}, 'identity')).toBe(false);
});

test('enrichment fails closed before runtime creation or processing when IID reads lack a ladder', async () => {
	const fixture = harness(true);
	fixture.controller.abort();
	const runtimeSpy = spyOn(runtimeModule, 'createEnrichmentRuntime');
	try {
		await expect(runKgEnrichmentWorker(fixture.input)).rejects.toThrow(WorkerConfigurationError);
		await expect(runKgEnrichmentWorker(fixture.input)).rejects.toThrow(
			'WORKERS_IID_READ_ENABLED requires an @0xintuition/iid-ladder adapter for IID enrichment.'
		);
		expect(runtimeSpy).not.toHaveBeenCalled();
		expect(fixture.selections()).toBe(0);
		expect(fixture.writes()).toBe(0);
	} finally {
		runtimeSpy.mockRestore();
	}
});

test.each([
	true,
	false,
])('worker preset plugin receives identity only with reads enabled (%s)', async (enabled) => {
	const contexts: EnrichmentPluginContext[] = [];
	const p31Calls: string[][] = [];
	const ladder: IidLadderAdapter = {
		wikidataTypeProvenance: {
			producer: '@0xintuition/iid-ladder/resolveWikidataP31Identity',
			version: '1.2.3',
		},
		projectIdentityRungs: () => {
			throw new Error('not used in enrichment');
		},
		isPlainWdPrimaryAllowed: () => false,
		resolveWikidataSchemaType(p31) {
			expect(this).toBe(ladder);
			p31Calls.push(p31);
			return 'Movie';
		},
	};
	const fixture = harness(enabled, ladder);
	const runtimeSpy = spyOn(runtimeModule, 'createEnrichmentRuntime').mockImplementation(
		(options) => {
			const runtime = createRuntime(options);
			runtime.presetFactories.default = () => [
				createMockPlugin({
					id: 'wikipedia',
					artifactTypes: ['wikipedia'],
					enrich: async (_request, ctx) => {
						contexts.push(ctx);
						ctx.identity?.resolveWikidataSchemaType(['Q11424']);
						return [
							createMockArtifact({
								artifact_type: 'wikipedia',
								data: {
									title: 'Shared title',
									extract: 'Fixture film',
									language: 'en',
									pageUrl: 'https://en.wikipedia.org/wiki/Shared_title',
								},
							}),
						];
					},
				}),
			];
			return runtime;
		}
	);
	try {
		await runKgEnrichmentWorker(fixture.input);
		expect(contexts).toHaveLength(1);
		expect(Boolean(contexts[0]?.identity)).toBe(enabled);
		expect(Object.hasOwn(contexts[0] ?? {}, 'identity')).toBe(enabled);
		expect(p31Calls).toEqual(enabled ? [['Q11424']] : []);
		expect(fixture.completion()).toMatchObject({ enrichmentStatus: 'completed' });
	} finally {
		runtimeSpy.mockRestore();
		fixture.controller.abort();
	}
});

test('changelog records completed forwarding and C14 composition', async () => {
	const text = await Bun.file(new URL('../../../../../CHANGELOG.md', import.meta.url)).text();
	expect(text).not.toContain('production runtime forwarding remains pending');
	expect(text).toContain(
		'worker and runtime forwarding are complete under `WORKERS_IID_READ_ENABLED`'
	);
	expect(text).toContain('worker entrypoint wires adapters at the C14 composition boundary');
});
