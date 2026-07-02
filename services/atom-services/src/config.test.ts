import { describe, expect, it } from 'bun:test';
import { loadServiceConfig } from './config';

describe('loadServiceConfig', () => {
	it('provides defaults when optional env vars are omitted', () => {
		const config = loadServiceConfig({
			NODE_ENV: 'test',
		});

		expect(config.port).toBe(4010);
		expect(config.defaultPreset).toBe('default');
		expect(config.persistenceEnabled).toBe(false);
		expect(config.cacheProvider).toBe('memory');
		expect(config.memoryCacheMaxEntries).toBe(500);
		expect(config.classificationMemoryCacheMaxEntries).toBe(500);
		expect(config.classificationResolverCacheTtlMs).toBe(300_000);
		expect(config.cacheHttpTimeoutMs).toBe(1_500);
	});

	it('trims empty auth token and keeps explicit settings', () => {
		const config = loadServiceConfig({
			NODE_ENV: 'test',
			ATOM_SERVICES_AUTH_TOKEN: '   ',
			ATOM_SERVICES_PORT: '4020',
			ATOM_SERVICES_DEFAULT_PRESET: 'company',
			ATOM_SERVICES_PERSISTENCE_ENABLED: 'true',
			ATOM_SERVICES_CACHE_PROVIDER: 'none',
			ATOM_SERVICES_MEMORY_CACHE_MAX_ENTRIES: '800',
			ATOM_SERVICES_CLASSIFICATION_MEMORY_CACHE_MAX_ENTRIES: '1200',
			ATOM_SERVICES_CLASSIFICATION_RESOLVER_CACHE_TTL_MS: '600000',
			ATOM_SERVICES_CACHE_HTTP_TIMEOUT_MS: '2500',
		});

		expect(config.authToken).toBeUndefined();
		expect(config.port).toBe(4020);
		expect(config.defaultPreset).toBe('company');
		expect(config.persistenceEnabled).toBe(true);
		expect(config.cacheProvider).toBe('none');
		expect(config.memoryCacheMaxEntries).toBe(800);
		expect(config.classificationMemoryCacheMaxEntries).toBe(1200);
		expect(config.classificationResolverCacheTtlMs).toBe(600_000);
		expect(config.cacheHttpTimeoutMs).toBe(2_500);
	});

	it('throws on invalid port values', () => {
		expect(() =>
			loadServiceConfig({
				NODE_ENV: 'test',
				ATOM_SERVICES_PORT: '0',
			})
		).toThrow();
	});

	it('supports legacy ENRICHMENT_* env vars as fallback', () => {
		const config = loadServiceConfig({
			NODE_ENV: 'test',
			ENRICHMENT_SERVICE_PORT: '4030',
			ENRICHMENT_DEFAULT_PRESET: 'crypto',
			ENRICHMENT_CACHE_PROVIDER: 'none',
			ENRICHMENT_MEMORY_CACHE_MAX_ENTRIES: '700',
			ENRICHMENT_CACHE_HTTP_TIMEOUT_MS: '2400',
		});

		expect(config.port).toBe(4030);
		expect(config.defaultPreset).toBe('crypto');
		expect(config.cacheProvider).toBe('none');
		expect(config.memoryCacheMaxEntries).toBe(700);
		expect(config.classificationMemoryCacheMaxEntries).toBe(700);
		expect(config.cacheHttpTimeoutMs).toBe(2_400);
	});

	it('accepts upstash as a cache provider', () => {
		const config = loadServiceConfig({
			NODE_ENV: 'test',
			ATOM_SERVICES_CACHE_PROVIDER: 'upstash',
		});

		expect(config.cacheProvider).toBe('upstash');
	});
});
