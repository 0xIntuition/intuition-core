import { expect, test } from 'bun:test';
import { createEnrichmentEngine } from '../src/engine';
import { createMusicBrainzPlugin } from '../src/plugins/providers/musicbrainz';
import {
	createPodcastIndexPlugin,
	resolvePodcastIndexTarget,
} from '../src/plugins/providers/podcast-index';
import { createMockPluginContext, createMockRequest } from '../src/testing';

function request(identifiers: Record<string, string>) {
	return createMockRequest({
		input: {
			atomType: 'thing',
			jsonLd: { '@type': 'MusicRecording' },
			source: { classificationEngine: 'fixture', classifiedAt: '2026-10-16T00:00:00Z' },
			hints: { identifiers },
		},
	});
}

for (const mbidType of ['artist', 'release-group', 'release', 'unknown', 'Recording']) {
	test(`MusicBrainz refuses ${mbidType} MBIDs without fetching`, async () => {
		const urls: string[] = [];
		const plugin = createMusicBrainzPlugin({
			fetch: async (url) => {
				urls.push(String(url));
				return new Response(JSON.stringify({ id: 'fixture', title: 'Fixture' }));
			},
		});
		const result = await createEnrichmentEngine({ plugins: [plugin] }).enrich(
			request({ mbid: 'fixture', mbidType, isrc: 'USUM71703861' })
		);
		expect(urls).toEqual([]);
		expect(result.skipped).toEqual([{ pluginId: 'musicbrainz', reason: 'not_applicable' }]);
	});
}

for (const mbidType of ['recording', undefined]) {
	test(`MusicBrainz preserves ${mbidType ?? 'untyped'} MBID requests`, async () => {
		const urls: string[] = [];
		const plugin = createMusicBrainzPlugin({
			fetch: async (url) => {
				urls.push(String(url));
				return new Response(JSON.stringify({ id: 'fixture', title: 'Fixture' }));
			},
		});
		const result = await createEnrichmentEngine({ plugins: [plugin] }).enrich(
			request({ mbid: 'fixture', ...(mbidType ? { mbidType } : {}) })
		);
		expect(urls).toEqual(['https://musicbrainz.org/ws/2/recording/fixture?fmt=json']);
		expect(result.artifacts).toHaveLength(1);
	});
}

test('Podcast Index feed-id hints fetch by feed id after iTunes and before URL', async () => {
	const urls: string[] = [];
	const plugin = createPodcastIndexPlugin({
		apiKey: 'synthetic-key',
		apiSecret: 'synthetic-secret',
		fetch: async (url) => {
			urls.push(String(url));
			return new Response(JSON.stringify({ status: 'true', feed: [] }));
		},
	});
	const input = request({ podcastIndexFeedId: '123' });
	expect(resolvePodcastIndexTarget(input)).toEqual({ kind: 'feedId', value: '123' });
	expect(plugin.supports(input)).toBe(true);
	await plugin.enrich(input, createMockPluginContext());
	expect(urls).toEqual(['https://api.podcastindex.org/api/1.0/podcasts/byfeedid?id=123']);
	expect(
		resolvePodcastIndexTarget(request({ podcastIndexFeedId: '123', itunesId: '456' }))
	).toEqual({ kind: 'itunesId', value: '456' });
	input.input.hints!.url = 'https://podcastindex.org/podcast/999';
	expect(resolvePodcastIndexTarget(input)).toEqual({ kind: 'feedId', value: '123' });
	for (const value of ['bad', '1.5', '-1']) {
		expect(resolvePodcastIndexTarget(request({ podcastIndexFeedId: value }))).toBeUndefined();
	}
});
