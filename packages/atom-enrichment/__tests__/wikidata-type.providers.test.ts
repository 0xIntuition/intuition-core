import { describe, expect, test } from 'bun:test';
import {
	createWikidataPlugin,
	createWikipediaPlugin,
	type EnrichmentPluginContext,
	type EnrichmentRequest,
} from '../src';
import { extractClassificationFields, harvestChainIdentifiers } from '../src/extraction';

const NOW = '2026-10-04T12:00:00.000Z';
const summary = { title: 'Shared title', extract: 'Description', wikibase_item: 'Q123' };

function request(
	schemaType: string,
	url?: string,
	identifiers?: Record<string, string>
): EnrichmentRequest {
	return {
		runtime: 'server',
		input: {
			atomType: 'thing',
			source: { classificationEngine: 'test', classifiedAt: NOW },
			jsonLd: { '@type': schemaType, name: 'Shared title', ...(url ? { url } : {}) },
			...(identifiers ? { hints: { identifiers } } : {}),
		},
	};
}

function context(schemaType?: string): EnrichmentPluginContext {
	return {
		now: () => NOW,
		signal: new AbortController().signal,
		...(schemaType
			? { identity: { fingerprint: 'test-policy@1', resolveWikidataSchemaType: () => schemaType } }
			: {}),
	};
}

function fixture(p31 = 'Q11424') {
	const urls: string[] = [];
	const signals: Array<AbortSignal | null | undefined> = [];
	return {
		urls,
		signals,
		fetch: async (url: string, init?: RequestInit) => {
			urls.push(url);
			signals.push(init?.signal);
			if (url.includes('/page/summary/')) return Response.json(summary);
			if (url.includes('wbsearchentities')) return Response.json({ search: [{ id: 'Q123' }] });
			if (url.endsWith('/Q123.json'))
				return Response.json({
					entities: {
						Q123: {
							id: 'Q123',
							labels: { en: { value: 'Shared title' } },
							claims: { P31: [{ mainsnak: { datavalue: { value: { id: p31 } } } }] },
						},
					},
				});
			throw new Error(`Unexpected injected fetch: ${url}`);
		},
	};
}

describe('injected Wikidata type gate providers', () => {
	for (const [name, create] of [
		['wikipedia', createWikipediaPlugin],
		['wikidata', createWikidataPlugin],
	] as const) {
		test(`${name}: Book title resolving to a Movie produces no artifact`, async () => {
			const fake = fixture();
			expect(await create({ fetch: fake.fetch }).enrich(request('Book'), context('Movie'))).toEqual(
				[]
			);
		});
		test.each([
			['Movie', 'Movie', 'Q11424'],
			['Person', 'Person', 'Q5'],
		])(`${name}: %s agreement upgrades title provenance to identifier strength`, async (expected, actual, p31) => {
			const fake = fixture(p31);
			const ctx = context(actual);
			const artifacts = await create({ fetch: fake.fetch }).enrich(request(expected), ctx);
			expect(artifacts).toHaveLength(1);
			expect(artifacts[0]?.meta).not.toHaveProperty('identityStrength');
			expect(fake.signals.every((signal) => signal === ctx.signal)).toBe(true);
		});
		test.each(['Thing', 'unknown'])(`${name}: %s retains title strength`, async (kind) => {
			const artifacts = await create({ fetch: fixture().fetch }).enrich(
				request(kind === 'Thing' ? 'Thing' : 'Book'),
				context(kind === 'Thing' ? 'Movie' : 'Thing')
			);
			expect(artifacts[0]?.meta.identityStrength).toBe('title');
		});
	}

	test('Wikipedia agreement admits its QID pivot and Wikidata sameAs', async () => {
		const artifacts = await createWikipediaPlugin({ fetch: fixture().fetch }).enrich(
			request('Movie'),
			context('Movie')
		);
		expect(harvestChainIdentifiers(artifacts)).toEqual({
			identifiers: { wikidata: 'Q123' },
			pluginSlugs: ['wikidata'],
		});
		const wikidata = await createWikidataPlugin({ fetch: fixture().fetch }).enrich(
			request('Movie', undefined, harvestChainIdentifiers(artifacts).identifiers),
			context('Movie')
		);
		const extracted = await extractClassificationFields({
			classification: 'movie',
			url: 'https://example.com/movie',
			artifacts: [...artifacts, ...wikidata],
		});
		expect(extracted.values.sameAs).toContain('https://www.wikidata.org/wiki/Q123');
	});
	test('Wikidata title agreement admits its sameAs through extraction', async () => {
		const artifacts = await createWikidataPlugin({ fetch: fixture().fetch }).enrich(
			request('Movie'),
			context('Movie')
		);
		const extracted = await extractClassificationFields({
			classification: 'movie',
			url: 'https://example.com/movie',
			artifacts,
		});
		expect(extracted.values.sameAs).toContain('https://www.wikidata.org/wiki/Q123');
	});

	test('Wikipedia: absent capability is byte-identical to the T2b artifact and makes no entity fetch', async () => {
		const fake = fixture();
		const artifacts = await createWikipediaPlugin({ fetch: fake.fetch }).enrich(
			request('Book'),
			context()
		);
		expect(JSON.stringify(artifacts)).toBe(
			JSON.stringify([
				{
					artifact_type: 'wikipedia',
					data: {
						title: 'Shared title',
						extract: 'Description',
						pageUrl: 'https://en.wikipedia.org/wiki/Shared_title',
						language: 'en',
						wikibaseItem: 'Q123',
					},
					meta: {
						pluginId: 'wikipedia',
						identityStrength: 'title',
						provider: 'wikipedia',
						fetchedAt: NOW,
						sourceUrl: 'https://en.wikipedia.org/wiki/Shared_title',
					},
				},
			])
		);
		expect(fake.urls).toHaveLength(1);
	});
	test('Wikidata: absent capability keeps the complete T2b artifact unchanged', async () => {
		const fake = fixture();
		const plugin = createWikidataPlugin({ fetch: fake.fetch });
		const artifacts = await plugin.enrich(request('Book'), context());
		expect(artifacts[0]?.meta.identityStrength).toBe('title');
		expect(JSON.stringify(artifacts)).toBe(
			JSON.stringify([
				{
					artifact_type: 'wikidata',
					data: {
						entityId: 'Q123',
						label: 'Shared title',
						claims: { P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }] },
						instanceOf: ['Q11424'],
					},
					meta: {
						pluginId: 'wikidata',
						identityStrength: 'title',
						provider: 'wikidata',
						fetchedAt: NOW,
						sourceUrl: 'https://www.wikidata.org/wiki/Q123',
					},
				},
			])
		);
		expect(JSON.stringify(artifacts)).toBe(
			JSON.stringify(await plugin.enrich(request('Book'), context('Thing')))
		);
		expect(fake.urls).toHaveLength(4);
	});
	test('Wikipedia: direct resource URL bypasses the gate and entity fetch', async () => {
		const fake = fixture();
		const ctx = context('Movie');
		ctx.identity = {
			fingerprint: 'test-policy@1',
			resolveWikidataSchemaType: () => {
				throw new Error('Identifier lookup must not be gated');
			},
		};
		const artifacts = await createWikipediaPlugin({ fetch: fake.fetch }).enrich(
			request('Book', 'https://en.wikipedia.org/wiki/Shared_title'),
			ctx
		);
		expect(artifacts[0]?.meta.identityStrength).toBe('url');
		expect(fake.urls).toHaveLength(1);
	});
	test.each([
		request('Book', undefined, { wikidata: 'Q123' }),
		request('Book', 'https://www.wikidata.org/wiki/Q123'),
		{
			...request('Book'),
			input: { ...request('Book').input, jsonLd: { '@type': 'Book', name: 'Q123' } },
		},
	])('Wikidata: explicit QID lookup bypasses the gate', async (input) => {
		const fake = fixture();
		const ctx = context('Movie');
		ctx.identity = {
			fingerprint: 'test-policy@1',
			resolveWikidataSchemaType: () => {
				throw new Error('Identifier lookup must not be gated');
			},
		};
		const artifacts = await createWikidataPlugin({ fetch: fake.fetch }).enrich(input, ctx);
		expect(artifacts[0]?.meta.identityStrength).toBe('identifier');
		expect(fake.urls).toHaveLength(1);
	});
});
