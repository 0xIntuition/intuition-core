import { describe, expect, test } from 'bun:test';
import {
	schemaTypesAgree,
	wikidataTypeAgreement,
} from '../src/plugins/providers/__shared__/wikidata-type';

const claims = { P31: [{ mainsnak: { datavalue: { value: { id: 'Q11424' } } } }] };

describe('schema vocabulary agreement', () => {
	for (const family of [
		['TVSeries', 'TVSeason', 'TVEpisode'],
		['MusicAlbum', 'MusicRecording'],
		['Person', 'Organization', 'MusicGroup'],
	]) {
		for (const expected of family) {
			for (const actual of family) {
				test(`${expected} agrees with ${actual}`, () => {
					expect(schemaTypesAgree(expected, actual)).toBe(true);
				});
			}
		}
	}
	test('exact, multi-type, mismatched and invalid expectations', () => {
		expect(schemaTypesAgree('Book', 'Book')).toBe(true);
		expect(schemaTypesAgree(['Book', 'Movie'], 'Movie')).toBe(true);
		expect(schemaTypesAgree('Book', 'Movie')).toBe(false);
		expect(schemaTypesAgree('Movie', 'TVSeries')).toBe(false);
		expect(schemaTypesAgree(undefined, 'Movie')).toBe(false);
		expect(schemaTypesAgree([null, 1], 'Movie')).toBe(false);
	});
});

describe('injected P31 agreement', () => {
	test('passes extracted P31 IDs to the sole injected policy authority', () => {
		const seen: string[][] = [];
		const identity = {
			fingerprint: 'test-policy@1',
			resolveWikidataSchemaType: (ids: string[]) => {
				seen.push(ids);
				return 'Movie';
			},
		};
		expect(wikidataTypeAgreement(claims, 'Movie', identity)).toBe('agree');
		expect(wikidataTypeAgreement(claims, 'Book', identity)).toBe('mismatch');
		expect(wikidataTypeAgreement(claims, ['Thing', 'Movie'], identity)).toBe('agree');
		expect(seen).toEqual([['Q11424'], ['Q11424'], ['Q11424']]);
	});
	test('absent capability is unknown for every expected type', () => {
		for (const expected of ['Movie', 'Book', 'Thing', undefined, ['Movie', 'Book']])
			expect(wikidataTypeAgreement(claims, expected)).toBe('unknown');
	});
	test('generic or missing expectation is unknown without calling policy', () => {
		const identity = {
			fingerprint: 'test-policy@1',
			resolveWikidataSchemaType: () => {
				throw new Error('No specific expectation');
			},
		};
		for (const expected of ['Thing', undefined, null, '', [], ['Thing'], [null, 1]])
			expect(wikidataTypeAgreement(claims, expected, identity)).toBe('unknown');
	});
	test('unknown module output and absent P31 remain unknown', () => {
		for (const actual of [undefined, 'Thing']) {
			const identity = { fingerprint: 'test-policy@1', resolveWikidataSchemaType: () => actual };
			expect(wikidataTypeAgreement(claims, 'Movie', identity)).toBe('unknown');
		}
		const identity = {
			fingerprint: 'test-policy@1',
			resolveWikidataSchemaType: (ids: string[]) => (ids.length ? 'Movie' : undefined),
		};
		for (const input of [undefined, null, {}, { P31: [null, {}] }])
			expect(wikidataTypeAgreement(input, 'Movie', identity)).toBe('unknown');
	});
	test('the existing claim reader honors preferred and deprecated ranks', () => {
		const statement = (id: string, rank: string) => ({
			rank,
			mainsnak: { datavalue: { value: { id } } },
		});
		let seen: string[] = [];
		const identity = {
			fingerprint: 'test-policy@1',
			resolveWikidataSchemaType: (ids: string[]) => {
				seen = ids;
				return 'Person';
			},
		};
		expect(
			wikidataTypeAgreement(
				{
					P31: [
						statement('Q11424', 'normal'),
						statement('Q5', 'preferred'),
						statement('Q571', 'deprecated'),
					],
				},
				'Person',
				identity
			)
		).toBe('agree');
		expect(seen).toEqual(['Q5']);
	});
});
