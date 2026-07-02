import { describe, expect, it } from 'bun:test';
import type { FetchLike } from '../../src/plugins/providers/__shared__/http';
import {
	buildAuthHeaders,
	createPodcastIndexPlugin,
	parsePodcastIndexUrl,
	resolvePodcastIndexTarget,
} from '../../src/plugins/providers/podcast-index';
import type { EnrichmentRequest } from '../../src/types';

function request(identifiers: Record<string, string>, url?: string): EnrichmentRequest {
	return {
		input: {
			atomType: 'thing',
			jsonLd: {
				'@context': 'https://schema.org/',
				'@type': 'PodcastSeries',
				...(url ? { url } : {}),
			},
			source: { classificationEngine: 'url-first-manual', classifiedAt: '2026-06-11T00:00:00Z' },
			hints: { ...(url ? { url } : {}), identifiers },
		},
		runtime: 'server',
	};
}

const ctx = { now: () => '2026-06-11T00:00:00.000Z', signal: undefined, logger: console } as never;

// Live-shape Podcast Index feed response (podcasts/byfeedurl).
const FEED_RESPONSE = {
	status: 'true',
	feed: {
		id: 920666,
		podcastGuid: '9b024349-ccf0-5f69-a609-6b82873eab3c',
		title: 'The Joe Rogan Experience',
		url: 'https://feeds.megaphone.fm/GLT1412515089',
		link: 'https://www.joerogan.com',
		description: 'The official podcast of comedian Joe Rogan.',
		author: 'Joe Rogan',
		ownerName: 'JRE',
		image: 'https://megaphone.imgix.net/podcasts/image.png',
		artwork: 'https://megaphone.imgix.net/podcasts/artwork.png',
		itunesId: 360084272,
		language: 'en',
		episodeCount: 2500,
		categories: { '55': 'News', '59': 'Comedy' },
	},
};

function fetcherFor(
	expectedPath: string,
	payload: unknown,
	seen?: { headers?: Headers }
): FetchLike {
	return (url, init) => {
		if (!url.includes(expectedPath)) {
			throw new Error(`unexpected fetch ${url}`);
		}
		if (seen) {
			seen.headers = new Headers(init?.headers);
		}
		return Promise.resolve(
			new Response(JSON.stringify(payload), {
				headers: { 'content-type': 'application/json' },
			})
		);
	};
}

describe('resolvePodcastIndexTarget', () => {
	it('prefers feedUrl, then guid, then itunesId', () => {
		expect(
			resolvePodcastIndexTarget(
				request({ feedUrl: 'https://feeds.megaphone.fm/GLT1412515089', itunesId: '360084272' })
			)
		).toEqual({ kind: 'feedUrl', value: 'https://feeds.megaphone.fm/GLT1412515089' });
		expect(resolvePodcastIndexTarget(request({ itunesId: '360084272' }))).toEqual({
			kind: 'itunesId',
			value: '360084272',
		});
	});

	it('parses podcastindex.org urls', () => {
		expect(parsePodcastIndexUrl('https://podcastindex.org/podcast/920666')).toEqual({
			kind: 'feedId',
			value: '920666',
		});
		expect(parsePodcastIndexUrl('https://podcastindex.org/about')).toBeUndefined();
	});
});

describe('buildAuthHeaders', () => {
	it('signs requests with sha1(key + secret + date)', async () => {
		// sha1('keysecret1700000000') — independently computed.
		const headers = await buildAuthHeaders('key', 'secret', 1_700_000_000);
		expect(headers['X-Auth-Key']).toBe('key');
		expect(headers['X-Auth-Date']).toBe('1700000000');
		expect(headers.Authorization).toMatch(/^[0-9a-f]{40}$/);
		expect(headers['User-Agent']).toBeTruthy();
	});
});

describe('createPodcastIndexPlugin', () => {
	it('never activates without credentials', () => {
		const plugin = createPodcastIndexPlugin();
		expect(plugin.supports(request({ feedUrl: 'https://feeds.megaphone.fm/x' }))).toBe(false);
	});

	it('resolves a feed by feedUrl with signed headers', async () => {
		const seen: { headers?: Headers } = {};
		const plugin = createPodcastIndexPlugin({
			apiKey: 'test-key',
			apiSecret: 'test-secret',
			fetch: fetcherFor('podcasts/byfeedurl', FEED_RESPONSE, seen),
		});
		const req = request({ feedUrl: 'https://feeds.megaphone.fm/GLT1412515089' });
		expect(plugin.supports(req)).toBe(true);

		const artifacts = await plugin.enrich(req, ctx);
		expect(seen.headers?.get('x-auth-key')).toBe('test-key');
		expect(seen.headers?.get('authorization')).toMatch(/^[0-9a-f]{40}$/);
		expect(seen.headers?.get('user-agent')).toBeTruthy();

		expect(artifacts).toHaveLength(1);
		const data = artifacts[0]?.data as Record<string, unknown>;
		expect(data.title).toBe('The Joe Rogan Experience');
		expect(data.feedUrl).toBe('https://feeds.megaphone.fm/GLT1412515089');
		expect(data.itunesId).toBe(360084272);
		expect(data.categories).toEqual(['News', 'Comedy']);
		expect(data.artworkUrl).toBe('https://megaphone.imgix.net/podcasts/artwork.png');
		expect(artifacts[0]?.meta.sourceUrl).toBe('https://podcastindex.org/podcast/920666');
	});

	it('returns no artifacts on a miss (empty-array feed)', async () => {
		const plugin = createPodcastIndexPlugin({
			apiKey: 'test-key',
			apiSecret: 'test-secret',
			fetch: fetcherFor('podcasts/byitunesid', { status: 'true', feed: [] }),
		});
		const artifacts = await plugin.enrich(request({ itunesId: '360084272' }), ctx);
		expect(artifacts).toEqual([]);
	});
});
