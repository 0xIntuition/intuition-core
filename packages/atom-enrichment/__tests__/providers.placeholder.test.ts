import { describe, expect, it } from 'bun:test';
import { isSynthesizedProviderPlaceholderTitle } from '../src/plugins/providers/__shared__/request';
import { createMusicBrainzPlugin } from '../src/plugins/providers/musicbrainz';
import { createWikidataPlugin } from '../src/plugins/providers/wikidata';
import { createWikipediaPlugin } from '../src/plugins/providers/wikipedia';
import { createMockAtomInput, createMockPluginContext, createMockRequest } from '../src/testing';
import { classifiedAtomInputSchema } from '../src/types';

function request(name: string, provider = 'spotify', fallbackStage = 'generic') {
	return createMockRequest({
		input: createMockAtomInput({
			atomType: 'song',
			jsonLd: { '@type': 'MusicRecording', name },
			hints: { name, url: 'https://open.spotify.com/track/12345678' },
			source: { ...createMockAtomInput().source, ...{ provider, fallbackStage } },
		}),
	});
}

for (const [id, factory] of [
	['wikidata', createWikidataPlugin],
	['wikipedia', createWikipediaPlugin],
	['musicbrainz', createMusicBrainzPlugin],
] as const) {
	describe(`${id} placeholder guard`, () => {
		for (const name of ['Spotify Track 12345678', '12345678']) {
			it(`never searches synthesized title ${name}`, async () => {
				const calls: string[] = [];
				const plugin = factory({
					fetch: async (url) => {
						calls.push(url);
						return Response.json({});
					},
				});
				expect(plugin.supports(request(name))).toBe(false);
				expect(await plugin.enrich(request(name), createMockPluginContext())).toEqual([]);
				expect(calls).toEqual([]);
			});
		}
		for (const realTitle of ['A Real Song', 'Yesterday']) {
			it(`still searches real title ${realTitle} even from generic fallback`, async () => {
				const calls: string[] = [];
				const plugin = factory({
					fetch: async (url) => {
						calls.push(url);
						return Response.json({});
					},
				});
				expect(plugin.supports(request(realTitle))).toBe(true);
				await plugin.enrich(request(realTitle), createMockPluginContext());
				expect(calls).toHaveLength(1);
			});
		}
		it('rejects generic IMDb display titles', async () => {
			const plugin = factory({
				fetch: async () => {
					throw new Error('Unexpected search');
				},
			});
			const input = request('IMDb Title tt1234567', 'imdb');
			expect(plugin.supports(input)).toBe(false);
			expect(await plugin.enrich(input, createMockPluginContext())).toEqual([]);
		});
	});
}

it('source accepts only named provenance fields with bounds', () => {
	const input = request('A Real Song').input;
	expect(classifiedAtomInputSchema.safeParse(input).success).toBe(true);
	expect(
		classifiedAtomInputSchema.safeParse({ ...input, source: { ...input.source, unknown: true } })
			.success
	).toBe(false);
	expect(
		classifiedAtomInputSchema.safeParse({ ...input, source: { ...input.source, provider: '' } })
			.success
	).toBe(false);
	expect(
		classifiedAtomInputSchema.safeParse({
			...input,
			source: { ...input.source, fallbackStage: 'x'.repeat(65) },
		}).success
	).toBe(false);
});

it('preserves v2 generic-stage and Goodreads host policy', () => {
	for (const [provider, title] of [
		['amazon', 'Amazon Product B012345678'],
		['etsy', 'Etsy Listing 123'],
		['goodreads', 'Goodreads Book 123'],
		['imdb', 'IMDb Title tt1234567'],
		['instagram', 'Instagram Post abc'],
		['openlibrary', 'OpenLibrary Work OL123W'],
		['spotify', 'Spotify Album 12345678'],
		['steam', 'Steam App 123'],
		['tiktok', 'TikTok Video 123'],
		['tmdb', 'TMDB TV Series 123'],
		['youtube', 'YouTube Video abc'],
		['default-url', 'Website example.com'],
	] as const) {
		expect(isSynthesizedProviderPlaceholderTitle(request(title, provider))).toBe(true);
		expect(isSynthesizedProviderPlaceholderTitle(request(title, provider, 'open-api'))).toBe(false);
	}
	const goodreads = createMockRequest({
		input: createMockAtomInput({
			hints: { name: 'Goodreads Book 123', url: 'https://www.goodreads.com/book/show/123' },
		}),
	});
	expect(isSynthesizedProviderPlaceholderTitle(goodreads)).toBe(true);
	goodreads.input.hints = {
		name: 'Goodreads Book 123',
		url: 'https://goodreads.com.attacker.example/book/show/123',
	};
	expect(isSynthesizedProviderPlaceholderTitle(goodreads)).toBe(false);
});
it('identifier and URL lookups survive placeholder display names', async () => {
	const ctx = createMockPluginContext();
	const wikidata = createWikidataPlugin({
		fetch: async (url) => {
			expect(url).toContain('Special:EntityData/Q1');
			return Response.json({
				entities: { Q1: { id: 'Q1', labels: { en: { value: 'Real title' } } } },
			});
		},
	});
	const direct = request('Spotify Track 12345678');
	direct.input.hints = { ...direct.input.hints, identifiers: { wikidata: 'Q1' } };
	expect(wikidata.supports(direct)).toBe(true);
	expect(await wikidata.enrich(direct, ctx)).toHaveLength(1);
	const mb = createMusicBrainzPlugin({
		fetch: async (url) => {
			expect(new URL(url).searchParams.get('query')).toBe('isrc:USUM71703861');
			return Response.json({ recordings: [{ id: 'fixture', title: 'Real song' }] });
		},
	});
	direct.input.hints.identifiers = { isrc: 'USUM71703861' };
	expect(mb.supports(direct)).toBe(true);
	expect(await mb.enrich(direct, ctx)).toHaveLength(1);
	const wiki = createWikipediaPlugin({
		fetch: async (url) => {
			expect(url).toContain('/summary/Dune');
			return Response.json({ title: 'Dune', extract: '' });
		},
	});
	direct.input.hints = { ...direct.input.hints, url: 'https://en.wikipedia.org/wiki/Dune' };
	expect(wiki.supports(direct)).toBe(true);
	expect(await wiki.enrich(direct, ctx)).toHaveLength(1);
});
