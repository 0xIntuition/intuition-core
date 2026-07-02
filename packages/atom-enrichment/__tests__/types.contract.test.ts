import { describe, expect, it } from 'bun:test';

import {
	enrichmentRequestSchema,
	enrichmentRunResultSchema,
	pluginExecutionErrorCodeSchema,
} from '../src/types';

describe('enrichment contract schemas', () => {
	it('parses a valid enrichment request', () => {
		const request = enrichmentRequestSchema.parse({
			input: {
				atomType: 'company',
				jsonLd: {
					'@context': 'https://schema.org',
					'@type': 'Organization',
					name: 'Acme Labs',
					url: 'https://acme.example',
				},
				source: {
					classificationEngine: '@0xintuition/atom-classification',
					classifiedAt: '2026-02-10T18:00:00.000Z',
				},
				hints: {
					name: 'Acme Labs',
					url: 'https://acme.example',
				},
			},
			runtime: 'server',
			plugins: ['opengraph', 'brand'],
			artifactTypes: ['opengraph', 'brand'],
			concurrency: 3,
			timeoutMs: 5_000,
			traceId: 'trace-123',
		});

		expect(request.runtime).toBe('server');
		expect(request.input.atomType).toBe('company');
		expect(request.plugins).toEqual(['opengraph', 'brand']);
	});

	it('rejects invalid request runtime values', () => {
		expect(() =>
			enrichmentRequestSchema.parse({
				input: {
					atomType: 'company',
					jsonLd: {},
					source: {
						classificationEngine: 'test',
						classifiedAt: '2026-02-10T18:00:00.000Z',
					},
				},
				runtime: 'edge',
			})
		).toThrow();
	});

	it('parses a valid run result with cache timing metadata', () => {
		const result = enrichmentRunResultSchema.parse({
			status: 'partial',
			artifacts: [
				{
					artifact_type: 'opengraph',
					data: {
						title: 'Acme Labs',
						url: 'https://acme.example',
					},
					meta: {
						pluginId: 'opengraph',
						provider: 'website',
						fetchedAt: '2026-02-10T18:00:01.100Z',
						fromCache: true,
						cachedAt: '2026-02-10T18:00:00.000Z',
					},
				},
			],
			errors: [
				{
					pluginId: 'crunchbase',
					code: 'rate_limited',
					message: '429 rate limited',
					retriable: true,
				},
			],
			skipped: [{ pluginId: 'spotify', reason: 'runtime_mismatch' }],
			timings: {
				startedAt: '2026-02-10T18:00:01.000Z',
				finishedAt: '2026-02-10T18:00:01.450Z',
				durationMs: 450,
				perPluginMs: {
					opengraph: 90,
					crunchbase: 145,
				},
				cacheHits: 1,
				cacheMisses: 1,
			},
			traceId: 'trace-123',
		});

		expect(result.status).toBe('partial');
		expect(result.timings.cacheHits).toBe(1);
		expect(result.artifacts[0]?.meta.fromCache).toBe(true);
	});

	it('enforces plugin execution error code values', () => {
		expect(pluginExecutionErrorCodeSchema.safeParse('timeout').success).toBe(true);
		expect(pluginExecutionErrorCodeSchema.safeParse('bad_gateway').success).toBe(false);
	});
});
