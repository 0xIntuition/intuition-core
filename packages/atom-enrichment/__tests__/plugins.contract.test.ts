import { describe, expect, it } from 'bun:test';

import {
	defineEnrichmentPlugin,
	enrichmentPluginManifestSchema,
	isPluginRuntimeCompatible,
	validateEnrichmentPluginManifest,
} from '../src/plugins';
import type { EnrichmentRequest } from '../src/types';

describe('enrichment plugin contract', () => {
	it('applies plugin manifest defaults', () => {
		const manifest = validateEnrichmentPluginManifest({
			id: 'wikipedia',
			version: '1.0.0',
			runtime: 'universal',
			artifactTypes: ['wikipedia'],
		});

		expect(manifest.priority).toBe(100);
		expect(manifest.TTL).toBeUndefined();
	});

	it('rejects invalid plugin ids', () => {
		expect(() =>
			validateEnrichmentPluginManifest({
				id: 'Bad Plugin',
				version: '1.0.0',
				runtime: 'server',
				artifactTypes: ['wikipedia'],
			})
		).toThrow();
	});

	it('rejects invalid semantic versions', () => {
		expect(() =>
			enrichmentPluginManifestSchema.parse({
				id: 'wikipedia',
				version: 'v1',
				runtime: 'universal',
				artifactTypes: ['wikipedia'],
			})
		).toThrow();
	});

	it('returns the exact plugin object from defineEnrichmentPlugin', async () => {
		const plugin = defineEnrichmentPlugin({
			id: 'opengraph',
			version: '1.0.0',
			runtime: 'universal',
			artifactTypes: ['opengraph'],
			supports: (_request: EnrichmentRequest) => true,
			enrich: async (request: EnrichmentRequest) => [
				{
					artifact_type: 'opengraph',
					data: {
						title: request.input.hints?.name ?? 'Fallback',
					},
					meta: {
						pluginId: 'opengraph',
						provider: 'website',
						fetchedAt: '2026-02-10T18:00:00.000Z',
					},
				},
			],
		});

		expect(plugin.id).toBe('opengraph');
		expect(await plugin.supports({} as EnrichmentRequest)).toBe(true);
	});

	it('evaluates runtime compatibility rules', () => {
		expect(isPluginRuntimeCompatible('client', 'client')).toBe(true);
		expect(isPluginRuntimeCompatible('server', 'server')).toBe(true);
		expect(isPluginRuntimeCompatible('client', 'universal')).toBe(true);
		expect(isPluginRuntimeCompatible('server', 'universal')).toBe(true);
		expect(isPluginRuntimeCompatible('client', 'server')).toBe(false);
		expect(isPluginRuntimeCompatible('server', 'client')).toBe(false);
	});
});
