import { describe, expect, it } from 'bun:test';
import { parseSocialAccountUrl, resolveExplorerChainId } from '../src/extraction/direct-providers';
import { extractClassificationFields } from '../src/extraction/extract';
import type { EnrichmentArtifact } from '../src/types';

function artifact(
	artifactType: string,
	data: Record<string, unknown>,
	sourceUrl?: string
): EnrichmentArtifact {
	return {
		artifact_type: artifactType,
		data,
		meta: {
			pluginId: artifactType,
			provider: artifactType,
			fetchedAt: '2026-06-11T00:00:00.000Z',
			...(sourceUrl ? { sourceUrl } : {}),
		},
	};
}

const noFetch = () => Promise.reject(new Error('network disabled in test'));

const SPOTIFY_TRACK = artifact(
	'spotify',
	{
		name: 'Mr. Brightside',
		type: 'track',
		spotifyId: '3n3Ppam7vgaVa1iaRUc9Lp',
		spotifyUrl: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp',
		artists: [{ name: 'The Killers', spotifyId: '0C0XlULifJtAgn6ZNCW2eu' }],
		albumName: 'Hot Fuss',
	},
	'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp'
);

const APPLE_SONG = artifact(
	'apple-music',
	{
		name: 'Better Together',
		type: 'song',
		appleMusicId: '1440857786',
		appleMusicUrl: 'https://music.apple.com/us/album/better-together/1440857781?i=1440857786',
		artistName: 'Jack Johnson',
		albumName: 'In Between Dreams',
		previewUrl: 'https://audio-ssl.itunes.apple.com/preview.m4a',
	},
	'https://music.apple.com/us/album/better-together/1440857781?i=1440857786'
);

describe('music mappers', () => {
	it('fills music-recording from a spotify artifact', async () => {
		const result = await extractClassificationFields({
			classification: 'music-recording',
			url: 'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp',
			artifacts: [SPOTIFY_TRACK],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('Mr. Brightside');
		expect(result.values.byArtist).toBe('The Killers');
		expect(result.values.inAlbum).toBe('Hot Fuss');
		expect(result.missingRequired).toEqual([]);
		expect(result.fields.name?.source).toBe('spotify');
	});

	it('fills music-recording from an apple-music artifact', async () => {
		const result = await extractClassificationFields({
			classification: 'music-recording',
			url: 'https://music.apple.com/us/album/better-together/1440857781?i=1440857786',
			artifacts: [APPLE_SONG],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('Better Together');
		expect(result.values.byArtist).toBe('Jack Johnson');
		expect(result.fields.name?.source).toBe('apple-music');
	});

	it('skips generated spotify placeholder names', async () => {
		const result = await extractClassificationFields({
			classification: 'music-recording',
			url: 'https://open.spotify.com/track/abc',
			artifacts: [
				artifact('spotify', {
					name: 'Spotify Track abc123',
					type: 'track',
					spotifyId: 'abc123',
					spotifyUrl: 'https://open.spotify.com/track/abc123',
				}),
				APPLE_SONG,
			],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('Better Together');
	});
});

describe('software mappers', () => {
	it('fills software from a github repo artifact', async () => {
		const result = await extractClassificationFields({
			classification: 'software',
			url: 'https://github.com/ethereum/go-ethereum',
			artifacts: [
				artifact(
					'github-repo',
					{ owner: 'ethereum', name: 'go-ethereum', fullName: 'ethereum/go-ethereum' },
					'https://github.com/ethereum/go-ethereum'
				),
			],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('go-ethereum');
		expect(result.values.codeRepository).toBe('https://github.com/ethereum/go-ethereum');
		expect(result.missingRequired).toEqual([]);
	});

	it('fills software-application from an npm artifact', async () => {
		const result = await extractClassificationFields({
			classification: 'software-application',
			url: 'https://www.npmjs.com/package/react',
			artifacts: [
				artifact('npm-package', {
					name: 'react',
					version: '19.0.0',
					homepage: 'https://react.dev/',
				}),
			],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('react');
		expect(result.values.url).toBe('https://react.dev/');
	});
});

describe('video-object mapper', () => {
	it('fills from a youtube artifact with the watch url as contentUrl', async () => {
		const result = await extractClassificationFields({
			classification: 'video-object',
			url: 'https://www.youtube.com/watch?v=bewVnEugEqE',
			artifacts: [
				artifact('youtube', {
					videoId: 'bewVnEugEqE',
					title: 'Inception Trailer',
					description: 'Official trailer.',
				}),
			],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('Inception Trailer');
		expect(result.values.description).toBe('Official trailer.');
		expect(result.values.contentUrl).toBe('https://www.youtube.com/watch?v=bewVnEugEqE');
	});
});

describe('social-media-account mapper', () => {
	it('parses handles and platforms from urls without any artifacts', () => {
		expect(parseSocialAccountUrl('https://x.com/VitalikButerin')).toEqual({
			username: 'VitalikButerin',
			platform: 'X',
		});
		expect(parseSocialAccountUrl('https://github.com/gakonst')).toEqual({
			username: 'gakonst',
			platform: 'GitHub',
		});
		expect(parseSocialAccountUrl('https://www.tiktok.com/@khaby.lame')).toEqual({
			username: 'khaby.lame',
			platform: 'TikTok',
		});
		expect(parseSocialAccountUrl('https://www.linkedin.com/in/satyanadella')).toEqual({
			username: 'satyanadella',
			platform: 'LinkedIn',
		});
	});

	it('rejects reserved platform paths and content urls', () => {
		expect(parseSocialAccountUrl('https://x.com/search?q=test')).toBeUndefined();
		expect(parseSocialAccountUrl('https://x.com/i/web/status/123')).toBeUndefined();
		expect(parseSocialAccountUrl('https://github.com/ethereum/go-ethereum')).toBeUndefined();
		expect(parseSocialAccountUrl('https://www.instagram.com/p/abc123/')).toBeUndefined();
	});

	it('fills the classification credential-free from the url alone', async () => {
		const result = await extractClassificationFields({
			classification: 'social-media-account',
			url: 'https://x.com/VitalikButerin',
			artifacts: [],
			fetcher: noFetch,
		});
		expect(result.values.username).toBe('VitalikButerin');
		expect(result.values.platform).toBe('X');
		expect(result.missingRequired).toEqual([]);
	});

	it('prefers the x-profile artifact when present', async () => {
		const result = await extractClassificationFields({
			classification: 'social-media-account',
			url: 'https://x.com/VitalikButerin',
			artifacts: [artifact('x-profile', { username: 'VitalikButerin', name: 'vitalik.eth' })],
			fetcher: noFetch,
		});
		expect(result.fields.username?.source).toBe('x-profile');
	});
});

describe('ethereum mappers', () => {
	const ADDRESS = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045';

	it('maps explorer hosts to chain ids', () => {
		expect(resolveExplorerChainId(`https://etherscan.io/address/${ADDRESS}`)).toBe(1);
		expect(resolveExplorerChainId(`https://basescan.org/address/${ADDRESS}`)).toBe(8453);
		expect(resolveExplorerChainId(`https://sepolia.etherscan.io/address/${ADDRESS}`)).toBe(
			11_155_111
		);
		expect(resolveExplorerChainId('https://example.com/')).toBeUndefined();
	});

	it('fills ethereum-account from the url alone', async () => {
		const result = await extractClassificationFields({
			classification: 'ethereum-account',
			url: `https://etherscan.io/address/${ADDRESS}`,
			artifacts: [],
			fetcher: noFetch,
		});
		expect(result.values.address).toBe(ADDRESS);
		expect(result.missingRequired).toEqual([]);
	});

	it('fills ethereum-erc20 from explorer url + coingecko artifact', async () => {
		const usdc = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48';
		const result = await extractClassificationFields({
			classification: 'ethereum-erc20',
			url: `https://etherscan.io/token/${usdc}`,
			artifacts: [
				artifact('token-metadata', {
					address: usdc,
					name: 'USD Coin',
					symbol: 'USDC',
					decimals: 6,
				}),
			],
			fetcher: noFetch,
		});
		expect(result.values.chainId).toBe(1);
		expect(result.values.address).toBe(usdc);
		expect(result.values.name).toBe('USD Coin');
		expect(result.values.symbol).toBe('USDC');
		expect(result.values.decimals).toBe(6);
		expect(result.missingRequired).toEqual([]);
	});
});

describe('places-backed mappers', () => {
	const PLACES_ARTIFACT = artifact(
		'places',
		{
			name: 'Blue Bottle Coffee',
			formattedAddress: '66 Mint St, San Francisco, CA 94103, USA',
			phoneNumber: '+1 510-653-3394',
			website: 'https://bluebottlecoffee.com/',
			rating: 4.5,
		},
		'https://www.google.com/maps/place/Blue+Bottle+Coffee/@37.7822,-122.4076,17z'
	);

	it('fills local-business completely from a places artifact', async () => {
		const result = await extractClassificationFields({
			classification: 'local-business',
			url: 'https://www.google.com/maps/place/Blue+Bottle+Coffee/@37.7822,-122.4076,17z',
			artifacts: [PLACES_ARTIFACT],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('Blue Bottle Coffee');
		expect(result.values.address).toBe('66 Mint St, San Francisco, CA 94103, USA');
		expect(result.values.telephone).toBe('+1 510-653-3394');
		expect(result.values.url).toBe('https://bluebottlecoffee.com/');
		expect(result.missingRequired).toEqual([]);
		expect(result.fields.name?.source).toBe('google-places');
	});

	it('prefers the places address over the wikidata composition for location', async () => {
		const result = await extractClassificationFields({
			classification: 'location',
			url: 'https://www.google.com/maps/place/Blue+Bottle+Coffee/@37.7822,-122.4076,17z',
			artifacts: [PLACES_ARTIFACT],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('Blue Bottle Coffee');
		expect(result.values.address).toBe('66 Mint St, San Francisco, CA 94103, USA');
	});
});

describe('company via google maps', () => {
	it('fills company name and website from a places artifact', async () => {
		const result = await extractClassificationFields({
			classification: 'company',
			url: 'https://maps.app.goo.gl/example123',
			artifacts: [
				artifact(
					'places',
					{
						name: 'Blue Bottle Coffee',
						formattedAddress: '66 Mint St, San Francisco, CA 94103, USA',
						website: 'https://bluebottlecoffee.com/',
						phoneNumber: '+1 510-653-3394',
					},
					'https://maps.app.goo.gl/example123'
				),
			],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('Blue Bottle Coffee');
		expect(result.values.url).toBe('https://bluebottlecoffee.com/');
		// address/telephone are not company fields — dropped, never errored
		expect(result.values.address).toBeUndefined();
		expect(result.missingRequired).toEqual([]);
		expect(result.fields.name?.source).toBe('google-places');
	});

	it('keeps wikidata as the company source for wikipedia urls', async () => {
		const result = await extractClassificationFields({
			classification: 'company',
			url: 'https://en.wikipedia.org/wiki/OpenAI',
			artifacts: [
				artifact(
					'wikidata',
					{
						entityId: 'Q21708200',
						label: 'OpenAI',
						claims: {
							P856: [{ mainsnak: { datavalue: { value: 'https://openai.com/' } }, rank: 'normal' }],
						},
					},
					'https://en.wikipedia.org/wiki/OpenAI'
				),
			],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('OpenAI');
		expect(result.values.url).toBe('https://openai.com/');
		expect(result.fields.url?.source).toBe('wikidata');
	});
});

describe('podcast mappers', () => {
	const SHOW_ARTIFACT = artifact(
		'spotify',
		{
			name: 'Bankless',
			type: 'show',
			spotifyId: '4rOoJ6Egrf8K2IrywzwOMk',
			spotifyUrl: 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
			publisher: 'Bankless',
		},
		'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk'
	);

	it('fills podcast-series from a spotify show artifact', async () => {
		const result = await extractClassificationFields({
			classification: 'podcast-series',
			url: 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk?si=16aac2face304f5f',
			artifacts: [SHOW_ARTIFACT],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('Bankless');
		expect(result.values.url).toBe('https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk');
		expect(result.missingRequired).toEqual([]);
		expect(result.fields.name?.source).toBe('spotify');
	});

	it('fills podcast-episode with series name and publish date', async () => {
		const result = await extractClassificationFields({
			classification: 'podcast-episode',
			url: 'https://open.spotify.com/episode/abc123episode',
			artifacts: [
				artifact('spotify', {
					name: 'The Rollup Roadmap',
					type: 'episode',
					spotifyId: 'abc123episode',
					spotifyUrl: 'https://open.spotify.com/episode/abc123episode',
					showName: 'Bankless',
					releaseDate: '2026-06-01',
					durationMs: 3600000,
					previewUrl: 'https://p.scdn.co/mp3-preview/episode',
				}),
			],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('The Rollup Roadmap');
		expect(result.values.partOfSeries).toBe('Bankless');
		expect(result.values.datePublished).toBe('2026-06-01');
		expect(result.missingRequired).toEqual([]);
	});

	it('does not fill an episode from a show artifact', async () => {
		const result = await extractClassificationFields({
			classification: 'podcast-episode',
			url: 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
			artifacts: [SHOW_ARTIFACT],
			fetcher: noFetch,
		});
		expect(result.values.name).toBeUndefined();
		expect(result.missingRequired).toEqual(['name']);
	});

	it('skips generated placeholder names from the keyless fallback', async () => {
		const result = await extractClassificationFields({
			classification: 'podcast-series',
			url: 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
			artifacts: [
				artifact('spotify', {
					name: 'Show 4rOoJ6Egrf8K2IrywzwOMk',
					type: 'show',
					spotifyId: '4rOoJ6Egrf8K2IrywzwOMk',
					spotifyUrl: 'https://open.spotify.com/show/4rOoJ6Egrf8K2IrywzwOMk',
				}),
			],
			fetcher: noFetch,
		});
		expect(result.values.name).toBeUndefined();
		expect(result.missingRequired).toEqual(['name']);
	});
});

describe('software url fallback (github api unavailable)', () => {
	it('derives name and codeRepository from a bare github repo url', async () => {
		const result = await extractClassificationFields({
			classification: 'software',
			url: 'https://github.com/0xIntuition/intuition-ts',
			artifacts: [
				artifact('opengraph', {
					title: 'GitHub - 0xIntuition/intuition-ts: Intuition Typescript monorepo.',
					url: 'https://github.com/0xIntuition/intuition-ts',
				}),
			],
			fetcher: noFetch,
		});
		// The OG page title must never win over the URL-derived repo identity.
		expect(result.values.name).toBe('intuition-ts');
		expect(result.values.codeRepository).toBe('https://github.com/0xIntuition/intuition-ts');
		expect(result.missingRequired).toEqual([]);
	});

	it('prefers the github artifact when present', async () => {
		const result = await extractClassificationFields({
			classification: 'software',
			url: 'https://github.com/0xIntuition/intuition-ts',
			artifacts: [
				artifact('github-repo', {
					owner: '0xIntuition',
					name: 'intuition-ts',
					fullName: '0xIntuition/intuition-ts',
				}),
			],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('intuition-ts');
		expect(result.fields.name?.source).toBe('github');
	});

	it('ignores non-repo github paths', async () => {
		const result = await extractClassificationFields({
			classification: 'software',
			url: 'https://github.com/0xIntuition/intuition-ts/issues/42',
			artifacts: [],
			fetcher: noFetch,
		});
		expect(result.values.codeRepository).toBeUndefined();
	});
});
