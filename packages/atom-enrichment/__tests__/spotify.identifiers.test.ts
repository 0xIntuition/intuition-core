import { expect, it } from 'bun:test';
import { createSpotifyPlugin } from '../src/plugins/providers/spotify';
import { spotifyDataSchema } from '../src/plugins/providers/spotify/schema';
import { createMockAtomInput, createMockPluginContext, createMockRequest } from '../src/testing';

for (const type of ['album', 'track'] as const) {
	for (const [name, invalid] of [
		['empty', ''],
		['whitespace', ' \t\n '],
		['number', 123],
		['null', null],
		['object', {}],
	] as const) {
		it(`Spotify ${type} omits ${name} external IDs without losing metadata`, async () => {
			const plugin = createSpotifyPlugin({
				clientId: 'fixture',
				clientSecret: 'fixture',
				fetch: async (url) =>
					Response.json(
						url.includes('/api/token')
							? { access_token: 'fixture' }
							: {
									id: '12345678',
									name: 'Album',
									external_ids: { upc: invalid, ean: invalid, isrc: invalid },
								}
					),
			});
			const artifacts = await plugin.enrich(
				createMockRequest({
					input: createMockAtomInput({
						hints: { url: `https://open.spotify.com/${type}/12345678` },
					}),
				}),
				createMockPluginContext()
			);
			expect(artifacts).toHaveLength(1);
			expect(artifacts[0]?.data.name).toBe('Album');
			for (const key of ['upc', 'ean', 'isrc']) expect(artifacts[0]?.data[key]).toBeUndefined();
		});
	}
	it(`Spotify ${type} surfaces UPC/EAN beside ISRC`, async () => {
		const ctx = createMockPluginContext();
		const plugin = createSpotifyPlugin({
			clientId: 'fixture',
			clientSecret: 'fixture',
			fetch: async (url, init) => {
				expect(init?.signal).toBe(ctx.signal);
				return Response.json(
					url.includes('/api/token')
						? { access_token: 'fixture' }
						: {
								id: '12345678',
								name: 'Album',
								external_ids: { upc: '012345678901', ean: '0012345678901', isrc: 'USUM71703861' },
							}
				);
			},
		});
		const result = await plugin.enrich(
			createMockRequest({
				input: createMockAtomInput({ hints: { url: `https://open.spotify.com/${type}/12345678` } }),
			}),
			ctx
		);
		expect(result[0]?.data).toMatchObject({
			upc: '012345678901',
			ean: '0012345678901',
			isrc: 'USUM71703861',
		});
	});
}

it('Spotify artifact schema treats malformed optional identifiers as absent', () => {
	for (const invalid of ['', ' \t\n ', 123, null, {}]) {
		const data = spotifyDataSchema.parse({
			name: 'Album',
			type: 'album',
			spotifyId: '12345678',
			spotifyUrl: 'https://open.spotify.com/album/12345678',
			upc: invalid,
			ean: invalid,
			isrc: invalid,
		});
		expect(data.upc).toBeUndefined();
		expect(data.ean).toBeUndefined();
		expect(data.isrc).toBeUndefined();
	}
});
