import { describe, expect, it, spyOn } from 'bun:test';
import {
	createServerDefaultPresetOptions,
	serverDefaultPreset,
} from '@0xintuition/atom-enrichment';
import { createProcessingRuntime } from './processing';
import * as runtimeModule from './runtime';
import { createClassificationRuntime, createPresetFactories } from './runtime';

describe('createProcessingRuntime cache provider wiring', () => {
	it('uses upstash cache provider when credentials are configured and creates cache runtime once', () => {
		const cacheSpy = spyOn(runtimeModule, 'createCacheRuntime');
		try {
			const runtime = createProcessingRuntime({
				defaultPreset: 'default',
				cacheProvider: 'upstash',
				memoryCacheMaxEntries: 500,
				classificationMemoryCacheMaxEntries: 500,
				classificationResolverCacheTtlMs: 300_000,
				cacheHttpTimeoutMs: 1_500,
				env: {
					UPSTASH_REDIS_REST_URL: 'https://example.upstash.io',
					UPSTASH_REDIS_REST_TOKEN: 'test-token',
				},
			});

			expect(runtime.cacheProvider).toBe('upstash');
			expect(runtime.warnings).toEqual([]);
			expect(cacheSpy).toHaveBeenCalledTimes(1);
		} finally {
			cacheSpy.mockRestore();
		}
	});

	it('falls back to memory cache when upstash credentials are missing', () => {
		const runtime = createProcessingRuntime({
			defaultPreset: 'default',
			cacheProvider: 'upstash',
			memoryCacheMaxEntries: 500,
			classificationMemoryCacheMaxEntries: 500,
			classificationResolverCacheTtlMs: 300_000,
			cacheHttpTimeoutMs: 1_500,
			env: {},
		});

		expect(runtime.cacheProvider).toBe('memory');
		expect(runtime.warnings).toHaveLength(1);
		expect(runtime.warnings[0]).toContain('ATOM_SERVICES_CACHE_PROVIDER=upstash requested');
	});

	it('uses custom cacheEnvVarName when warning on missing upstash credentials', () => {
		const runtime = createClassificationRuntime({
			defaultPreset: 'default',
			cacheProvider: 'upstash',
			memoryCacheMaxEntries: 500,
			classificationMemoryCacheMaxEntries: 500,
			classificationResolverCacheTtlMs: 300_000,
			cacheHttpTimeoutMs: 1_500,
			cacheEnvVarName: 'WORKERS_CACHE_PROVIDER',
			env: {},
		});

		expect(runtime.cacheProvider).toBe('memory');
		expect(runtime.warnings).toHaveLength(1);
		expect(runtime.warnings[0]).toContain('WORKERS_CACHE_PROVIDER=upstash requested');
	});

	it('uses the shared default server preset composition for default orchestration', () => {
		const env = {
			GITHUB_TOKEN: 'gh-token',
			CANOPY_API_KEY: 'canopy-token',
			X_BEARER_TOKEN: 'x-token',
		};

		const expected = serverDefaultPreset(createServerDefaultPresetOptions(env)).map(
			(plugin) => plugin.id
		);

		const actual = createPresetFactories(env)
			.default()
			.map((plugin) => plugin.id);
		expect(actual).toEqual(expected);
		expect(actual).toContain('product-listing');
		expect(actual).toContain('x-profile');
	});
});
