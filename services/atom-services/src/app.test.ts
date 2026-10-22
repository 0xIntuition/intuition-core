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

const LEAKY =
	'HTTP 503 from https://user:SECRET@api.etherscan.io/api?apikey=SECRET Authorization: Bearer SECRET';

it('redacts provider credentials from /v1/classify responses', async () => {
	const dependencies = createMockDependencies();
	dependencies.classify = async () => ({
		...classificationResultFixture,
		resolverErrors: [{ resolverId: 'resolver-default', message: LEAKY, timestamp: FIXED_NOW }],
	});
	const app = createAtomServicesApp({ config: createTestConfig(), dependencies });
	const response = await app.request('http://localhost/v1/classify', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ input: 'https://acme.example' }),
	});
	expect(response.status).toBe(200);
	const body = await response.text();
	expect(body).toContain('HTTP 503');
	expect(body).not.toContain('SECRET');
});

it('redacts provider credentials from /v1/process responses and persistence handoff', async () => {
	const dependencies = createMockDependencies();
	const base = await dependencies.process(
		{ rawInput: 'https://acme.example' } as ProcessRequest,
		'r'
	);
	dependencies.process = async () => ({
		...base,
		classification: {
			...classificationResultFixture,
			resolverErrors: [{ resolverId: 'resolver-default', message: LEAKY, timestamp: FIXED_NOW }],
		},
		enrichment: {
			...enrichmentResultFixture,
			errors: [{ pluginId: 'etherscan', code: 'upstream_error', retriable: true, message: LEAKY }],
			skipped: [{ pluginId: 'etherscan', reason: LEAKY }],
		},
	});
	let persisted = '';
	dependencies.persistence = {
		canPersist: () => true,
		isReady: () => true,
		persist: async (_request, result) => {
			persisted = JSON.stringify(result);
			return { status: 'saved', recordId: 'rec-1' };
		},
	};
	const app = createAtomServicesApp({ config: createTestConfig(), dependencies });
	const response = await app.request('http://localhost/v1/process', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			rawInput: 'https://acme.example',
			enrichment: { preset: 'default' },
			persistence: { enabled: true, strategy: 'sync' },
		}),
	});
	expect(response.status).toBe(200);
	const body = await response.text();
	expect(body).toContain('HTTP 503');
	expect(body).not.toContain('SECRET');
	expect(persisted).toContain('HTTP 503');
	expect(persisted).not.toContain('SECRET');
});

it('redacts provider credentials from batch item results and failures', async () => {
	const dependencies = createMockDependencies();
	const base = await dependencies.process(
		{ rawInput: 'https://acme.example' } as ProcessRequest,
		'r'
	);
	let calls = 0;
	dependencies.process = async () => {
		calls += 1;
		if (calls === 1) {
			throw new Error(LEAKY);
		}
		return {
			...base,
			enrichment: {
				...enrichmentResultFixture,
				errors: [
					{ pluginId: 'etherscan', code: 'upstream_error', retriable: true, message: LEAKY },
				],
			},
		};
	};
	const app = createAtomServicesApp({ config: createTestConfig(), dependencies });
	const submitResponse = await app.request('http://localhost/v1/process/batch', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			jobs: [
				{ rawInput: 'https://acme.example', enrichment: { preset: 'default' } },
				{ rawInput: 'https://acme.example', enrichment: { preset: 'default' } },
			],
		}),
	});
	expect(submitResponse.status).toBe(202);
	const { jobId } = (await submitResponse.json()) as { jobId: string };
	let body = '';
	for (let attempt = 0; attempt < 50; attempt += 1) {
		const statusResponse = await app.request(`http://localhost/v1/process/batch/${jobId}`);
		body = await statusResponse.text();
		const { status } = JSON.parse(body) as { status: string };
		if (status !== 'queued' && status !== 'running') {
			break;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}
	expect(body).toContain('BATCH_ITEM_FAILED');
	expect(body).toContain('HTTP 503');
	expect(body).not.toContain('SECRET');
});

it('redacts provider credentials from /v1/enrich responses', async () => {
	const dependencies = createMockDependencies();
	dependencies.enrich = async () => ({
		...enrichmentResultFixture,
		errors: [
			{
				pluginId: 'etherscan',
				code: 'upstream_error',
				retriable: true,
				message:
					'HTTP 503 from https://user:SECRET@api.etherscan.io/api?apikey=SECRET Authorization: Bearer SECRET',
			},
		],
	});
	const app = createAtomServicesApp({ config: createTestConfig(), dependencies });
	const response = await app.request('http://localhost/v1/enrich', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({
			input: {
				atomType: 'thing',
				jsonLd: { '@context': 'https://schema.org', '@type': 'Thing' },
				source: { classificationEngine: 'test', classifiedAt: FIXED_NOW },
			},
		}),
	});
	expect(response.status).toBe(200);
	const body = await response.text();
	expect(body).toContain('HTTP 503');
	expect(body).not.toContain('SECRET');
});
