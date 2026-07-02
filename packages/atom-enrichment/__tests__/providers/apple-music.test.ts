import { describe, expect, it } from 'bun:test';
import type { FetchLike } from '../../src/plugins/providers/__shared__/http';
import {
	createAppleMusicPlugin,
	parseAppleMusicUrl,
	parseApplePodcastsUrl,
} from '../../src/plugins/providers/apple-music';
import type { EnrichmentRequest } from '../../src/types';

function request(url: string): EnrichmentRequest {
	return {
		input: {
			atomType: 'song',
			jsonLd: { '@context': 'https://schema.org/', '@type': 'MusicRecording', url },
			source: { classificationEngine: 'url-first-manual', classifiedAt: '2026-06-11T00:00:00Z' },
			hints: { url },
		},
		runtime: 'server',
	};
}

const ctx = { now: () => '2026-06-11T00:00:00.000Z', signal: undefined, logger: console } as never;

// Live-shape iTunes Lookup result (Jack Johnson — Better Together).
const SONG_RESULT = {
	wrapperType: 'track',
	kind: 'song',
	trackId: 1440857786,
	trackName: 'Better Together',
	artistName: 'Jack Johnson',
	collectionName: 'In Between Dreams (Bonus Track Version)',
	trackViewUrl: 'https://music.apple.com/us/album/better-together/1440857781?i=1440857786',
	artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/a/100x100bb.jpg',
	previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a',
	releaseDate: '2005-03-01T08:00:00Z',
	trackTimeMillis: 207679,
	primaryGenreName: 'Rock',
};

function lookupFetcher(results: unknown[]): FetchLike {
	return (url) => {
		if (!url.includes('itunes.apple.com/lookup')) {
			throw new Error(`unexpected fetch ${url}`);
		}
		return Promise.resolve(
			new Response(JSON.stringify({ resultCount: results.length, results }), {
				headers: { 'content-type': 'application/json' },
			})
		);
	};
}

describe('parseAppleMusicUrl', () => {
	it('parses album urls', () => {
		expect(
			parseAppleMusicUrl('https://music.apple.com/us/album/in-between-dreams/1440857781')
		).toEqual({ kind: 'lookup', id: '1440857781', country: 'us' });
	});

	it('prefers the track id from the i query parameter', () => {
		expect(
			parseAppleMusicUrl('https://music.apple.com/us/album/better-together/1440857781?i=1440857786')
		).toEqual({ kind: 'lookup', id: '1440857786', country: 'us' });
	});

	it('parses artist urls with non-us storefronts', () => {
		expect(parseAppleMusicUrl('https://music.apple.com/de/artist/jack-johnson/909253')).toEqual({
			kind: 'lookup',
			id: '909253',
			country: 'de',
		});
	});

	it('rejects non apple-music urls', () => {
		expect(parseAppleMusicUrl('https://open.spotify.com/track/abc')).toBeUndefined();
		expect(parseAppleMusicUrl('https://www.apple.com/')).toBeUndefined();
	});
});

describe('apple-music plugin', () => {
	it('maps a song lookup including previewUrl and upscaled artwork', async () => {
		const plugin = createAppleMusicPlugin({ fetch: lookupFetcher([SONG_RESULT]) });
		const artifacts = await plugin.enrich(
			request('https://music.apple.com/us/album/better-together/1440857781?i=1440857786'),
			ctx
		);

		expect(artifacts).toHaveLength(1);
		expect(artifacts[0]?.data).toMatchObject({
			name: 'Better Together',
			type: 'song',
			appleMusicId: '1440857786',
			artistName: 'Jack Johnson',
			albumName: 'In Between Dreams (Bonus Track Version)',
			previewUrl: 'https://audio-ssl.itunes.apple.com/itunes-assets/preview.m4a',
			durationMs: 207679,
			genres: ['Rock'],
		});
		expect(artifacts[0]?.data.artworkUrl).toContain('600x600');
	});

	it('maps album lookups to the album type', async () => {
		const plugin = createAppleMusicPlugin({
			fetch: lookupFetcher([
				{
					wrapperType: 'collection',
					collectionId: 1440857781,
					collectionName: 'In Between Dreams',
					artistName: 'Jack Johnson',
					collectionViewUrl: 'https://music.apple.com/us/album/in-between-dreams/1440857781',
				},
			]),
		});
		const artifacts = await plugin.enrich(
			request('https://music.apple.com/us/album/in-between-dreams/1440857781'),
			ctx
		);
		expect(artifacts[0]?.data).toMatchObject({ name: 'In Between Dreams', type: 'album' });
	});

	it('returns nothing when the lookup has no results', async () => {
		const plugin = createAppleMusicPlugin({ fetch: lookupFetcher([]) });
		const artifacts = await plugin.enrich(
			request('https://music.apple.com/us/album/x/999999'),
			ctx
		);
		expect(artifacts).toHaveLength(0);
	});

	it('does not support non apple-music urls', () => {
		const plugin = createAppleMusicPlugin();
		expect(plugin.supports(request('https://example.com/'))).toBe(false);
	});
});

const PODCAST_RESULT = {
	wrapperType: 'track',
	kind: 'podcast',
	collectionId: 360084272,
	trackId: 360084272,
	collectionName: 'The Joe Rogan Experience',
	artistName: 'Joe Rogan',
	collectionViewUrl: 'https://podcasts.apple.com/us/podcast/the-joe-rogan-experience/id360084272',
	feedUrl: 'https://feeds.megaphone.fm/GLT1412515089',
	artworkUrl100: 'https://is1-ssl.mzstatic.com/image/thumb/p/100x100bb.jpg',
	primaryGenreName: 'Comedy',
};

function searchFetcher(results: unknown[]): FetchLike {
	return (url) => {
		if (!url.includes('itunes.apple.com/search')) {
			throw new Error(`unexpected fetch ${url}`);
		}
		return Promise.resolve(
			new Response(JSON.stringify({ resultCount: results.length, results }), {
				headers: { 'content-type': 'application/json' },
			})
		);
	};
}

function searchRequest(value: string): EnrichmentRequest {
	return {
		input: {
			atomType: 'thing',
			jsonLd: { '@context': 'https://schema.org/', '@type': 'PodcastSeries' },
			source: { classificationEngine: 'url-first-manual', classifiedAt: '2026-06-11T00:00:00Z' },
			hints: { identifiers: { itunesPodcastSearch: value } },
		},
		runtime: 'server',
	};
}

describe('apple podcasts support', () => {
	it('parses apple podcasts urls into podcast lookups', () => {
		expect(
			parseApplePodcastsUrl(
				'https://podcasts.apple.com/us/podcast/the-joe-rogan-experience/id360084272'
			)
		).toEqual({ kind: 'lookup', id: '360084272', country: 'us', media: 'podcast' });
		expect(parseApplePodcastsUrl('https://podcasts.apple.com/us/browse')).toBeUndefined();
	});

	it('maps a podcast lookup result with its rss feedUrl', async () => {
		const plugin = createAppleMusicPlugin({ fetch: lookupFetcher([PODCAST_RESULT]) });
		const artifacts = await plugin.enrich(
			request('https://podcasts.apple.com/us/podcast/the-joe-rogan-experience/id360084272'),
			ctx
		);
		expect(artifacts).toHaveLength(1);
		const data = artifacts[0]?.data as Record<string, unknown>;
		expect(data.type).toBe('podcast');
		expect(data.name).toBe('The Joe Rogan Experience');
		expect(data.feedUrl).toBe('https://feeds.megaphone.fm/GLT1412515089');
	});

	it('accepts a gated podcast search only when title and publisher corroborate', async () => {
		const plugin = createAppleMusicPlugin({ fetch: searchFetcher([PODCAST_RESULT]) });
		const matched = await plugin.enrich(searchRequest('The Joe Rogan Experience|Joe Rogan'), ctx);
		expect(matched).toHaveLength(1);
		expect((matched[0]?.data as Record<string, unknown>).appleMusicId).toBe('360084272');

		// Same title, wrong publisher → the gate refuses. Blank beats wrong.
		const refused = await plugin.enrich(
			searchRequest('The Joe Rogan Experience|Somebody Else'),
			ctx
		);
		expect(refused).toEqual([]);

		// Different title entirely → refused.
		const mismatch = await plugin.enrich(searchRequest('Lex Fridman Podcast|Lex Fridman'), ctx);
		expect(mismatch).toEqual([]);
	});
});
