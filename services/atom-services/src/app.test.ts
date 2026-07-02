import { describe, expect, it, mock } from 'bun:test';
import { getDefaultEnhancementPolicy } from '@0xintuition/atom-classification';
import { createAtomServicesApp } from './app';
import { loadServiceConfig } from './config';
import {
	classifyResponseSchema,
	type EnrichRequest,
	enrichResponseSchema,
	type ProcessCoreResponse,
	type ProcessRequest,
	processResponseSchema,
} from './contracts';
import { MetricsRegistry } from './metrics';
import type { ServiceDependencies } from './service/dependencies';

const FIXED_NOW = '2026-02-11T00:00:00.000Z';

const classificationResultFixture = classifyResponseSchema.parse({
	ok: true,
	status: 'complete',
	contractVersion: 'cpkg-01',
	runtime: 'server',
	mode: 'progressive',
	classificationSessionId: 'session-123',
	policy: getDefaultEnhancementPolicy('progressive'),
	message: 'Classification complete',
	receivedAt: FIXED_NOW,
	resolved: {
		resolverId: 'resolver-default',
		resolverChain: ['resolver-default'],
		dedupeKey: 'org:acme',
		fallbackUsed: false,
		atoms: [
			{
				schemaType: 'Organization',
				category: 'company',
				title: 'Acme Corp',
				sameAs: ['https://acme.example'],
				source: 'resolver-default',
				data: {},
			},
		],
	},
	debug: {
		inputPreview: 'https://acme.example',
		hasClientHints: false,
		requestedPluginIds: [],
		requestedServerTiers: [2, 3],
	},
});

const enrichmentResultFixture = enrichResponseSchema.parse({
	status: 'success',
	artifacts: [
		{
			artifact_type: 'opengraph',
			data: {
				title: 'Acme Corp',
			},
			meta: {
				pluginId: 'opengraph',
				provider: 'opengraph',
				fetchedAt: FIXED_NOW,
			},
		},
	],
	errors: [],
	skipped: [],
	timings: {
		startedAt: FIXED_NOW,
		finishedAt: FIXED_NOW,
		durationMs: 0,
		perPluginMs: {
			opengraph: 0,
		},
		cacheHits: 0,
		cacheMisses: 1,
	},
	traceId: 'trace-123',
});

function createMockDependencies(overrides?: {
	process?: ProcessCoreResponse;
}): ServiceDependencies {
	const processOutput: ProcessCoreResponse = overrides?.process ?? {
		runId: 'run-1',
		status: 'success',
		mode: 'process',
		classification: classificationResultFixture,
		enrichment: enrichmentResultFixture,
		timings: {
			totalMs: 14,
			classifyMs: 4,
			enrichMs: 10,
		},
		observability: {
			phases: {
				totalMs: 14,
				classifyMs: 4,
				enrichMs: 10,
			},
			plugins: {
				executed: 1,
				failed: 0,
				skipped: 0,
				artifacts: 1,
				perPluginMs: {
					opengraph: 10,
				},
			},
		},
		traceId: 'trace-123',
	};

	const classify = mock(async (_input: unknown) => classificationResultFixture);
	const enrich = mock(async (_input: EnrichRequest) => enrichmentResultFixture);
	const process = mock(async (_input: ProcessRequest) => processOutput);

	return {
		classify: classify as ServiceDependencies['classify'],
		enrich: enrich as ServiceDependencies['enrich'],
		process: process as ServiceDependencies['process'],
		metrics: new MetricsRegistry(),
		persistence: {
			canPersist: () => false,
			isReady: () => true,
			persist: async () => ({
				status: 'not_requested',
			}),
		},
		readiness: () => ({
			ok: true,
			status: 'ready',
			dependencies: {
				presetRegistry: true,
				persistence: true,
				cacheProvider: 'memory',
			},
			presets: {
				default: ['opengraph'],
			},
			warnings: [],
		}),
	};
}

function createTestConfig(overrides?: Record<string, string>) {
	return loadServiceConfig({
		NODE_ENV: 'test',
		ATOM_SERVICES_BATCH_MAX_ITEMS: '10',
		...overrides,
	});
}

describe('createAtomServicesApp', () => {
	it('returns health and readiness endpoints', async () => {
		const app = createAtomServicesApp({
			config: createTestConfig(),
			dependencies: createMockDependencies(),
		});

		const healthResponse = await app.request('http://localhost/health');
		const healthPayload = (await healthResponse.json()) as {
			status: string;
		};
		expect(healthResponse.status).toBe(200);
		expect(healthPayload.status).toBe('healthy');

		const readyResponse = await app.request('http://localhost/ready');
		const readyPayload = (await readyResponse.json()) as {
			status: string;
		};
		expect(readyResponse.status).toBe(200);
		expect(readyPayload.status).toBe('ready');
	});

	it('calls classify adapter and returns classification contract', async () => {
		const dependencies = createMockDependencies();
		const app = createAtomServicesApp({
			config: createTestConfig(),
			dependencies,
		});

		const response = await app.request('http://localhost/v1/classify', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				input: 'https://acme.example',
				mode: 'progressive',
				classificationSessionId: 'session-abc',
			}),
		});

		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			classificationSessionId: string;
		};
		expect(payload.classificationSessionId).toBe('session-123');
	});

	it('returns process payload with default persistence status', async () => {
		const dependencies = createMockDependencies();
		const app = createAtomServicesApp({
			config: createTestConfig(),
			dependencies,
		});

		const response = await app.request('http://localhost/v1/process', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				rawInput: 'https://acme.example',
				classification: {
					mode: 'progressive',
				},
				enrichment: {
					preset: 'default',
				},
			}),
		});

		expect(response.status).toBe(200);
		const payload = processResponseSchema.parse(await response.json());
		expect(payload.persistence.status).toBe('not_requested');
		expect(payload.status).toBe('success');
	});

	it('rejects persistence requests when adapter is not configured', async () => {
		const app = createAtomServicesApp({
			config: createTestConfig(),
			dependencies: createMockDependencies(),
		});

		const response = await app.request('http://localhost/v1/process', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				rawInput: 'https://acme.example',
				enrichment: {
					preset: 'default',
				},
				persistence: {
					enabled: true,
					strategy: 'enqueue',
				},
			}),
		});

		expect(response.status).toBe(400);
		const payload = (await response.json()) as {
			error: {
				code: string;
			};
		};
		expect(payload.error.code).toBe('PERSISTENCE_NOT_AVAILABLE');
	});

	it('accepts batch processing and exposes job status', async () => {
		const app = createAtomServicesApp({
			config: createTestConfig(),
			dependencies: createMockDependencies(),
		});

		const submitResponse = await app.request('http://localhost/v1/process/batch', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				jobs: [
					{
						rawInput: 'https://acme.example',
						enrichment: {
							preset: 'default',
						},
					},
				],
			}),
		});

		expect(submitResponse.status).toBe(202);
		const submitted = (await submitResponse.json()) as {
			status: string;
			jobId: string;
		};
		expect(submitted.status).toBe('accepted');

		const statusResponse = await app.request(
			`http://localhost/v1/process/batch/${submitted.jobId as string}`
		);
		expect(statusResponse.status).toBe(200);
		const statusPayload = (await statusResponse.json()) as {
			status: string;
		};
		expect(['queued', 'running', 'complete', 'partial']).toContain(statusPayload.status);
	});

	it('enforces auth when token is configured', async () => {
		const app = createAtomServicesApp({
			config: createTestConfig({
				ATOM_SERVICES_AUTH_TOKEN: 'top-secret',
			}),
			dependencies: createMockDependencies(),
		});

		const unauthorized = await app.request('http://localhost/v1/classify', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
			},
			body: JSON.stringify({
				input: 'https://acme.example',
			}),
		});
		expect(unauthorized.status).toBe(401);

		const authorized = await app.request('http://localhost/v1/classify', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: 'Bearer top-secret',
			},
			body: JSON.stringify({
				input: 'https://acme.example',
			}),
		});
		expect(authorized.status).toBe(200);
	});

	it('serves metrics endpoint in Prometheus text format', async () => {
		const app = createAtomServicesApp({
			config: createTestConfig(),
			dependencies: createMockDependencies(),
		});

		const response = await app.request('http://localhost/metrics');
		expect(response.status).toBe(200);
		expect(response.headers.get('content-type')).toContain('text/plain');
		expect(await response.text()).toContain('atomsvc_http_requests_total');
	});
});
