import { describe, expect, it } from 'bun:test';
import { harvestChainIdentifiers } from '../src/extraction/chaining';
import { suggestClassifications } from '../src/extraction/suggest';
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

function stringClaim(value: string) {
	return [{ mainsnak: { datavalue: { value } }, rank: 'normal' }];
}

describe('harvestChainIdentifiers', () => {
	it('harvests the wikidata pivot from a wikipedia artifact', () => {
		const harvest = harvestChainIdentifiers([
			artifact('wikipedia', {
				title: 'Inception',
				extract: 'A film.',
				pageUrl: 'https://en.wikipedia.org/wiki/Inception',
				language: 'en',
				wikibaseItem: 'Q25188',
			}),
		]);
		expect(harvest.identifiers.wikidata).toBe('Q25188');
		expect(harvest.pluginSlugs).toEqual(['wikidata']);
	});

	it('fans wikidata external ids out to tmdb, youtube, brand, and places', () => {
		const harvest = harvestChainIdentifiers([
			artifact('wikidata', {
				entityId: 'Q25188',
				label: 'Inception',
				claims: {
					P4947: stringClaim('27205'),
					P1651: stringClaim('bewVnEugEqE'),
					P856: stringClaim('https://www.inceptionmovie.com/'),
					P625: [
						{
							mainsnak: { datavalue: { value: { latitude: 48.8583701, longitude: 2.2944813 } } },
							rank: 'normal',
						},
					],
				},
			}),
		]);

		expect(harvest.identifiers.tmdb).toBe('movie:27205');
		expect(harvest.identifiers.youtubeVideoId).toBe('bewVnEugEqE');
		expect(harvest.identifiers.domain).toBe('inceptionmovie.com');
		expect(harvest.identifiers.placeQuery).toBe('Inception');
		expect(harvest.identifiers.placeLatitude).toBe('48.8583701');
		expect(harvest.pluginSlugs.sort()).toEqual(['brand', 'places', 'tmdb', 'youtube']);
	});

	it('does not re-run plugins that already produced artifacts', () => {
		const harvest = harvestChainIdentifiers([
			artifact('wikipedia', {
				title: 'Inception',
				extract: 'A film.',
				pageUrl: 'https://en.wikipedia.org/wiki/Inception',
				language: 'en',
				wikibaseItem: 'Q25188',
			}),
			artifact('wikidata', { entityId: 'Q25188', label: 'Inception', claims: {} }),
		]);
		expect(harvest.pluginSlugs).toEqual([]);
	});

	it('maps spotify external ids to the spotify identifier keys', () => {
		const harvest = harvestChainIdentifiers([
			artifact('wikidata', {
				entityId: 'Q1',
				label: 'Some Song',
				claims: { P2207: stringClaim('3n3Ppam7vgaVa1iaRUc9Lp') },
			}),
		]);
		expect(harvest.identifiers.spotifyTrackId).toBe('3n3Ppam7vgaVa1iaRUc9Lp');
		expect(harvest.pluginSlugs).toEqual(['spotify']);
	});

	it('returns nothing for artifacts without chainable ids', () => {
		const harvest = harvestChainIdentifiers([artifact('opengraph', { title: 'Some Page' })]);
		expect(harvest.identifiers).toEqual({});
		expect(harvest.pluginSlugs).toEqual([]);
	});
});

describe('suggestClassifications', () => {
	it('suggests from provider url families', () => {
		expect(
			suggestClassifications('https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp', [])
		).toEqual(['music-recording']);
		expect(suggestClassifications('https://github.com/ethereum/go-ethereum', [])).toEqual([
			'software',
		]);
		expect(suggestClassifications('https://maps.app.goo.gl/SFg1zVc8kSzsxs6U9', [])).toEqual([
			'local-business',
			'location',
		]);
		expect(suggestClassifications('https://www.amazon.com/dp/B0ABC12345', [])).toEqual(['product']);
		expect(suggestClassifications('https://x.com/VitalikButerin', [])).toEqual([
			'social-media-account',
			'person',
		]);
	});

	it('suggests from wikidata instance-of claims', () => {
		const suggestions = suggestClassifications('https://en.wikipedia.org/wiki/Vitalik_Buterin', [
			artifact('wikidata', {
				entityId: 'Q16197959',
				label: 'Vitalik Buterin',
				claims: {},
				instanceOf: ['Q5'],
			}),
		]);
		expect(suggestions).toEqual(['person']);
	});

	it('returns nothing without a deterministic signal', () => {
		expect(suggestClassifications('https://example.com/some-page', [])).toEqual([]);
	});
});

describe('spotify podcast suggestions', () => {
	it('suggests podcast classifications for show and episode urls', () => {
		expect(
			suggestClassifications('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk?si=x', [])
		).toEqual(['podcast-series']);
		expect(suggestClassifications('https://open.spotify.com/episode/abc123', [])).toEqual([
			'podcast-episode',
		]);
	});
});
