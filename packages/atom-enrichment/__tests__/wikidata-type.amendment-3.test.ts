import { expect, test } from 'bun:test';
import { createEnrichmentEngine } from '../src/engine';
import type { EnrichmentIdentityCapability } from '../src/plugins';
import { createWikidataPlugin } from '../src/plugins/providers/wikidata';
import { createWikipediaPlugin } from '../src/plugins/providers/wikipedia';
import type { EnrichmentRequest } from '../src/types';

const request: EnrichmentRequest = {
	runtime: 'server',
	input: {
		atomType: 'thing',
		jsonLd: { '@type': 'Movie', name: 'Shared title' },
		source: { classificationEngine: 'test', classifiedAt: '2026-10-04T12:00:00.000Z' },
	},
};
const valid = { fingerprint: 'policy@1', resolveWikidataSchemaType: () => 'Movie' };
for (const fingerprint of [
	undefined,
	'no-identity',
	'',
	' ',
	' policy@1',
	'policy@1 ',
	'x'.repeat(257),
	42,
]) {
	test(`I-2: engine rejects invalid fingerprint ${JSON.stringify(fingerprint)}`, () => {
		expect(() =>
			createEnrichmentEngine({
				identity: { ...valid, fingerprint } as EnrichmentIdentityCapability,
			})
		).toThrow();
	});
}
test('I-2: valid fingerprints at the length boundary run', async () => {
	for (const fingerprint of ['policy@1', 'x'.repeat(256)]) {
		expect(
			(await createEnrichmentEngine({ identity: { ...valid, fingerprint } }).enrich(request)).errors
		).toEqual([]);
	}
});

for (const [name, create] of [
	['wikipedia', createWikipediaPlugin],
	['wikidata', createWikidataPlugin],
] as const) {
	for (const kind of [
		'AbortError',
		'plain abort error',
		'ordinary error',
		'fetch plain abort error',
	] as const) {
		test(`I-3: ${name} propagates cancellation and degrades ordinary failures: ${kind}`, async () => {
			const controller = new AbortController();
			const error =
				kind === 'AbortError'
					? new DOMException('caller aborted', 'AbortError')
					: new Error('policy boom');
			const plugin = create({
				fetch: async (url, init) => {
					expect(init?.signal).toBe(controller.signal);
					if (url.includes('/page/summary/'))
						return Response.json({
							title: 'Shared title',
							extract: 'Description',
							wikibase_item: 'Q123',
						});
					if (url.includes('wbsearchentities')) return Response.json({ search: [{ id: 'Q123' }] });
					if (kind === 'fetch plain abort error') {
						controller.abort();
						throw error;
					}
					return Response.json({
						entities: {
							Q123: { id: 'Q123', labels: { en: { value: 'Shared title' } }, claims: { P31: [] } },
						},
					});
				},
			});
			const promise = plugin.enrich(request, {
				now: () => '2026-10-04T12:00:00.000Z',
				signal: controller.signal,
				identity: {
					...valid,
					resolveWikidataSchemaType: () => {
						if (kind !== 'ordinary error') controller.abort();
						throw error;
					},
				},
			});
			if (kind === 'ordinary error') {
				const artifacts = await promise;
				expect(artifacts).toHaveLength(1);
				expect(artifacts[0]?.meta.identityStrength).toBe('title');
			} else await expect(promise).rejects.toBe(error);
		});
	}
}
