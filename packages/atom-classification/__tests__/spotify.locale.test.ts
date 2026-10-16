import { describe, expect, it } from 'bun:test';
import { createClassificationEngine } from '../src/engine';
import {
	createDefaultUrlPlugin,
	createSpotifyDomainApiAdapter,
	createSpotifyPlugin,
	createV0TypeProfilesPlugin,
} from '../src/index';

const RESOURCE_ID = '4iV5W9uYEdYUVa79Axb7Rh';
const RESOURCE_TYPES = [
	['track', 'song'],
	['album', 'music-album'],
	['artist', 'artist'],
	['show', 'podcast'],
	['episode', 'podcast'],
] as const;

function createEngine(spotify = createSpotifyPlugin()) {
	return createClassificationEngine({
		runtime: 'server',
		now: () => new Date('2026-10-16T00:00:00.000Z'),
		plugins: [createV0TypeProfilesPlugin(), spotify, createDefaultUrlPlugin()],
	});
}

const request = (input: string) => ({
	input,
	mode: 'server-only' as const,
	classificationSessionId: 'spotify-locale',
});

describe('Spotify locale-prefixed URLs', () => {
	for (const [resourceType, category] of RESOURCE_TYPES) {
		it(`resolves localized ${resourceType} links to the ordinary URL identity and category`, async () => {
			const engine = createEngine();
			const canonicalUrl = `https://open.spotify.com/${resourceType}/${RESOURCE_ID}`;
			const ordinary = await engine.classify(request(canonicalUrl));
			expect(ordinary.classification).toMatchObject({ domain: 'spotify', subtype: resourceType });
			expect(ordinary.resolved?.atoms[0]).toMatchObject({
				canonicalId: `spotify:${resourceType}:${RESOURCE_ID}`,
				category,
				sameAs: [canonicalUrl],
			});
			for (const prefix of ['intl-en', 'intl-de', 'intl-pt-br', 'INTL-PT-BR']) {
				const localized = await engine.classify(
					request(`https://open.spotify.com/${prefix}/${resourceType}/${RESOURCE_ID}?si=share`)
				);
				expect(localized.classification).toEqual(ordinary.classification);
				expect(localized.resolved).toEqual(ordinary.resolved);
			}
		});
	}

	it('keeps unsupported plain and localized playlists on Core website fallback', async () => {
		const engine = createEngine();
		for (const prefix of ['', 'intl-de/', 'intl-pt-br/']) {
			const result = await engine.classify(
				request(`https://open.spotify.com/${prefix}playlist/${RESOURCE_ID}`)
			);
			expect(result.classification).toMatchObject({ domain: 'web', subtype: 'website' });
			expect(result.resolved?.atoms[0]?.schemaType).toBe('WebSite');
		}
	});

	for (const prefix of [
		'intl-deu',
		'intl-',
		'de',
		'en-US',
		'intl-1a',
		'intl-de-DE-extra',
		'intl-de_DE',
		'intl-d',
	]) {
		it(`rejects malformed locale prefix ${prefix}`, async () => {
			const result = await createEngine().classify(
				request(`https://open.spotify.com/${prefix}/track/${RESOURCE_ID}`)
			);
			expect(result.classification).toMatchObject({ domain: 'web', subtype: 'website' });
		});
	}

	for (const path of [`track/intl-de/${RESOURCE_ID}`, `intl-de/intl-pt-br/track/${RESOURCE_ID}`]) {
		it(`rejects locale segments in the type or id position: ${path}`, async () => {
			const result = await createEngine().classify(request(`https://open.spotify.com/${path}`));
			expect(result.classification).toMatchObject({ domain: 'web', subtype: 'website' });
		});
	}

	it('ignores a locale-shaped segment after the id like any other trailing segment', async () => {
		const engine = createEngine();
		const plain = await engine.classify(request(`https://open.spotify.com/track/${RESOURCE_ID}`));
		const trailing = await engine.classify(
			request(`https://open.spotify.com/track/${RESOURCE_ID}/intl-de`)
		);
		expect(trailing.classification).toEqual(plain.classification);
	});

	it('fetches track metadata for the resource after the locale prefix', async () => {
		const requestedUrls: string[] = [];
		const canonicalUrl = `https://open.spotify.com/track/${RESOURCE_ID}`;
		const engine = createEngine(
			createSpotifyPlugin({
				credentials: {
					spotify: { clientId: 'fixture-client', clientSecret: 'fixture-secret' },
				},
				adapters: {
					domainApi: createSpotifyDomainApiAdapter({
						market: 'US',
						fetch: async (url) => {
							requestedUrls.push(url);
							return {
								ok: true,
								status: 200,
								json: async () =>
									url.includes('/api/token')
										? { access_token: 'fixture-token' }
										: {
												id: RESOURCE_ID,
												name: 'Resolved track',
												external_urls: { spotify: canonicalUrl },
											},
							};
						},
					}),
				},
			})
		);
		const result = await engine.classify(
			request(`https://open.spotify.com/intl-en/track/${RESOURCE_ID}?si=share`)
		);
		expect(requestedUrls).toEqual([
			'https://accounts.spotify.com/api/token',
			`https://api.spotify.com/v1/tracks/${RESOURCE_ID}?market=US`,
		]);
		expect(result.resolved?.atoms[0]).toMatchObject({
			canonicalId: `spotify:track:${RESOURCE_ID}`,
			schemaType: 'MusicRecording',
			category: 'song',
			title: 'Resolved track',
			sameAs: [canonicalUrl],
		});
	});
});
