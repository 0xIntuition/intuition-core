import { describe, expect, it } from 'bun:test';
import {
	buildClassificationResolverCacheKey,
	type ClassificationCacheAdapter,
	createMemoryClassificationCacheAdapter,
} from '../src/cache';
import { createClassificationEngine } from '../src/engine';
import type { AtomClassificationPlugin } from '../src/plugins';

describe('classification cache adapter and engine cache integration', () => {
	it('buildClassificationResolverCacheKey is deterministic for equivalent inputs', () => {
		const left = buildClassificationResolverCacheKey({
			pluginId: 'platform-v0',
			resolverId: 'platform-resolver',
			runtime: 'server',
			request: {
				input: ' https://example.com/company/acme ',
				mode: 'progressive',
				inputIntent: 'generic',
				pluginIds: ['open-graph', 'brand-api'],
				policy: undefined,
				clientHints: undefined,
			},
			classification: {
				type: 'url',
				domain: 'example',
				subtype: 'company',
				confidence: 0.95,
				meta: { source: 'unit-test' },
			},
		});

		const right = buildClassificationResolverCacheKey({
			pluginId: 'platform-v0',
			resolverId: 'platform-resolver',
			runtime: 'server',
			request: {
				input: 'https://example.com/company/acme',
				mode: 'progressive',
				inputIntent: 'generic',
				pluginIds: ['brand-api', 'open-graph'],
				policy: undefined,
				clientHints: undefined,
			},
			classification: {
				type: 'url',
				domain: 'example',
				subtype: 'company',
				confidence: 0.95,
				meta: { source: 'unit-test' },
			},
		});

		expect(left).toBe(right);
	});

	it('buildClassificationResolverCacheKey changes for different plugin ids', () => {
		const baseInput = {
			resolverId: 'platform-resolver',
			runtime: 'server' as const,
			request: {
				input: 'https://example.com/company/acme',
				mode: 'progressive' as const,
				inputIntent: 'generic' as const,
				pluginIds: ['brand-api', 'open-graph'],
				policy: undefined,
				clientHints: undefined,
			},
			classification: {
				type: 'url' as const,
				domain: 'example',
				subtype: 'company',
				confidence: 0.95,
				meta: {},
			},
		};

		const left = buildClassificationResolverCacheKey({
			...baseInput,
			pluginId: 'platform-v0',
		});
		const right = buildClassificationResolverCacheKey({
			...baseInput,
			pluginId: 'non-url-v0',
		});

		expect(left).not.toBe(right);
	});

	it('engine reuses cached resolver output across classification sessions', async () => {
		const cache = createMemoryClassificationCacheAdapter();
		let resolverCalls = 0;
		const engine = createClassificationEngine({
			runtime: 'server',
			cache,
			plugins: [createCacheTestPlugin(() => ++resolverCalls, 60)],
		});

		const first = await engine.classify({
			input: 'https://example.com/company/acme',
			mode: 'progressive',
			classificationSessionId: 'session-a',
		});
		const second = await engine.classify({
			input: 'https://example.com/company/acme',
			mode: 'progressive',
			classificationSessionId: 'session-b',
		});

		expect(first.status).toBe('complete');
		expect(second.status).toBe('complete');
		expect(resolverCalls).toBe(1);
		expect(first.resolved?.atoms[0]?.title).toBe('Acme Corp #1');
		expect(second.resolved?.atoms[0]?.title).toBe('Acme Corp #1');
	});

	it('engine re-fetches resolver output when cache entry expires', async () => {
		let nowMs = 0;
		const cache = createMemoryClassificationCacheAdapter({ now: () => nowMs });
		let resolverCalls = 0;
		const engine = createClassificationEngine({
			runtime: 'server',
			now: () => new Date(nowMs),
			cache,
			plugins: [createCacheTestPlugin(() => ++resolverCalls, 1)],
		});

		await engine.classify({
			input: 'https://example.com/company/acme',
			mode: 'progressive',
			classificationSessionId: 'session-exp-1',
		});

		nowMs = 2_000;
		const second = await engine.classify({
			input: 'https://example.com/company/acme',
			mode: 'progressive',
			classificationSessionId: 'session-exp-2',
		});

		expect(second.status).toBe('complete');
		expect(resolverCalls).toBe(2);
		expect(second.resolved?.atoms[0]?.title).toBe('Acme Corp #2');
	});

	it('cache adapter failures are non-fatal for classification', async () => {
		let resolverCalls = 0;
		const brokenCache: ClassificationCacheAdapter = {
			get: async () => {
				throw new Error('cache unavailable');
			},
			set: async () => {
				throw new Error('cache unavailable');
			},
			delete: async () => {
				throw new Error('cache unavailable');
			},
		};
		const engine = createClassificationEngine({
			runtime: 'server',
			cache: brokenCache,
			plugins: [createCacheTestPlugin(() => ++resolverCalls, 60)],
		});

		const result = await engine.classify({
			input: 'https://example.com/company/acme',
			mode: 'progressive',
			classificationSessionId: 'session-broken-cache',
		});

		expect(result.status).toBe('complete');
		expect(result.resolved?.atoms).toHaveLength(1);
		expect(resolverCalls).toBe(1);
	});
});

function createCacheTestPlugin(
	nextResolverCall: () => number,
	cacheTtlSeconds: number
): AtomClassificationPlugin {
	return {
		manifest: {
			id: 'cache-test-plugin',
			version: '1.0.0',
			engineRange: '*',
			runtime: 'server',
			capabilities: [],
			permissions: [],
			dependsOn: [],
			provides: [],
			priority: 100,
		},
		classifiers: [
			{
				id: 'cache-test-classifier',
				classify: () => ({
					type: 'url',
					domain: 'example',
					subtype: 'company',
					confidence: 0.95,
					meta: {},
				}),
			},
		],
		resolvers: [
			{
				id: 'cache-test-resolver',
				executionMode: 'deterministic',
				cacheTtlSeconds,
				canResolve: () => true,
				resolve: () => {
					const callNumber = nextResolverCall();
					return {
						atoms: [
							{
								schemaType: 'Organization',
								category: 'company',
								title: `Acme Corp #${callNumber}`,
								description: 'Cache resolver output',
								canonicalId: 'https://example.com/company/acme',
								sameAs: ['https://example.com/company/acme'],
								source: 'cache-test-resolver',
								confidence: 0.95,
								data: {
									callNumber,
								},
							},
						],
						fallbackUsed: false,
						metadata: {
							callNumber,
						},
					};
				},
			},
		],
	};
}
