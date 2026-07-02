import { describe, expect, it } from 'bun:test';

import { createSpotifyPlugin } from '../src/plugins/providers/spotify';
import { createMockAtomInput, createMockPluginContext, createMockRequest } from '../src/testing';

describe('spotify enrichment provider', () => {
	it('returns URL-derived fallback artifacts for podcast shows and episodes without credentials', async () => {
		const plugin = createSpotifyPlugin();
		const ctx = createMockPluginContext();

		const showArtifacts = await plugin.enrich(
			createMockRequest({
				input: createMockAtomInput({
					hints: {
						name: 'Fallback Show',
						url: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
					},
				}),
			}),
			ctx
		);
		const episodeArtifacts = await plugin.enrich(
			createMockRequest({
				input: createMockAtomInput({
					hints: {
						name: 'Fallback Episode',
						url: 'https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ',
					},
				}),
			}),
			ctx
		);

		expect(showArtifacts[0]?.data).toMatchObject({
			name: 'Fallback Show',
			type: 'show',
			spotifyId: '38bS44xjbVVZ3No3ByF1dJ',
			spotifyUrl: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
		});
		expect(showArtifacts[0]?.meta.provider).toBe('spotify-url');
		expect(episodeArtifacts[0]?.data).toMatchObject({
			name: 'Fallback Episode',
			type: 'episode',
			spotifyId: '512ojhOuo1ktJprKbVcKyQ',
			spotifyUrl: 'https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ',
		});
		expect(episodeArtifacts[0]?.meta.provider).toBe('spotify-url');
	});

	it('maps Spotify Web API podcast payloads into structured artifacts', async () => {
		const requestedUrls: string[] = [];
		const plugin = createSpotifyPlugin({
			clientId: 'spotify-client-id',
			clientSecret: 'spotify-client-secret',
			market: 'US',
			fetch: async (input) => {
				const url = input.toString();
				requestedUrls.push(url);

				if (url === 'https://accounts.spotify.com/api/token') {
					return jsonResponse({
						access_token: 'spotify-test-token',
					});
				}

				if (url.includes('/shows/38bS44xjbVVZ3No3ByF1dJ')) {
					return jsonResponse({
						id: '38bS44xjbVVZ3No3ByF1dJ',
						name: 'Spotify Engineering Culture',
						description: 'A show about building audio products.',
						publisher: 'Spotify',
						total_episodes: 42,
						languages: ['en'],
						external_urls: {
							spotify: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
						},
						images: [{ url: 'https://i.scdn.co/image/show' }],
					});
				}

				expect(url).toContain('/episodes/512ojhOuo1ktJprKbVcKyQ');
				return jsonResponse({
					id: '512ojhOuo1ktJprKbVcKyQ',
					name: 'Classifying Podcasts',
					description: 'A focused episode.',
					audio_preview_url: 'https://p.scdn.co/episode-preview.mp3',
					duration_ms: 1_800_000,
					release_date: '2026-05-01',
					external_urls: {
						spotify: 'https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ',
					},
					images: [{ url: 'https://i.scdn.co/image/episode' }],
					show: {
						id: '38bS44xjbVVZ3No3ByF1dJ',
						name: 'Spotify Engineering Culture',
						external_urls: {
							spotify: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
						},
					},
				});
			},
		});
		const ctx = createMockPluginContext();

		const showArtifacts = await plugin.enrich(
			createMockRequest({
				input: createMockAtomInput({
					hints: {
						url: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
					},
				}),
			}),
			ctx
		);
		const episodeArtifacts = await plugin.enrich(
			createMockRequest({
				input: createMockAtomInput({
					hints: {
						url: 'https://open.spotify.com/episode/512ojhOuo1ktJprKbVcKyQ',
					},
				}),
			}),
			ctx
		);

		expect(requestedUrls).toContain(
			'https://api.spotify.com/v1/shows/38bS44xjbVVZ3No3ByF1dJ?market=US'
		);
		expect(requestedUrls).toContain(
			'https://api.spotify.com/v1/episodes/512ojhOuo1ktJprKbVcKyQ?market=US'
		);
		expect(showArtifacts[0]?.data).toMatchObject({
			name: 'Spotify Engineering Culture',
			type: 'show',
			publisher: 'Spotify',
			totalEpisodes: 42,
			languages: ['en'],
			imageUrl: 'https://i.scdn.co/image/show',
		});
		expect(episodeArtifacts[0]?.data).toMatchObject({
			name: 'Classifying Podcasts',
			type: 'episode',
			previewUrl: 'https://p.scdn.co/episode-preview.mp3',
			durationMs: 1_800_000,
			releaseDate: '2026-05-01',
			showName: 'Spotify Engineering Culture',
			showSpotifyId: '38bS44xjbVVZ3No3ByF1dJ',
		});
	});
});

function jsonResponse(payload: unknown): Response {
	return new Response(JSON.stringify(payload), {
		status: 200,
		headers: {
			'content-type': 'application/json',
		},
	});
}
