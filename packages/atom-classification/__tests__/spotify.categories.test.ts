import { describe, expect, it } from 'bun:test';
import { createClassificationEngine } from '../src/engine';
import {
	createSpotifyDomainApiAdapter,
	createSpotifyPlugin,
	createV0TypeProfilesPlugin,
} from '../src/index';
import type { AtomClassificationPlugin } from '../src/plugins';

const fixtures = [
	['track', 'song', 'MusicRecording'],
	['album', 'music-album', 'MusicAlbum'],
	['artist', 'artist', 'MusicGroup'],
] as const;

describe('Spotify identity categories (ENG-15998)', () => {
	for (const [kind, category, schemaType] of fixtures) {
		for (const api of [false, true]) {
			it(`${kind} preserves its canonical id with ${api ? 'API' : 'generic'} resolution`, async () => {
				const calls: string[] = [];
				const url = `https://open.spotify.com/${kind}/abc123`;
				const adapter = createSpotifyDomainApiAdapter({
					fetch: async (endpoint) => {
						calls.push(endpoint);
						return {
							ok: true,
							status: 200,
							json: async () =>
								endpoint.includes('/api/token')
									? { access_token: 'fixture-token' }
									: { id: 'abc123', name: 'Fixture Name', external_urls: { spotify: url } },
						};
					},
				});
				const plugin = createSpotifyPlugin(
					api
						? {
								credentials: {
									spotify: { clientId: 'fixture-client', clientSecret: 'fixture-secret' },
								},
								adapters: { domainApi: adapter },
							}
						: {}
				);
				const result = await createClassificationEngine({
					runtime: 'server',
					plugins: [createV0TypeProfilesPlugin(), plugin],
				}).classify({
					input: url,
					mode: 'server-only',
					classificationSessionId: `spotify-${kind}-${api}`,
				});
				expect(result.resolved?.atoms[0]).toMatchObject({
					category,
					schemaType,
					canonicalId: `spotify:${kind}:abc123`,
				});
				expect(result.resolved?.classifications[0]?.type).toBe(schemaType);
				expect(calls).toHaveLength(api ? 2 : 0);
			});
		}
		it(`derives ${category} from a canonical ${schemaType} result`, async () => {
			const plugin: AtomClassificationPlugin = {
				...createSpotifyPlugin(),
				resolvers: [
					{
						id: 'spotify-canonical-only',
						canResolve: (c) => c.domain === 'spotify',
						resolve: () => ({
							classifications: [
								{
									type: schemaType,
									data: { name: 'Canonical Fixture', identifier: `spotify:${kind}:abc123` },
								},
							],
						}),
					},
				],
			};
			const result = await createClassificationEngine({
				runtime: 'server',
				plugins: [createV0TypeProfilesPlugin(), plugin],
			}).classify({
				input: `https://open.spotify.com/${kind}/abc123`,
				mode: 'server-only',
				classificationSessionId: `spotify-canonical-${kind}`,
			});
			expect(result.resolved?.atoms[0]?.category).toBe(category);
			expect(result.resolved?.atoms[0]?.schemaType).toBe(schemaType);
		});
	}
});
