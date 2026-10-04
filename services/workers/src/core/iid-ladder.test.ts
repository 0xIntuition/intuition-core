import { describe, expect, test } from 'bun:test';
import type { PublicIidInspection } from './iid-inspection';
import { createIidLadderAdapter } from './iid-ladder';

const provenance = { producer: 'inspection', version: '1.2.3' };
const fake = {
	IDENTITY_CATEGORY_RUNG_POLICY: {
		book: ['isbn'],
		album: ['mbid:release-group', 'wd', 'spotify:album'],
		movie: ['wd:film'],
		artist: ['wd'],
		podcast: ['isbn'],
	},
	IDENTITY_CATEGORY_ALIAS_ONLY_POLICY: { album: ['gtin'], podcast: ['wd'] },
	SCHEMA_TYPE_IDENTITY_CATEGORIES: {
		Book: 'book',
		MusicAlbum: 'album',
		Movie: 'movie',
		MusicGroup: 'artist',
		PodcastSeries: 'podcast',
	},
	identityRungsForCategory(category: string) {
		return [
			...(this.IDENTITY_CATEGORY_RUNG_POLICY[
				category as keyof typeof this.IDENTITY_CATEGORY_RUNG_POLICY
			] ?? []),
			...(category === 'album' ? ['gtin'] : []),
		];
	},
	iidForIdentityRung(rung: string, value: string) {
		return value === 'invalid' ? undefined : `int:${rung}:${value}`;
	},
	isPlainWdPrimaryAllowed: (schemaType?: string) => schemaType === 'MusicGroup',
	projectIdentifierLadder(input: {
		providerCanonicalId?: string;
		canonicalUrl?: string;
		allowPlainWd?: boolean;
	}) {
		if (input.providerCanonicalId?.startsWith('int:'))
			return { iid: input.providerCanonicalId, rung: 'strong' };
		if (input.providerCanonicalId?.startsWith('spotify:album:'))
			return { iid: `int:${input.providerCanonicalId}`, rung: 'handle' };
		if (input.canonicalUrl) return { iid: `int:url:${input.canonicalUrl}`, rung: 'url' };
		return { iid: null };
	},
	packageVersion: '1.2.3',
};

const inspection = {
	inspect(iid: string): PublicIidInspection {
		const fixtures: Record<string, { scheme: string; value: string; typing?: 'polymorphic' }> = {
			'int:isbn:9780684832722': { scheme: 'isbn', value: '9780684832722' },
			'int:gtin:00012345678905': { scheme: 'gtin', value: '00012345678905' },
			'int:wd:film:Q83495': { scheme: 'wd', value: 'film:Q83495' },
			'int:wd:Q42': { scheme: 'wd', value: 'Q42', typing: 'polymorphic' },
			'int:wd:Q188035': { scheme: 'wd', value: 'Q188035', typing: 'polymorphic' },
			'int:url:https://example.com/book': {
				scheme: 'url',
				value: 'https://example.com/book',
				typing: 'polymorphic',
			},
			'int:spotify:album:provider-id': { scheme: 'spotify', value: 'album:provider-id' },
			'int:mbid:release-group:album-id': { scheme: 'mbid', value: 'release-group:album-id' },
		};
		const fixture = fixtures[iid];
		return fixture
			? {
					valid: true,
					iid,
					...fixture,
					class: 'A',
					typing: fixture.typing ?? 'unambiguous',
					anchorEligible: true,
				}
			: { valid: false, reason: 'malformed' };
	},
};

function identityFor(iid: string) {
	const result = inspection.inspect(iid);
	if (!result.valid) throw new Error('Missing inspection fixture');
	return {
		raw: iid,
		canonical: iid,
		scheme: result.scheme,
		value: result.value,
		anchorEligible: result.anchorEligible,
		provenance,
	};
}

describe('injected IID ladder policy', () => {
	const adapter = () => createIidLadderAdapter(fake, inspection);
	test('a legacy ladder without the P31 function exposes no enrichment capability', () => {
		expect(adapter().resolveWikidataSchemaType).toBeUndefined();
		expect(adapter().wikidataTypeProvenance).toBeUndefined();
	});
	test('delegates P31 schema resolution to the injected module with provenance', () => {
		const calls: string[][] = [];
		const module = {
			...fake,
			resolveWikidataP31Identity(p31: readonly string[]) {
				calls.push([...p31]);
				return { schemaType: p31.includes('Q11424') ? 'Movie' : 'Thing' };
			},
		};
		const result = createIidLadderAdapter(module, inspection);
		expect(result.resolveWikidataSchemaType?.(['Q11424'])).toBe('Movie');
		expect(result.resolveWikidataSchemaType?.(['Q999999'])).toBeUndefined();
		expect(calls).toEqual([['Q11424'], ['Q999999']]);
		expect(result.wikidataTypeProvenance).toEqual({
			producer: '@0xintuition/iid-ladder/resolveWikidataP31Identity',
			version: '1.2.3',
		});
	});
	test.each([
		'identity',
		'providerCanonicalId',
		'canonicalUrl',
	] as const)('finding 1: album GTIN stays alias-only through %s', (path) => {
		const iid = 'int:gtin:00012345678905';
		const module = {
			...fake,
			projectIdentifierLadder: () => ({ iid, rung: 'strong' }),
		};
		const result = createIidLadderAdapter(module, inspection).projectIdentityRungs({
			schemaType: 'MusicAlbum',
			identifiers: { gtin: '00012345678905' },
			...(path === 'identity' ? { identity: identityFor(iid) } : { [path]: iid }),
		});
		expect(result.primary).toBeUndefined();
		expect(result.rungs).toEqual([{ rung: 'gtin', value: '00012345678905', iid, aliasOnly: true }]);
	});
	test('finding 1: podcast typed WD provider fallback stays alias-only', () => {
		const result = adapter().projectIdentityRungs({
			schemaType: 'PodcastSeries',
			providerCanonicalId: 'int:wd:film:Q83495',
		});
		expect(result.primary).toBeUndefined();
		expect(result.rungs).toContainEqual(
			expect.objectContaining({ iid: 'int:wd:film:Q83495', aliasOnly: true })
		);
	});
	test.each([
		'identity',
		'providerCanonicalId',
		'canonicalUrl',
	] as const)('finding 2: canonical URL IID is excluded through %s', (path) => {
		const iid = 'int:url:https://example.com/book';
		const result = createIidLadderAdapter(
			{ ...fake, projectIdentifierLadder: () => ({ iid, rung: 'strong' }) },
			inspection
		).projectIdentityRungs({
			schemaType: 'Book',
			...(path === 'identity' ? { identity: identityFor(iid) } : { [path]: iid }),
		});
		expect(result.primary).toBeUndefined();
		expect(result.rungs).toEqual([]);
	});
	test('finding 3: missing legacy typing cannot admit plain WD for Movie', () => {
		expect(
			adapter().projectIdentityRungs({ schemaType: 'Movie', identity: identityFor('int:wd:Q42') })
				.primary
		).toBeUndefined();
	});
	test('package inspection admits typed WD and policy-admitted legacy plain WD', () => {
		expect(
			adapter().projectIdentityRungs({
				schemaType: 'Movie',
				identity: identityFor('int:wd:film:Q83495'),
			}).primary?.iid
		).toBe('int:wd:film:Q83495');
		expect(
			adapter().projectIdentityRungs({
				schemaType: 'MusicGroup',
				identity: identityFor('int:wd:Q42'),
			}).primary?.iid
		).toBe('int:wd:Q42');
	});
	test('retains inspected ISBN identity as primary', () => {
		expect(
			adapter().projectIdentityRungs({
				schemaType: 'Book',
				identity: {
					raw: 'isbn',
					canonical: 'int:isbn:9780684832722',
					scheme: 'isbn',
					value: '9780684832722',
					anchorEligible: true,
					provenance,
				},
			})
		).toMatchObject({
			primary: { rung: 'isbn', iid: 'int:isbn:9780684832722' },
			provenance: { version: '1.2.3' },
		});
	});
	test('selects mbid before provider identity and retains gtin only as an alias', () => {
		expect(
			adapter().projectIdentityRungs({
				schemaType: 'MusicAlbum',
				identifiers: {
					'mbid:release-group': 'album-id',
					gtin: '123',
					'spotify:album': 'provider-id',
				},
			})
		).toMatchObject({
			category: 'album',
			primary: { rung: 'mbid:release-group', iid: 'int:mbid:release-group:album-id' },
			rungs: [
				{ rung: 'mbid:release-group', aliasOnly: false },
				{ rung: 'spotify:album', aliasOnly: false },
				{ rung: 'gtin', aliasOnly: true },
			],
		});
	});
	test('does not mint a Movie primary from bare Q or infer a typed binding', () => {
		expect(
			adapter().projectIdentityRungs({ schemaType: 'Movie', identifiers: { wd: 'Q188035' } })
				.primary
		).toBeUndefined();
	});
	test('admits plain wd only through the module policy', () => {
		expect(
			adapter().projectIdentityRungs({ schemaType: 'MusicGroup', identifiers: { wd: 'Q42' } })
				.primary
		).toEqual({ rung: 'wd', iid: 'int:wd:Q42' });
		expect(
			adapter().projectIdentityRungs({ schemaType: 'MusicAlbum', identifiers: { wd: 'Q42' } })
				.primary
		).toBeUndefined();
	});
	test('R16 flip path: selects a provider primary when the injected fake module admits it', () => {
		expect(
			adapter().projectIdentityRungs({
				schemaType: 'MusicAlbum',
				providerCanonicalId: 'spotify:album:provider-id',
			}).primary
		).toEqual({ rung: 'handle', iid: 'int:spotify:album:provider-id' });
	});
	test('keeps url-only input from minting a primary', () => {
		const result = adapter().projectIdentityRungs({
			schemaType: 'Book',
			canonicalUrl: 'https://example.com/book',
		});
		expect(result.primary).toBeUndefined();
		expect(result.rungs).toEqual([]);
	});
	test('does not select alias-only or invalid evidence and handles unknown categories', () => {
		expect(
			adapter().projectIdentityRungs({
				schemaType: 'MusicAlbum',
				identifiers: { gtin: '123', 'mbid:release-group': 'invalid' },
			}).primary
		).toBeUndefined();
		expect(adapter().projectIdentityRungs({ category: 'constructor' }).rungs).toEqual([]);
	});
	test('rejects inspected plain wd when the schema policy denies it', () => {
		expect(
			adapter().projectIdentityRungs({
				schemaType: 'Movie',
				identity: {
					raw: 'int:wd:Q188035',
					canonical: 'int:wd:Q188035',
					scheme: 'wd',
					value: 'Q188035',
					typing: 'polymorphic',
					anchorEligible: false,
					provenance,
				},
			}).primary
		).toBeUndefined();
	});
});
