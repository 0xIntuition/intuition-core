import { describe, expect, it } from 'bun:test';

import { createEnrichmentEngine } from '../src/engine';
import { createMockArtifact, createMockPlugin, createMockRequest } from '../src/testing';

describe('enrichment engine integration', () => {
	it('executes multiple applicable plugins and merges artifacts', async () => {
		const engine = createEnrichmentEngine();
		engine.registerPlugin(
			createMockPlugin({
				id: 'plugin-a',
				artifactTypes: ['opengraph'],
				mockArtifacts: [
					createMockArtifact({
						artifact_type: 'opengraph',
						meta: {
							pluginId: 'plugin-a',
							provider: 'a',
							fetchedAt: '2026-01-01T00:00:00.000Z',
						},
					}),
				],
			})
		);
		engine.registerPlugin(
			createMockPlugin({
				id: 'plugin-b',
				artifactTypes: ['brand'],
				mockArtifacts: [
					createMockArtifact({
						artifact_type: 'brand',
						data: { logoUrl: 'https://example.com/logo.svg' },
						meta: {
							pluginId: 'plugin-b',
							provider: 'b',
							fetchedAt: '2026-01-01T00:00:00.000Z',
						},
					}),
				],
			})
		);

		const result = await engine.enrich(createMockRequest());

		expect(result.status).toBe('success');
		expect(result.artifacts).toHaveLength(2);
		expect(result.artifacts.map((artifact) => artifact.artifact_type)).toEqual([
			'opengraph',
			'brand',
		]);
	});

	it('returns partial status when one plugin fails', async () => {
		const engine = createEnrichmentEngine();
		engine.registerPlugin(
			createMockPlugin({
				id: 'plugin-ok',
				mockArtifacts: [createMockArtifact()],
			})
		);
		engine.registerPlugin(
			createMockPlugin({
				id: 'plugin-fail',
				mockError: new Error('API unavailable'),
			})
		);

		const result = await engine.enrich(createMockRequest());

		expect(result.status).toBe('partial');
		expect(result.artifacts).toHaveLength(1);
		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.pluginId).toBe('plugin-fail');
	});

	it('reports timeout when plugin exceeds deadline', async () => {
		const engine = createEnrichmentEngine();
		engine.registerPlugin(
			createMockPlugin({
				id: 'slow-plugin',
				mockDelay: 5_000,
				mockArtifacts: [createMockArtifact()],
			})
		);

		const result = await engine.enrich(createMockRequest({ timeoutMs: 100 }));

		expect(result.errors).toHaveLength(1);
		expect(result.errors[0]?.code).toBe('timeout');
		expect(result.errors[0]?.retriable).toBe(true);
	});

	it('skips server-only plugins in client runtime', async () => {
		const engine = createEnrichmentEngine();
		engine.registerPlugin(
			createMockPlugin({
				id: 'server-plugin',
				runtime: 'server',
				mockArtifacts: [createMockArtifact()],
			})
		);

		const result = await engine.enrich(createMockRequest({ runtime: 'client' }));

		expect(result.artifacts).toHaveLength(0);
		expect(result.skipped).toHaveLength(1);
		expect(result.skipped[0]?.reason).toBe('runtime_mismatch');
	});

	it('returns artifacts in deterministic order for identical inputs', async () => {
		const engine = createEnrichmentEngine();
		engine.registerPlugin(
			createMockPlugin({
				id: 'plugin-z',
				priority: 20,
				artifactTypes: ['brand'],
				mockArtifacts: [
					createMockArtifact({
						artifact_type: 'brand',
						data: { logoUrl: 'https://example.com/z.svg' },
						meta: {
							pluginId: 'plugin-z',
							provider: 'z',
							fetchedAt: '2026-01-01T00:00:00.000Z',
						},
					}),
				],
			})
		);
		engine.registerPlugin(
			createMockPlugin({
				id: 'plugin-a',
				priority: 10,
				artifactTypes: ['opengraph'],
				mockArtifacts: [
					createMockArtifact({
						artifact_type: 'opengraph',
						meta: {
							pluginId: 'plugin-a',
							provider: 'a',
							fetchedAt: '2026-01-01T00:00:00.000Z',
						},
					}),
				],
			})
		);

		const request = createMockRequest();
		const first = await engine.enrich(request);
		const second = await engine.enrich(request);

		expect(first.artifacts.map((artifact) => artifact.artifact_type)).toEqual(
			second.artifacts.map((artifact) => artifact.artifact_type)
		);
	});

	it('respects plugin allow-list filtering', async () => {
		const engine = createEnrichmentEngine();
		engine.registerPlugin(
			createMockPlugin({
				id: 'opengraph',
				mockArtifacts: [createMockArtifact({ artifact_type: 'opengraph' })],
			})
		);
		engine.registerPlugin(
			createMockPlugin({
				id: 'brand-api',
				artifactTypes: ['brand'],
				mockArtifacts: [
					createMockArtifact({
						artifact_type: 'brand',
						data: { logoUrl: 'https://example.com/brand.svg' },
					}),
				],
			})
		);

		const result = await engine.enrich(createMockRequest({ plugins: ['opengraph'] }));

		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0]?.artifact_type).toBe('opengraph');
	});

	it('respects artifact class allow-list filtering', async () => {
		const engine = createEnrichmentEngine();
		engine.registerPlugin(
			createMockPlugin({
				id: 'multi-plugin',
				artifactTypes: ['opengraph', 'brand'],
				mockArtifacts: [
					createMockArtifact({ artifact_type: 'opengraph' }),
					createMockArtifact({
						artifact_type: 'brand',
						data: { logoUrl: 'https://example.com/brand.svg' },
					}),
				],
			})
		);

		const result = await engine.enrich(createMockRequest({ artifactTypes: ['brand'] }));

		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0]?.artifact_type).toBe('brand');
	});

	it('accepts legacy twitter-profile artifact filters for canonical x-profile artifacts', async () => {
		const engine = createEnrichmentEngine();
		engine.registerPlugin(
			createMockPlugin({
				id: 'x-profile',
				artifactTypes: ['x-profile'],
				mockArtifacts: [
					createMockArtifact({
						artifact_type: 'x-profile',
						data: {
							username: '0xIntuition',
						},
					}),
				],
			})
		);

		const result = await engine.enrich(
			createMockRequest({
				plugins: ['twitter-profile'],
				artifactTypes: ['twitter-profile'],
			})
		);

		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0]?.artifact_type).toBe('x-profile');
	});

	it('populates per-plugin timing metadata', async () => {
		const engine = createEnrichmentEngine();
		engine.registerPlugin(
			createMockPlugin({
				id: 'timed-plugin',
				mockDelay: 25,
				mockArtifacts: [createMockArtifact()],
			})
		);

		const result = await engine.enrich(createMockRequest());

		expect(result.timings.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.timings.startedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(result.timings.finishedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
		expect(result.timings.perPluginMs['timed-plugin']).toBeGreaterThanOrEqual(0);
	});
});
