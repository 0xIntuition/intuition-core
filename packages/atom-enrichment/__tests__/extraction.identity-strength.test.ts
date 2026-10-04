import { describe, expect, it } from 'bun:test';
import { harvestChainIdentifiers } from '../src/extraction/chaining';
import { extractClassificationFields } from '../src/extraction/extract';
import { createWikidataPlugin } from '../src/plugins/providers/wikidata';
import { createWikipediaPlugin } from '../src/plugins/providers/wikipedia';
import {
	createMockArtifact,
	createMockAtomInput,
	createMockPluginContext,
	createMockRequest,
} from '../src/testing';
import { enrichmentArtifactMetaSchema } from '../src/types';

const movieUrl = 'https://en.wikipedia.org/wiki/Dune_(2021_film)';
const wikiData = {
	title: 'Dune',
	extract: 'A movie',
	pageUrl: movieUrl,
	language: 'en',
	wikibaseItem: 'Q1',
};
function artifact(type: string, strength: 'title' | 'identifier' | 'url') {
	return createMockArtifact({
		artifact_type: type,
		data:
			type === 'wikipedia'
				? { ...wikiData }
				: {
						entityId: 'Q1',
						label: 'Dune',
						claims: { P345: [{ mainsnak: { datavalue: { value: 'tt1234567' } } }] },
					},
		meta: {
			pluginId: type,
			provider: type,
			fetchedAt: '2026-01-01T00:00:00.000Z',
			...{ identityStrength: strength },
		},
	});
}

describe('identity strength', () => {
	for (const strength of ['title', 'url', 'identifier', undefined] as const) {
		it(`podcast identity and descriptions respect ${strength ?? 'legacy'} strength`, async () => {
			const spotify = createMockArtifact({
				artifact_type: 'spotify',
				data: {
					name: 'Wrong podcast',
					type: 'show',
					spotifyId: '12345678',
					spotifyUrl: 'https://open.spotify.com/show/12345678',
				},
				meta: {
					pluginId: 'spotify',
					provider: 'spotify',
					fetchedAt: '2026-01-01T00:00:00.000Z',
					identityStrength: strength,
				},
			});
			const result = await extractClassificationFields({
				classification: 'podcast-series',
				url: 'https://example.com/podcast',
				artifacts: [spotify],
			});
			expect(result.values.sameAs).toEqual(
				strength === 'title'
					? ['https://example.com/podcast']
					: ['https://example.com/podcast', spotify.data.spotifyUrl]
			);
			expect(result.values.name).toBe('Wrong podcast');
			expect(result.values.url).toBe(
				strength === 'title' ? 'https://example.com/podcast' : spotify.data.spotifyUrl
			);
		});
		it(`Wikipedia chaining respects ${strength ?? 'legacy'} strength`, () => {
			const wikipedia = artifact('wikipedia', 'title');
			wikipedia.meta.identityStrength = strength;
			expect(harvestChainIdentifiers([wikipedia])).toEqual(
				strength === 'title'
					? { identifiers: {}, pluginSlugs: [] }
					: { identifiers: { wikidata: 'Q1' }, pluginSlugs: ['wikidata'] }
			);
		});
		it(`Wikidata chaining respects ${strength ?? 'legacy'} strength`, () => {
			const wikidata = artifact('wikidata', 'title');
			wikidata.meta.identityStrength = strength;
			wikidata.data.claims = { P4947: [{ mainsnak: { datavalue: { value: '438631' } } }] };
			expect(harvestChainIdentifiers([wikidata])).toEqual(
				strength === 'title'
					? { identifiers: {}, pluginSlugs: [] }
					: { identifiers: { tmdb: 'movie:438631' }, pluginSlugs: ['tmdb'] }
			);
		});
	}
	it('chaining skips a title hit before strong evidence', () => {
		const title = artifact('wikipedia', 'title');
		const strong = artifact('wikipedia', 'url');
		strong.data.wikibaseItem = 'Q2';
		expect(harvestChainIdentifiers([title, strong])).toEqual({
			identifiers: { wikidata: 'Q2' },
			pluginSlugs: ['wikidata'],
		});
	});
	it('podcast sameAs uses strong evidence beside a title hit', async () => {
		const makeShow = (id: string, strength: 'title' | 'url') =>
			createMockArtifact({
				artifact_type: 'spotify',
				data: {
					name: `Podcast ${id}`,
					type: 'show',
					spotifyId: id,
					spotifyUrl: `https://open.spotify.com/show/${id}`,
				},
				meta: {
					pluginId: 'spotify',
					provider: 'spotify',
					fetchedAt: '2026-01-01T00:00:00.000Z',
					identityStrength: strength,
				},
			});
		const result = await extractClassificationFields({
			classification: 'podcast-series',
			url: 'https://example.com/podcast',
			artifacts: [makeShow('12345678', 'title'), makeShow('87654321', 'url')],
		});
		expect(result.values.sameAs).toEqual([
			'https://example.com/podcast',
			'https://open.spotify.com/show/87654321',
		]);
		expect(result.values.name).toBe('Podcast 12345678');
	});
	it('title-resolved Wikipedia movie cannot claim a Book sameAs', async () => {
		const result = await extractClassificationFields({
			classification: 'book',
			url: 'https://example.com/book',
			artifacts: [artifact('wikipedia', 'title')],
		});
		expect(result.values.sameAs).toEqual(['https://example.com/book']);
		expect(result.values.name).toBe('Dune');
	});
	it('provider-to-extraction pipeline keeps a Movie title hit out of Book identity', async () => {
		const ctx = createMockPluginContext();
		const plugin = createWikipediaPlugin({
			fetch: async (_url, init) => {
				expect(init?.signal).toBe(ctx.signal);
				return Response.json({
					title: 'Dune',
					extract: 'A movie',
					wikibase_item: 'Q1',
					content_urls: { desktop: { page: movieUrl } },
				});
			},
		});
		const artifacts = await plugin.enrich(
			createMockRequest({
				input: createMockAtomInput({
					jsonLd: { '@type': 'Book', name: 'Dune' },
					hints: { name: 'Dune' },
				}),
			}),
			ctx
		);
		const result = await extractClassificationFields({
			classification: 'book',
			url: 'https://example.com/book',
			artifacts,
		});
		expect(artifacts[0]?.meta.identityStrength).toBe('title');
		expect(result.values.sameAs).toEqual(['https://example.com/book']);
	});
	it('title-resolved Wikidata cannot claim QID or external-id URLs', async () => {
		const result = await extractClassificationFields({
			classification: 'movie',
			url: 'https://example.com/movie',
			artifacts: [artifact('wikidata', 'title')],
		});
		expect(result.values.sameAs).toEqual(['https://example.com/movie']);
	});
	it('strong evidence still contributes identities beside a title hit', async () => {
		const strong = artifact('wikidata', 'identifier');
		strong.data.entityId = 'Q2';
		const result = await extractClassificationFields({
			classification: 'movie',
			url: 'https://example.com/movie',
			artifacts: [artifact('wikidata', 'title'), strong, artifact('wikipedia', 'url')],
		});
		expect(result.values.sameAs).toEqual([
			'https://example.com/movie',
			movieUrl,
			'https://www.wikidata.org/wiki/Q2',
			'https://www.imdb.com/title/tt1234567/',
		]);
	});
	it('strict meta accepts the three strengths and rejects invalid fields', () => {
		for (const strength of ['title', 'identifier', 'url'] as const)
			expect(
				enrichmentArtifactMetaSchema.safeParse(artifact('wikidata', strength).meta).success
			).toBe(true);
		expect(
			enrichmentArtifactMetaSchema.safeParse({
				...artifact('wikidata', 'title').meta,
				identityStrength: 'guess',
			}).success
		).toBe(false);
		expect(
			enrichmentArtifactMetaSchema.safeParse({ ...artifact('wikidata', 'title').meta, extra: true })
				.success
		).toBe(false);
	});
	for (const direct of [false, true]) {
		it(`Wikidata marks ${direct ? 'QID' : 'name'} provenance`, async () => {
			const plugin = createWikidataPlugin({
				fetch: async (url) =>
					Response.json(
						url.includes('wbsearchentities')
							? { search: [{ id: 'Q1' }] }
							: { entities: { Q1: { id: 'Q1', labels: { en: { value: 'Dune' } } } } }
					),
			});
			const result = await plugin.enrich(
				createMockRequest({
					input: createMockAtomInput({
						hints: direct ? { identifiers: { wikidata: 'Q1' } } : { name: 'Dune' },
					}),
				}),
				createMockPluginContext()
			);
			expect(result[0]?.meta).toMatchObject({ identityStrength: direct ? 'identifier' : 'title' });
		});
		it(`Wikipedia marks ${direct ? 'URL' : 'name'} provenance`, async () => {
			const plugin = createWikipediaPlugin({
				fetch: async () =>
					Response.json({
						title: 'Dune',
						extract: 'A movie',
						content_urls: { desktop: { page: movieUrl } },
					}),
			});
			const result = await plugin.enrich(
				createMockRequest({
					input: createMockAtomInput({ hints: direct ? { url: movieUrl } : { name: 'Dune' } }),
				}),
				createMockPluginContext()
			);
			expect(result[0]?.meta).toMatchObject({ identityStrength: direct ? 'url' : 'title' });
		});
	}
});
