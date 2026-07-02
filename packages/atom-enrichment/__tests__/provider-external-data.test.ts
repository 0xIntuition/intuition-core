import { describe, expect, it } from 'bun:test';

import {
	brandFetchResponseSchema,
	canopyAmazonProductResponseSchema,
	coinGeckoResponseSchema,
	crossrefResponseSchema,
	etherscanBalanceResponseSchema,
	etherscanContractResponseSchema,
	etherscanTxCountResponseSchema,
	gitHubRepoResponseSchema,
	gitHubUserResponseSchema,
	musicBrainzRecordingResponseSchema,
	musicBrainzSearchResponseSchema,
	npmDownloadsResponseSchema,
	npmRegistryResponseSchema,
	oembedResponseSchema,
	spotifyAlbumResponseSchema,
	spotifyArtistResponseSchema,
	spotifyEpisodeResponseSchema,
	spotifyPlaylistResponseSchema,
	spotifyShowResponseSchema,
	spotifyTokenResponseSchema,
	spotifyTrackResponseSchema,
	tmdbDetailsResponseSchema,
	wikidataEntityLookupResponseSchema,
	wikidataSearchResponseSchema,
	wikipediaSummaryResponseSchema,
	xUserLookupResponseSchema,
	youTubeVideoResponseSchema,
} from '../src/provider-external-data';

function fixturePath(relativePath: string): string {
	return new URL(relativePath, import.meta.url).pathname;
}

async function readJsonFixture(relativePath: string): Promise<unknown> {
	return await Bun.file(fixturePath(relativePath)).json();
}

describe('provider external data schemas', () => {
	it('parses x profile lookup payloads', () => {
		const parsed = xUserLookupResponseSchema.parse({
			data: {
				username: 'elonmusk',
				name: 'Elon Musk',
				description: 'technoking',
				profile_banner_url: 'https://pbs.twimg.com/profile_banners/example.jpg',
				profile_image_url: 'https://pbs.twimg.com/profile_images/example.jpg',
				public_metrics: {
					followers_count: 100,
					following_count: 50,
					tweet_count: 25,
				},
				verified: true,
				created_at: '2009-06-02T20:12:29.000Z',
			},
		});

		expect(parsed.data?.username).toBe('elonmusk');
		expect(parsed.data?.profile_banner_url).toBe(
			'https://pbs.twimg.com/profile_banners/example.jpg'
		);
		expect(parsed.data?.public_metrics?.followers_count).toBe(100);
	});

	it('parses github repo and user payloads', () => {
		const repo = gitHubRepoResponseSchema.parse({
			name: 'next.js',
			full_name: 'vercel/next.js',
			owner: { login: 'vercel' },
			stargazers_count: 1000,
			forks_count: 100,
			open_issues_count: 10,
		});
		const user = gitHubUserResponseSchema.parse({
			login: 'vercel',
			name: 'Vercel',
			public_repos: 10,
			followers: 100,
			following: 5,
		});

		expect(repo.full_name).toBe('vercel/next.js');
		expect(user.login).toBe('vercel');
	});

	it('parses fixture-backed external payloads for remaining http providers', async () => {
		const [
			brandFixture,
			coinGeckoFixture,
			crossrefFixture,
			etherscanBalanceFixture,
			etherscanContractFixture,
			etherscanTxCountFixture,
			musicBrainzFixture,
			npmRegistryFixture,
			npmDownloadsFixture,
			oembedFixture,
			tmdbFixture,
			wikidataFixture,
			wikipediaFixture,
			youTubeFixture,
		] = await Promise.all([
			readJsonFixture('../src/plugins/providers/brand/__fixtures__/brand.json'),
			readJsonFixture('../src/plugins/providers/coingecko/__fixtures__/coin.json'),
			readJsonFixture('../src/plugins/providers/crossref/__fixtures__/work.json'),
			readJsonFixture('../src/plugins/providers/etherscan/__fixtures__/balance.json'),
			readJsonFixture('../src/plugins/providers/etherscan/__fixtures__/contract.json'),
			readJsonFixture('../src/plugins/providers/etherscan/__fixtures__/txcount.json'),
			readJsonFixture('../src/plugins/providers/musicbrainz/__fixtures__/recording.json'),
			readJsonFixture('../src/plugins/providers/npm/__fixtures__/registry.json'),
			readJsonFixture('../src/plugins/providers/npm/__fixtures__/downloads.json'),
			readJsonFixture('../src/plugins/providers/oembed/__fixtures__/response.json'),
			readJsonFixture('../src/plugins/providers/tmdb/__fixtures__/movie.json'),
			readJsonFixture('../src/plugins/providers/wikidata/__fixtures__/entity.json'),
			readJsonFixture('../src/plugins/providers/wikipedia/__fixtures__/summary.json'),
			readJsonFixture('../src/plugins/providers/youtube/__fixtures__/video.json'),
		]);

		const brand = brandFetchResponseSchema.parse(brandFixture);
		const coinGecko = coinGeckoResponseSchema.parse(coinGeckoFixture);
		const crossref = crossrefResponseSchema.parse(crossrefFixture);
		const etherscanBalance = etherscanBalanceResponseSchema.parse(etherscanBalanceFixture);
		const etherscanContract = etherscanContractResponseSchema.parse(etherscanContractFixture);
		const etherscanTxCount = etherscanTxCountResponseSchema.parse(etherscanTxCountFixture);
		const musicBrainzRecording = musicBrainzRecordingResponseSchema.parse(musicBrainzFixture);
		const npmRegistry = npmRegistryResponseSchema.parse(npmRegistryFixture);
		const npmDownloads = npmDownloadsResponseSchema.parse(npmDownloadsFixture);
		const oembed = oembedResponseSchema.parse(oembedFixture);
		const tmdb = tmdbDetailsResponseSchema.parse(tmdbFixture);
		const wikidata = wikidataEntityLookupResponseSchema.parse(wikidataFixture);
		const wikipedia = wikipediaSummaryResponseSchema.parse(wikipediaFixture);
		const youTube = youTubeVideoResponseSchema.parse(youTubeFixture);

		expect(brand.domain).toBeTruthy();
		expect(coinGecko.id).toBeTruthy();
		expect(crossref.message?.DOI).toBeTruthy();
		expect(etherscanBalance.result).toBeTruthy();
		expect(etherscanContract.result?.length).toBeGreaterThan(0);
		expect(etherscanTxCount.result).toBeTruthy();
		expect(musicBrainzRecording.id).toBeTruthy();
		expect(npmRegistry.name).toBeTruthy();
		expect(npmDownloads.downloads).toBeDefined();
		expect(oembed.type).toBeTruthy();
		expect(tmdb.id).toBeTruthy();
		expect(Object.keys(wikidata.entities ?? {})).not.toHaveLength(0);
		expect(wikipedia.title).toBeTruthy();
		expect(youTube.items?.length).toBeGreaterThan(0);
	});

	it('parses search-style payloads where the provider has a distinct lookup step', () => {
		const musicBrainzSearch = musicBrainzSearchResponseSchema.parse({
			recordings: [
				{
					id: 'f77eec4b-5941-49dc-85d5-2e344e63304a',
					title: 'ELON MUSK',
				},
			],
		});
		const wikidataSearch = wikidataSearchResponseSchema.parse({
			search: [{ id: 'Q317521' }],
		});

		expect(musicBrainzSearch.recordings?.[0]?.id).toBe('f77eec4b-5941-49dc-85d5-2e344e63304a');
		expect(wikidataSearch.search?.[0]?.id).toBe('Q317521');
	});

	it('accepts polymorphic wikidata claim values from live entity payloads', () => {
		const parsed = wikidataEntityLookupResponseSchema.parse({
			entities: {
				Q317521: {
					claims: {
						P31: [
							{
								mainsnak: {
									datavalue: {
										value: {
											id: 'Q5',
										},
									},
								},
							},
						],
						P2002: [
							{
								mainsnak: {
									datavalue: {
										value: 'elonmusk',
									},
								},
							},
						],
						P8687: [
							{
								mainsnak: {
									datavalue: {
										value: {
											amount: '+149482571',
										},
									},
								},
							},
						],
					},
				},
			},
		});

		expect(parsed.entities?.Q317521?.claims?.P31?.[0]?.mainsnak?.datavalue?.value).toEqual({
			id: 'Q5',
		});
		expect(parsed.entities?.Q317521?.claims?.P2002?.[0]?.mainsnak?.datavalue?.value).toBe(
			'elonmusk'
		);
	});

	it('parses canopy amazon product payloads', () => {
		const parsed = canopyAmazonProductResponseSchema.parse({
			data: {
				amazonProduct: {
					title: 'Example Product',
					brand: 'Acme',
					currentPrice: '19.99',
					currencyCode: 'USD',
					mainImageUrl: 'https://images.example.com/product.jpg',
					asin: 'B012345678',
				},
			},
		});

		expect(parsed.data?.amazonProduct?.title).toBe('Example Product');
		expect(parsed.data?.amazonProduct?.asin).toBe('B012345678');
	});

	it('parses spotify token and resource payloads', () => {
		const token = spotifyTokenResponseSchema.parse({
			access_token: 'token',
			token_type: 'Bearer',
			expires_in: 3600,
		});
		const track = spotifyTrackResponseSchema.parse({
			id: 'track123',
			name: 'Track',
			preview_url: 'https://p.scdn.co/preview.mp3',
			artists: [{ id: 'artist123', name: 'Artist' }],
			album: {
				name: 'Album',
				release_date: '2020-01-01',
				images: [{ url: 'https://i.scdn.co/image/example' }],
			},
		});
		const album = spotifyAlbumResponseSchema.parse({
			id: 'album123',
			name: 'Album',
			artists: [{ id: 'artist123', name: 'Artist' }],
			images: [{ url: 'https://i.scdn.co/image/example' }],
		});
		const artist = spotifyArtistResponseSchema.parse({
			id: 'artist123',
			name: 'Artist',
			genres: ['indie'],
		});
		const playlist = spotifyPlaylistResponseSchema.parse({
			id: 'playlist123',
			name: 'Playlist',
			images: [{ url: 'https://i.scdn.co/image/example' }],
		});
		const show = spotifyShowResponseSchema.parse({
			id: 'show123',
			name: 'Show',
			description: 'A podcast show.',
			publisher: 'Publisher',
			total_episodes: 42,
			images: [{ url: 'https://i.scdn.co/image/example' }],
		});
		const episode = spotifyEpisodeResponseSchema.parse({
			id: 'episode123',
			name: 'Episode',
			audio_preview_url: 'https://p.scdn.co/preview.mp3',
			duration_ms: 1_800_000,
			release_date: '2026-05-01',
			show: {
				id: 'show123',
				name: 'Show',
			},
		});

		expect(token.access_token).toBe('token');
		expect(track.album?.name).toBe('Album');
		expect(album.id).toBe('album123');
		expect(artist.genres?.[0]).toBe('indie');
		expect(playlist.name).toBe('Playlist');
		expect(show.total_episodes).toBe(42);
		expect(episode.show?.name).toBe('Show');
	});
});
