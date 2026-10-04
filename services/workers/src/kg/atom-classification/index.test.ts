import { expect, test } from 'bun:test';
import type { KgActionDb } from '@0xintuition/database-kg/actions';
import type { IdentityRungProjection } from '../../core/identity-contract';
import type { IidLadderAdapter } from '../../core/iid-ladder';
import { CircuitBreaker } from '../../shared/circuit-breaker';
import { loadWorkerConfig } from '../../shared/config';
import { WorkerConfigurationError } from '../../shared/errors';
import type { Logger } from '../../shared/logger';
import { WorkerMetrics } from '../../shared/metrics';
import { Heartbeat } from '../../shared/watchdog';
import { runKgClassificationWorker } from './index';

const provenance = { producer: 'fake-ladder', version: '1.2.3' };
const registry = {
	resolve: () => ({
		identityDecision: { status: 'classified' as const, schemaType: 'Book', provenance },
		providerPlan: { status: 'unsupported' as const, targets: [], provenance },
	}),
};
const identity = {
	raw: 'isbn',
	canonical: 'int:isbn:9780684832722',
	scheme: 'isbn',
	value: '9780684832722',
	anchorEligible: true,
	provenance,
};
const projection: IdentityRungProjection = {
	primary: { rung: 'isbn', iid: identity.canonical },
	rungs: [],
	provenance,
};
const ladder: IidLadderAdapter = {
	projectIdentityRungs: () => projection,
	isPlainWdPrimaryAllowed: () => false,
};
const logger: Logger = { info() {}, warn() {}, error() {}, debug() {}, child: () => logger };

function harness(
	options: {
		enabled?: boolean;
		iid?: string | null;
		ladder?: IidLadderAdapter;
		structured?: boolean;
	} = {}
) {
	const controller = new AbortController();
	let completion: Record<string, unknown> | undefined;
	let selections = 0;
	const node = {
		id: `0x${'11'.repeat(32)}`,
		parseStatus: 'completed',
		iid: options.iid ?? null,
		classificationAttempts: 1,
		processingMeta: { classificationRunId: 'fixture-run' },
		data: null,
		dataHex: null,
		parseResult: options.structured
			? {
					kind: 'json',
					normalizedInput: '{}',
					structuredDocument: {
						source: 'inline_json',
						format: 'jsonld',
						topLevelType: 'object',
						schemaType: 'Book',
						data: { '@type': 'Book' },
						urlCandidates: [],
					},
				}
			: { kind: 'iid', normalizedInput: identity.canonical, identity },
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
		update() {
			return {
				set(patch: Record<string, unknown>) {
					return {
						where() {
							return {
								async returning() {
									if (
										patch.classificationStatus === 'completed' ||
										patch.classificationStatus === 'failed'
									) {
										completion = patch;
										controller.abort();
									}
									return [node];
								},
							};
						},
					};
				},
			};
		},
	} as unknown as KgActionDb;
	const config = loadWorkerConfig({
		WORKERS_IID_READ_ENABLED: options.enabled === false ? 'false' : 'true',
		WORKERS_CACHE_PROVIDER: 'none',
	});
	const input = {
		db,
		config,
		logger,
		metrics: new WorkerMetrics(),
		signal: controller.signal,
		heartbeat: new Heartbeat('fixture'),
		circuits: {
			database: new CircuitBreaker({ name: 'database', failureThreshold: 5, resetAfterMs: 1000 }),
			runtime: new CircuitBreaker({ name: 'runtime', failureThreshold: 5, resetAfterMs: 1000 }),
		},
		iidRegistry: registry,
		iidLadder: options.ladder,
	};
	return { input, controller, completion: () => completion };
}

test('fails closed at startup when IID reads lack the ladder adapter', async () => {
	const fixture = harness();
	fixture.controller.abort();
	await expect(runKgClassificationWorker(fixture.input)).rejects.toThrow(WorkerConfigurationError);
});

test('persists the projection and promotes a primary when nodes.iid is null', async () => {
	const fixture = harness({ ladder });
	await runKgClassificationWorker(fixture.input);
	expect(fixture.completion()).toMatchObject({
		classificationStatus: 'completed',
		iid: identity.canonical,
		classificationResult: { identityRungs: projection },
	});
});

test('never overwrites an existing node IID', async () => {
	const fixture = harness({ ladder, iid: 'int:isbn:9780140328721' });
	await runKgClassificationWorker(fixture.input);
	expect(fixture.completion()?.classificationStatus).toBe('completed');
	expect(Object.hasOwn(fixture.completion() ?? {}, 'iid')).toBe(false);
});

test('plain wd promotion requires module admission', async () => {
	for (const allowed of [false, true]) {
		const wdProjection = { ...projection, primary: { rung: 'wd', iid: 'int:wd:Q42' } };
		const fixture = harness({
			ladder: {
				projectIdentityRungs: () =>
					allowed ? wdProjection : { ...projection, primary: undefined },
				isPlainWdPrimaryAllowed: () => {
					throw new Error('worker must rely on adapter admission');
				},
			},
		});
		await runKgClassificationWorker(fixture.input);
		expect(fixture.completion()?.classificationStatus).toBe('completed');
		expect(fixture.completion()?.iid).toBe(allowed ? 'int:wd:Q42' : undefined);
	}
});

test('promotes an adapter-admitted typed WD without a second plain-WD policy check', async () => {
	const fixture = harness({
		ladder: {
			projectIdentityRungs: () => ({
				...projection,
				primary: { rung: 'wd', iid: 'int:wd:film:Q83495' },
			}),
			isPlainWdPrimaryAllowed: () => false,
		},
	});
	await runKgClassificationWorker(fixture.input);
	expect(fixture.completion()?.classificationStatus).toBe('completed');
	expect(fixture.completion()?.iid).toBe('int:wd:film:Q83495');
});

test.each([
	{ primary: projection.primary, provenance },
	{ ...projection, rungs: [{ rung: 'isbn', value: '9780684832722', aliasOnly: 'false' }] },
])('finding 4: malformed adapter projection %# is absent and never promoted', async (malformed) => {
	const fixture = harness({
		ladder: { ...ladder, projectIdentityRungs: () => malformed as IdentityRungProjection },
	});
	await runKgClassificationWorker(fixture.input);
	expect(fixture.completion()?.classificationStatus).toBe('completed');
	expect(Object.hasOwn(fixture.completion() ?? {}, 'iid')).toBe(false);
	expect(
		(fixture.completion()?.classificationResult as Record<string, unknown>).identityRungs
	).toBeUndefined();
});

test('flag off keeps the structured legacy path unchanged even with an injected ladder', async () => {
	const fixture = harness({
		enabled: false,
		structured: true,
		ladder: {
			...ladder,
			projectIdentityRungs: () => {
				throw new Error('legacy must not call ladder');
			},
		},
	});
	await runKgClassificationWorker(fixture.input);
	expect(fixture.completion()?.classificationStatus).toBe('completed');
	expect(Object.hasOwn(fixture.completion() ?? {}, 'iid')).toBe(false);
	expect(
		(fixture.completion()?.classificationResult as Record<string, unknown>).identityRungs
	).toBeUndefined();
});

test('projects structured classifications under the IID flag', async () => {
	const fixture = harness({ structured: true, ladder });
	await runKgClassificationWorker(fixture.input);
	expect(fixture.completion()).toMatchObject({
		classificationStatus: 'completed',
		classificationResult: { identityRungs: projection },
	});
});
