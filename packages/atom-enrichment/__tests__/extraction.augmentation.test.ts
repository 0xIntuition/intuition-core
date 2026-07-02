import { describe, expect, it } from 'bun:test';
import { harvestAugmentationLookups, mergeHarvests } from '../src/extraction/augmentation';
import type { EnrichmentArtifact } from '../src/types';

function artifact(artifactType: string, data: Record<string, unknown>): EnrichmentArtifact {
	return {
		artifact_type: artifactType,
		data,
		meta: {
			pluginId: artifactType,
			provider: artifactType,
			fetchedAt: '2026-06-11T00:00:00.000Z',
		},
	};
}

const SPOTIFY_SHOW = {
	name: 'The Joe Rogan Experience',
	type: 'show',
	spotifyId: '4rOoJ6Egrf8K2IrywzwOMk',
	spotifyUrl: 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
	publisher: 'Joe Rogan',
};

const APPLE_PODCAST = {
	name: 'The Joe Rogan Experience',
	type: 'podcast',
	appleMusicId: '360084272',
	appleMusicUrl: 'https://podcasts.apple.com/us/podcast/the-joe-rogan-experience/id360084272',
	artistName: 'Joe Rogan',
	feedUrl: 'https://feeds.megaphone.fm/GLT1412515089',
};

describe('harvestAugmentationLookups', () => {
	it('chains a spotify show into a publisher-corroborated iTunes podcast search', () => {
		const harvest = harvestAugmentationLookups([artifact('spotify', SPOTIFY_SHOW)]);
		expect(harvest.identifiers.itunesPodcastSearch).toBe('The Joe Rogan Experience|Joe Rogan');
		expect(harvest.pluginSlugs).toEqual(['apple-music']);
	});

	it('searches by the parent show for spotify episodes', () => {
		const harvest = harvestAugmentationLookups([
			artifact('spotify', {
				name: '#2513 - Dean Radin',
				type: 'episode',
				spotifyId: 'abc123def456',
				spotifyUrl: 'https://open.spotify.com/episode/abc123def456',
				showName: 'The Joe Rogan Experience',
				publisher: 'Joe Rogan',
			}),
		]);
		expect(harvest.identifiers.itunesPodcastSearch).toBe('The Joe Rogan Experience|Joe Rogan');
	});

	it('never searches catalogs with generated fallback names', () => {
		const harvest = harvestAugmentationLookups([
			artifact('spotify', {
				...SPOTIFY_SHOW,
				name: 'Show 4rOoJ6Egrf8K2IrywzwOMk',
				publisher: undefined,
			}),
		]);
		expect(harvest.pluginSlugs).toEqual([]);
	});

	it('skips the iTunes hop when an apple-music artifact already exists', () => {
		const harvest = harvestAugmentationLookups([
			artifact('spotify', SPOTIFY_SHOW),
			artifact('apple-music', APPLE_PODCAST),
		]);
		expect(harvest.identifiers.itunesPodcastSearch).toBeUndefined();
	});

	it('chains an apple podcast feedUrl into podcast-index', () => {
		const harvest = harvestAugmentationLookups([artifact('apple-music', APPLE_PODCAST)]);
		expect(harvest.identifiers.feedUrl).toBe('https://feeds.megaphone.fm/GLT1412515089');
		expect(harvest.pluginSlugs).toEqual(['podcast-index']);
	});

	it('falls back to itunesId when the apple podcast has no feedUrl', () => {
		const { feedUrl: _omitted, ...withoutFeed } = APPLE_PODCAST;
		const harvest = harvestAugmentationLookups([artifact('apple-music', withoutFeed)]);
		expect(harvest.identifiers.itunesId).toBe('360084272');
		expect(harvest.pluginSlugs).toEqual(['podcast-index']);
	});

	it('chains a podcast-index itunesId back to the iTunes catalog', () => {
		const harvest = harvestAugmentationLookups([
			artifact('podcast-index', {
				podcastIndexId: 920666,
				title: 'The Joe Rogan Experience',
				feedUrl: 'https://feeds.megaphone.fm/GLT1412515089',
				itunesId: 360084272,
			}),
		]);
		expect(harvest.identifiers.itunesId).toBe('360084272');
		expect(harvest.pluginSlugs).toEqual(['apple-music']);
	});

	it('ignores music artifacts and stays empty', () => {
		const harvest = harvestAugmentationLookups([
			artifact('spotify', { ...SPOTIFY_SHOW, type: 'track' }),
		]);
		expect(harvest.pluginSlugs).toEqual([]);
		expect(harvest.identifiers).toEqual({});
	});
});

describe('mergeHarvests', () => {
	it('unions identifiers and slugs, first value winning per key', () => {
		const merged = mergeHarvests(
			{ identifiers: { wikidata: 'Q1' }, pluginSlugs: ['wikidata'] },
			{
				identifiers: { wikidata: 'Q2', feedUrl: 'https://a.example/rss' },
				pluginSlugs: ['podcast-index', 'wikidata'],
			}
		);
		expect(merged.identifiers).toEqual({ wikidata: 'Q1', feedUrl: 'https://a.example/rss' });
		expect(merged.pluginSlugs).toEqual(['wikidata', 'podcast-index']);
	});
});
