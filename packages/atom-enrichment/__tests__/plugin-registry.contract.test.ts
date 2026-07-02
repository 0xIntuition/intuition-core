import { describe, expect, it } from 'bun:test';

import { createEnrichmentPluginRegistry } from '../src/plugin-registry';
import { createMockPlugin, createMockRequest } from '../src/testing';

describe('plugin registry contract', () => {
	it('registers and lists plugins in deterministic priority order', () => {
		const registry = createEnrichmentPluginRegistry();
		registry.register(createMockPlugin({ id: 'plugin-z', priority: 20 }));
		registry.register(createMockPlugin({ id: 'plugin-a', priority: 10 }));
		registry.register(createMockPlugin({ id: 'plugin-b', priority: 10 }));

		expect(registry.list().map((plugin) => plugin.id)).toEqual([
			'plugin-a',
			'plugin-b',
			'plugin-z',
		]);
	});

	it('rejects duplicates unless override is set', () => {
		const registry = createEnrichmentPluginRegistry();
		registry.register(createMockPlugin({ id: 'opengraph' }));

		expect(() => registry.register(createMockPlugin({ id: 'opengraph' }))).toThrow();

		registry.register(createMockPlugin({ id: 'opengraph', priority: 1 }), { override: true });
		expect(registry.get('opengraph')?.priority).toBe(1);
	});

	it('unregisters plugins', () => {
		const registry = createEnrichmentPluginRegistry();
		registry.register(createMockPlugin({ id: 'wikipedia' }));

		expect(registry.unregister('wikipedia')).toBe(true);
		expect(registry.unregister('wikipedia')).toBe(false);
		expect(registry.has('wikipedia')).toBe(false);
	});

	it('resolve() applies runtime gating and filter rules', () => {
		const registry = createEnrichmentPluginRegistry();
		registry.register(
			createMockPlugin({
				id: 'opengraph',
				runtime: 'universal',
				artifactTypes: ['opengraph'],
			})
		);
		registry.register(
			createMockPlugin({
				id: 'brand',
				runtime: 'server',
				artifactTypes: ['brand'],
			})
		);

		const request = createMockRequest({
			runtime: 'client',
			plugins: ['opengraph'],
			artifactTypes: ['opengraph'],
		});

		const resolved = registry.resolve(request);

		expect(resolved.plugins.map((plugin) => plugin.id)).toEqual(['opengraph']);
		expect(resolved.skipped).toContainEqual({
			pluginId: 'brand',
			reason: 'runtime_mismatch',
		});
	});

	it('resolve() accepts legacy twitter-profile request filters for the canonical x-profile plugin', () => {
		const registry = createEnrichmentPluginRegistry();
		registry.register(
			createMockPlugin({
				id: 'x-profile',
				artifactTypes: ['x-profile'],
			})
		);

		const resolved = registry.resolve(
			createMockRequest({
				plugins: ['twitter-profile'],
				artifactTypes: ['twitter-profile'],
			})
		);

		expect(resolved.plugins.map((plugin) => plugin.id)).toEqual(['x-profile']);
		expect(registry.has('twitter-profile')).toBe(true);
		expect(registry.get('twitter-profile')?.id).toBe('x-profile');
	});
});
