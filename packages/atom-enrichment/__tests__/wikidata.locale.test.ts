import { describe, expect, it } from 'bun:test';
import { pickWikidataLabel, resolveWikidataEntityLabels } from '../src/extraction/wikidata-claims';
import { createWikidataPlugin } from '../src/plugins/providers/wikidata';
import { createMockAtomInput, createMockPluginContext, createMockRequest } from '../src/testing';

const cases: Array<[string, Record<string, unknown>, string | undefined]> = [
	['English after missing French', { de: { value: 'x' }, en: { value: 'y' } }, 'y'],
	['language independent', { mul: { value: 'm' } }, 'm'],
	['German only', { de: { value: 'x' } }, undefined],
	['blank English', { en: { value: '  ' } }, undefined],
	['non-object entry', { en: 'invalid' }, undefined],
	['regional fallback', { 'en-gb': { value: '  British  ' }, mul: { value: 'm' } }, 'British'],
];

describe('Wikidata locale policy', () => {
	for (const [name, descriptions, expected] of [
		['German only', { de: { value: 'German description' } }, undefined],
		[
			'mul before arbitrary language',
			{ de: { value: 'German' }, mul: { value: 'Universal' } },
			'Universal',
		],
		['trimmed English', { en: { value: '  English  ' } }, 'English'],
		['blank English', { en: { value: '  ' } }, undefined],
		['requested French', { fr: { value: '  French  ' }, en: { value: 'English' } }, 'French'],
		...['en-gb', 'en-us', 'en-ca', 'en-au'].map(
			(locale) =>
				[
					locale,
					{ de: { value: 'German' }, [locale]: { value: '  Regional  ' } },
					'Regional',
				] as const
		),
	] as const) {
		it(`provider description policy: ${name}`, async () => {
			const ctx = createMockPluginContext();
			const plugin = createWikidataPlugin({
				language: 'fr',
				fetch: async (_url, init) => {
					expect(init?.signal).toBe(ctx.signal);
					return Response.json({ entities: { Q1: { id: 'Q1', descriptions } } });
				},
			});
			const artifacts = await plugin.enrich(
				createMockRequest({
					input: createMockAtomInput({ hints: { identifiers: { wikidata: 'Q1' } } }),
				}),
				ctx
			);
			expect(artifacts).toHaveLength(1);
			expect(artifacts[0]?.data.description).toBe(expected);
		});
	}
	for (const [name, labels, expected] of cases) {
		it(name, () => {
			expect(pickWikidataLabel(labels, 'fr')).toBe(expected);
		});
	}
	it('ignores inherited and prototype-named locale keys', () => {
		expect(pickWikidataLabel(Object.create({ en: { value: 'inherited' } }), 'en')).toBeUndefined();
		expect(
			pickWikidataLabel({ constructor: { value: 'bad' }, en: { value: 'safe' } }, 'constructor')
		).toBe('safe');
	});
	it('batch resolution refuses arbitrary language and uses regional fallback', async () => {
		const labels = await resolveWikidataEntityLabels(
			async () =>
				Response.json({
					entities: {
						Q1: { labels: { de: { value: 'x' } } },
						Q2: { labels: { 'en-ca': { value: 'Canadian' } } },
					},
				}),
			['Q1', 'Q2'],
			{ language: 'fr' }
		);
		expect(labels.has('Q1')).toBe(false);
		expect(labels.get('Q2')).toBe('Canadian');
	});
	it('provider uses the same stable locale fallbacks', async () => {
		const plugin = createWikidataPlugin({
			language: 'fr',
			fetch: async () =>
				Response.json({
					entities: {
						Q1: { id: 'Q1', labels: { de: { value: 'x' }, 'en-gb': { value: 'British' } } },
					},
				}),
		});
		const artifacts = await plugin.enrich(
			createMockRequest({
				input: createMockAtomInput({ hints: { identifiers: { wikidata: 'Q1' } } }),
			}),
			createMockPluginContext()
		);
		expect(artifacts[0]?.data.label).toBe('British');
	});
});
