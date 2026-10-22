import { expect, test } from 'bun:test';
import { createMemoryCacheAdapter } from '../src/cache';
import { createEnrichmentEngine } from '../src/engine';
import { harvestChainIdentifiers } from '../src/extraction';
import type { EnrichmentIdentityCapability, EnrichmentPluginLogger } from '../src/plugins';
import { wikidataTypeAgreement } from '../src/plugins/providers/__shared__/wikidata-type';
import { createWikidataPlugin } from '../src/plugins/providers/wikidata';
import { createWikipediaPlugin } from '../src/plugins/providers/wikipedia';
import type { EnrichmentRequest } from '../src/types';

const identity: EnrichmentIdentityCapability = {
	fingerprint: '@0xintuition/iid-ladder@1.2.3/resolveWikidataP31Identity',
	resolveWikidataSchemaType: (ids) => (ids.length ? 'Movie' : undefined),
};
function request(type = 'Movie'): EnrichmentRequest {
	return {
		runtime: 'server',
		input: {
			atomType: 'thing',
			jsonLd: { '@type': type, name: 'Shared title' },
			source: { classificationEngine: 'test', classifiedAt: '2026-10-04T12:00:00.000Z' },
		},
	};
}
function fixture(entityResponse?: () => Response | Promise<Response>) {
	return async (url: string) => {
		if (url.includes('/page/summary/'))
			return Response.json({
				title: 'Shared title',
				extract: 'Description',
				wikibase_item: 'Q123',
			});
		if (url.includes('wbsearchentities')) return Response.json({ search: [{ id: 'Q123' }] });
		return entityResponse
			? entityResponse()
			: Response.json({
					entities: {
						Q123: {
							id: 'Q123',
							labels: { en: { value: 'Shared title' } },
							claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }] },
						},
					},
				});
	};
}
function logger() {
	const warnings: unknown[] = [];
	const log: EnrichmentPluginLogger = {
		debug() {},
		error() {},
		warn(message, meta) {
			warnings.push([message, meta]);
		},
	};
	return { log, warnings };
}

for (const [name, create] of [
	['wikipedia', createWikipediaPlugin],
	['wikidata', createWikidataPlugin],
] as const) {
	test(`${name}: shared cache enabled→absent retains title strength`, async () => {
		const cache = createMemoryCacheAdapter();
		const plugins = [create({ fetch: fixture() })];
		const enabled = createEnrichmentEngine({ plugins, cache, identity });
		const absent = createEnrichmentEngine({ plugins, cache });
		expect((await enabled.enrich(request())).artifacts[0]?.meta.identityStrength).toBeUndefined();
		const result = await absent.enrich(request());
		expect(result.artifacts[0]?.meta.identityStrength).toBe('title');
		expect(result.artifacts[0]?.meta.fromCache).not.toBe(true);
		expect(harvestChainIdentifiers(result.artifacts).identifiers).toEqual({});
		expect((await absent.enrich(request())).artifacts[0]?.meta.fromCache).toBe(true);
	});
	test(`${name}: shared cache absent→enabled rejects Book/film mismatch`, async () => {
		const cache = createMemoryCacheAdapter();
		const plugins = [create({ fetch: fixture() })];
		expect(
			(await createEnrichmentEngine({ plugins, cache }).enrich(request('Book'))).artifacts
		).toHaveLength(1);
		const result = await createEnrichmentEngine({ plugins, cache, identity }).enrich(
			request('Book')
		);
		expect(result.errors).toEqual([]);
		expect(result.artifacts).toEqual([]);
	});
	test(`${name}: policy version changes do not reuse cache`, async () => {
		const cache = createMemoryCacheAdapter();
		const plugins = [create({ fetch: fixture() })];
		await createEnrichmentEngine({ plugins, cache, identity }).enrich(request());
		const changed = { fingerprint: 'policy@2', resolveWikidataSchemaType: () => 'Book' };
		expect(
			(await createEnrichmentEngine({ plugins, cache, identity: changed }).enrich(request()))
				.artifacts
		).toEqual([]);
	});
	test(`${name}: throwing resolver retains title artifact without engine failure`, async () => {
		const { log, warnings } = logger();
		const throwing = {
			...identity,
			resolveWikidataSchemaType: () => {
				throw new Error('resolver unavailable');
			},
		};
		const result = await createEnrichmentEngine({
			plugins: [create({ fetch: fixture() })],
			identity: throwing,
			logger: log,
		}).enrich(request());
		expect(result.errors).toEqual([]);
		expect(result.artifacts[0]?.meta.identityStrength).toBe('title');
		expect(JSON.stringify(warnings)).toContain('resolver unavailable');
		expect(JSON.stringify(warnings)).not.toContain('Q11424');
	});
	test(`${name}: malformed P31 preserves optional fallback or mandatory strict validation`, async () => {
		const result = await createEnrichmentEngine({
			plugins: [
				create({
					fetch: fixture(() =>
						Response.json({ entities: { Q123: { id: 'Q123', claims: { P31: {} } } } })
					),
				}),
			],
			identity,
		}).enrich(request());
		if (name === 'wikipedia') {
			expect(result.errors).toEqual([]);
			expect(result.artifacts[0]?.meta.identityStrength).toBe('title');
		} else {
			expect(result.artifacts).toEqual([]);
			expect(result.errors.map((error) => error.code)).toEqual(['internal_error']);
		}
	});
}

test('helper: throwing resolver returns unknown and warns without claims', () => {
	const { log, warnings } = logger();
	expect(
		wikidataTypeAgreement(
			{ P31: [] },
			'Movie',
			{
				...identity,
				resolveWikidataSchemaType: () => {
					throw new Error('resolver unavailable');
				},
			},
			log
		)
	).toBe('unknown');
	expect(JSON.stringify(warnings)).toContain('resolver unavailable');
});

for (const [name, response] of [
	['503', () => new Response('', { status: 503 })],
	['bad JSON', () => new Response('{broken')],
	[
		'network error',
		() => {
			throw new Error('network unavailable');
		},
	],
] as const) {
	test(`Wikipedia: P31 ${name} preserves successful summary and warns`, async () => {
		const { log, warnings } = logger();
		const result = await createEnrichmentEngine({
			plugins: [createWikipediaPlugin({ fetch: fixture(response) })],
			identity,
			logger: log,
		}).enrich(request());
		expect(result.errors).toEqual([]);
		expect(result.artifacts[0]?.data.extract).toBe('Description');
		expect(result.artifacts[0]?.meta.identityStrength).toBe('title');
		expect(warnings).toHaveLength(1);
	});
}
test('Wikipedia: caller abort during P31 fetch propagates', async () => {
	const controller = new AbortController();
	const error = new DOMException('caller aborted', 'AbortError');
	const plugin = createWikipediaPlugin({
		fetch: fixture(() => {
			controller.abort();
			throw error;
		}),
	});
	await expect(
		plugin.enrich(request(), {
			identity,
			signal: controller.signal,
			now: () => new Date().toISOString(),
		})
	).rejects.toBe(error);
});

test('legacy key without policy segment is a miss in both engine modes', async () => {
	// Independently reconstruct the base key for this already-normalized request.
	const serialized =
		'{"atomType":"thing","hints":{"description":"","identifiers":{},"locale":"","name":"shared title","url":""},"jsonLd":{"@type":"Movie","name":"Shared title"}}';
	let hash = 5381;
	for (let index = 0; index < serialized.length; index += 1)
		hash = (hash * 33) ^ serialized.charCodeAt(index);
	const key = `enrichment:wikipedia:${(hash >>> 0).toString(16)}`;
	for (const capability of [undefined, identity]) {
		const cache = createMemoryCacheAdapter();
		await cache.set(
			key,
			{ artifacts: [], cachedAt: new Date().toISOString(), ttlMs: 60_000 },
			60_000
		);
		const result = await createEnrichmentEngine({
			plugins: [createWikipediaPlugin({ fetch: fixture() })],
			cache,
			identity: capability,
		}).enrich(request());
		expect(result.artifacts).toHaveLength(1);
		expect(result.artifacts[0]?.meta.fromCache).not.toBe(true);
	}
});
