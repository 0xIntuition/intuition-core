import { describe, expect, it } from 'bun:test';

import {
	type ClassificationRegistry,
	createDefaultClassificationRegistry,
} from '../../src/classifications';
import {
	createBrandPlugin,
	createCoinGeckoPlugin,
	createCrossrefPlugin,
	createEtherscanPlugin,
	createFaviconPlugin,
	createGitHubPlugin,
	createMusicBrainzPlugin,
	createNpmPlugin,
	createOEmbedPlugin,
	createOpenGraphPlugin,
	createProductListingPlugin,
	createSpotifyPlugin,
	createTmdbPlugin,
	createWikidataPlugin,
	createWikipediaPlugin,
	createXProfilePlugin,
	createYouTubePlugin,
	type FetchLike,
} from '../../src/plugins/providers';
import {
	createMockAtomInput,
	createMockRequest,
	runPluginConformanceSuite,
} from '../../src/testing';

const registry = createDefaultClassificationRegistry();

function fixturePath(relativePath: string): string {
	return new URL(relativePath, import.meta.url).pathname;
}

async function readFixture(relativePath: string): Promise<string> {
	return await Bun.file(fixturePath(relativePath)).text();
}

function createFetchMock(
	responses: Array<{ body: string; status?: number; headers?: Record<string, string> }>
): FetchLike {
	let index = 0;
	return async () => {
		const response = responses[Math.min(index, responses.length - 1)] ?? {
			body: '{}',
			status: 500,
		};
		index += 1;
		return new Response(response.body, {
			status: response.status ?? 200,
			headers: response.headers,
		});
	};
}

function createNoNameNoUrlInput() {
	return createMockAtomInput({
		jsonLd: { '@context': 'https://schema.org', '@type': 'Thing' },
		hints: {},
	});
}

describe('v1 provider plugins conformance', () => {
	describe('opengraph', () => {
		it('normalizes metadata from html fixture', async () => {
			const html = await readFixture(
				'../../src/plugins/providers/opengraph/__fixtures__/page.html'
			);
			const plugin = createOpenGraphPlugin({
				fetch: createFetchMock([{ body: html, headers: { 'content-type': 'text/html' } }]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {
						name: 'Acme Labs',
						url: 'https://acme.example',
					},
				}),
			});
			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('opengraph');
			expect(artifacts[0]?.data).toMatchObject({
				title: 'Acme Labs',
				description: 'Developer tooling company',
				url: 'https://acme.example',
				audioUrl: 'https://acme.example/preview.mp3',
				audioType: 'audio/mpeg',
			});
		});

		runPluginConformanceSuite(
			createOpenGraphPlugin({
				fetch: createFetchMock([
					{
						body: '<html><head><meta property="og:title" content="Acme"/></head></html>',
						headers: { 'content-type': 'text/html' },
					},
				]),
			}),
			[
				{
					name: 'supports with url',
					request: createMockRequest({
						input: createMockAtomInput({ hints: { name: 'Acme', url: 'https://acme.example' } }),
					}),
					expectedSupports: true,
					expectedClassifications: ['opengraph'],
				},
				{
					name: 'does not support without url',
					request: createMockRequest({
						input: createMockAtomInput({ hints: { name: 'Acme', url: undefined } }),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('oembed', () => {
		it('normalizes oembed fixture', async () => {
			const response = await readFixture(
				'../../src/plugins/providers/oembed/__fixtures__/response.json'
			);
			const plugin = createOEmbedPlugin({
				fetch: createFetchMock([
					{ body: response, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: { url: 'https://www.youtube.com/watch?v=abc123', name: 'Demo' },
				}),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('oembed');
			expect(artifacts[0]?.data).toMatchObject({
				type: 'video',
				title: 'Acme Demo',
				providerName: 'YouTube',
			});
		});

		runPluginConformanceSuite(
			createOEmbedPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							type: 'video',
							title: 'Demo',
							provider_name: 'YouTube',
							provider_url: 'https://www.youtube.com/',
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports known provider url',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { url: 'https://www.youtube.com/watch?v=abc123', name: 'Demo' },
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['oembed'],
				},
				{
					name: 'does not support unknown provider',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { url: 'https://acme.example/blog', name: 'Blog' },
						}),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('spotify', () => {
		it('normalizes track metadata and preview url from spotify api payload', async () => {
			const plugin = createSpotifyPlugin({
				clientId: 'client-id',
				clientSecret: 'client-secret',
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							access_token: 'spotify-token',
							token_type: 'Bearer',
							expires_in: 3600,
						}),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({
							id: '1kcfGBb6kSrGqNIMW7rAlB',
							name: 'Oh Devil',
							preview_url: 'https://p.scdn.co/mp3-preview/1a2b3c4d5e6f7g8h9i0j?cid=spotify-client',
							duration_ms: 209000,
							popularity: 64,
							external_urls: {
								spotify: 'https://open.spotify.com/track/1kcfGBb6kSrGqNIMW7rAlB',
							},
							external_ids: {
								isrc: 'USAAA1700001',
							},
							artists: [
								{
									id: '0u2FHSq3ln94y5QxwL7I9R',
									name: 'Electric Guest',
								},
							],
							album: {
								name: 'Plural',
								release_date: '2017-02-01',
								images: [{ url: 'https://i.scdn.co/image/ab67616d0000b273example' }],
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: { url: 'https://open.spotify.com/track/1kcfGBb6kSrGqNIMW7rAlB' },
				}),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('spotify');
			expect(artifacts[0]?.data).toMatchObject({
				name: 'Oh Devil',
				type: 'track',
				spotifyId: '1kcfGBb6kSrGqNIMW7rAlB',
				previewUrl: 'https://p.scdn.co/mp3-preview/1a2b3c4d5e6f7g8h9i0j?cid=spotify-client',
				spotifyApiPayload: {
					id: '1kcfGBb6kSrGqNIMW7rAlB',
					name: 'Oh Devil',
					album: {
						name: 'Plural',
						release_date: '2017-02-01',
					},
				},
			});
		});

		runPluginConformanceSuite(
			createSpotifyPlugin({
				clientId: 'client-id',
				clientSecret: 'client-secret',
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							access_token: 'spotify-token',
							token_type: 'Bearer',
							expires_in: 3600,
						}),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({
							id: '1kcfGBb6kSrGqNIMW7rAlB',
							name: 'Oh Devil',
							external_urls: {
								spotify: 'https://open.spotify.com/track/1kcfGBb6kSrGqNIMW7rAlB',
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports spotify track url',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { url: 'https://open.spotify.com/track/1kcfGBb6kSrGqNIMW7rAlB' },
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['spotify'],
				},
				{
					name: 'does not support non-spotify url',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { url: 'https://example.com' },
						}),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('product-listing', () => {
		it('normalizes Canopy Amazon product payload from explicit product target', async () => {
			const plugin = createProductListingPlugin({
				apiKey: 'test-key',
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							data: {
								amazonProduct: {
									title: 'Carepod One Stainless Steel Humidifier for Large Room',
									brand: 'Carepod',
									asin: 'B0916J478T',
									url: 'https://www.amazon.com/dp/B0916J478T',
									mainImageUrl: 'https://m.media-amazon.com/images/I/61vPRPWGPaL._AC_SL1500_.jpg',
									currentPrice: '199.99',
									currencyCode: 'USD',
									rating: 4.7,
									reviewCount: 1200,
									availability: 'In Stock',
								},
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {},
					targets: {
						amazon: {
							kind: 'product',
							asin: 'B0916J478T',
							canonicalUrl: 'https://www.amazon.com/dp/B0916J478T',
							marketplace: 'US',
						},
					},
				}),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('product-listing');
			expect(artifacts[0]?.data).toMatchObject({
				name: 'Carepod One Stainless Steel Humidifier for Large Room',
				brand: 'Carepod',
				price: '199.99',
				currency: 'USD',
				rating: 4.7,
				reviewCount: 1200,
				availability: 'In Stock',
				sku: 'B0916J478T',
			});
		});

		runPluginConformanceSuite(
			createProductListingPlugin({
				apiKey: 'test-key',
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							data: {
								amazonProduct: {
									title: 'Carepod One',
									asin: 'B0916J478T',
									url: 'https://www.amazon.com/dp/B0916J478T',
								},
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports explicit Amazon product target',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: {},
							targets: {
								amazon: {
									kind: 'product',
									asin: 'B0916J478T',
									canonicalUrl: 'https://www.amazon.com/dp/B0916J478T',
									marketplace: 'US',
								},
							},
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['product-listing'],
				},
				{
					name: 'does not support explicit Amazon storefront fallback target',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: {},
							targets: {
								amazon: {
									kind: 'storefront',
									canonicalUrl: 'https://www.amazon.com/stores/Example/page/123',
								},
							},
						}),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('x-profile', () => {
		it('normalizes authenticated X profile metadata from explicit profile target', async () => {
			const plugin = createXProfilePlugin({
				token: 'test-token',
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							data: {
								id: '1489350103840219144',
								username: '0xIntuition',
								name: 'Intuition',
								description: 'Belief graph infrastructure.',
								profile_banner_url:
									'https://pbs.twimg.com/profile_banners/1489350103840219144/example',
								profile_image_url: 'https://pbs.twimg.com/profile_images/example_normal.jpg',
								verified: true,
								created_at: '2024-01-02T00:00:00.000Z',
								public_metrics: {
									followers_count: 4200,
									following_count: 120,
									tweet_count: 980,
								},
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {},
					targets: {
						x: {
							kind: 'profile',
							handle: '0xIntuition',
							canonicalUrl: 'https://x.com/0xIntuition',
						},
					},
				}),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('x-profile');
			expect(artifacts[0]?.data).toMatchObject({
				username: '0xIntuition',
				name: 'Intuition',
				bio: 'Belief graph infrastructure.',
				profileBannerUrl: 'https://pbs.twimg.com/profile_banners/1489350103840219144/example',
				profileImageUrl: 'https://pbs.twimg.com/profile_images/example_400x400.jpg',
				followers: 4200,
				following: 120,
				tweetCount: 980,
				verified: true,
				joinedAt: '2024-01-02T00:00:00.000Z',
			});
		});

		runPluginConformanceSuite(
			createXProfilePlugin({
				token: 'test-token',
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							data: {
								id: '1489350103840219144',
								username: '0xIntuition',
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports explicit X profile target',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: {},
							targets: {
								x: {
									kind: 'profile',
									handle: '0xIntuition',
									canonicalUrl: 'https://x.com/0xIntuition',
								},
							},
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['x-profile'],
				},
				{
					name: 'does not support X post targets and falls back intentionally',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: {},
							targets: {
								x: {
									kind: 'post',
									handle: '0xIntuition',
									postId: '1920505170888216700',
									canonicalUrl: 'https://x.com/0xIntuition/status/1920505170888216700',
								},
							},
						}),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('wikipedia', () => {
		it('normalizes wikipedia summary fixture', async () => {
			const response = await readFixture(
				'../../src/plugins/providers/wikipedia/__fixtures__/summary.json'
			);
			const plugin = createWikipediaPlugin({
				fetch: createFetchMock([
					{ body: response, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({ hints: { name: 'Acme Labs', url: 'https://acme.example' } }),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('wikipedia');
			expect(artifacts[0]?.data).toMatchObject({
				title: 'Acme Labs',
				extract: 'Acme Labs is a developer tooling company.',
			});
		});

		runPluginConformanceSuite(
			createWikipediaPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							title: 'Acme Labs',
							extract: 'Acme Labs company profile',
							content_urls: {
								desktop: {
									page: 'https://en.wikipedia.org/wiki/Acme_Labs',
								},
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports with name',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { name: 'Acme Labs', url: 'https://acme.example' },
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['wikipedia'],
				},
				{
					name: 'does not support when no name or wiki url',
					request: createMockRequest({
						input: createNoNameNoUrlInput(),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('wikidata', () => {
		it('normalizes wikidata entity fixture', async () => {
			const response = await readFixture(
				'../../src/plugins/providers/wikidata/__fixtures__/entity.json'
			);
			const plugin = createWikidataPlugin({
				fetch: createFetchMock([
					{ body: response, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {
						name: 'Q12345',
						url: 'https://www.wikidata.org/wiki/Q12345',
						identifiers: { wikidata: 'Q12345' },
					},
				}),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('wikidata');
			expect(artifacts[0]?.data).toMatchObject({
				entityId: 'Q12345',
				label: 'Acme Labs',
				description: 'Fictional developer tooling company',
			});
		});

		runPluginConformanceSuite(
			createWikidataPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							entities: {
								Q12345: {
									id: 'Q12345',
									labels: { en: { value: 'Acme Labs' } },
								},
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports entity id',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: {
								identifiers: { wikidata: 'Q12345' },
								url: 'https://www.wikidata.org/wiki/Q12345',
							},
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['wikidata'],
				},
				{
					name: 'does not support without name or id',
					request: createMockRequest({
						input: createNoNameNoUrlInput(),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('github', () => {
		it('normalizes github repository fixture', async () => {
			const repositoryResponse = await readFixture(
				'../../src/plugins/providers/github/__fixtures__/repo.json'
			);
			const plugin = createGitHubPlugin({
				fetch: createFetchMock([
					{ body: repositoryResponse, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: { name: 'acme/acme-sdk', url: 'https://github.com/acme/acme-sdk' },
				}),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('github-repo');
			expect(artifacts[0]?.data).toMatchObject({
				owner: 'acme',
				name: 'acme-sdk',
				fullName: 'acme/acme-sdk',
				language: 'TypeScript',
			});
		});

		it('omits nullable and blank github fields that would fail artifact validation', async () => {
			const plugin = createGitHubPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							owner: { login: 'charmbracelet' },
							name: 'gum',
							full_name: 'charmbracelet/gum',
							description: 'A tool for glamorous shell scripts',
							language: 'Go',
							stargazers_count: 1,
							forks_count: 2,
							open_issues_count: 3,
							topics: [],
							license: null,
							created_at: '2024-01-01T00:00:00Z',
							updated_at: '2024-01-02T00:00:00Z',
							homepage: '',
							default_branch: 'main',
						}),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({
							login: 'acme',
							name: 'Acme Labs',
							avatar_url: 'https://avatars.githubusercontent.com/u/123?v=4',
							bio: null,
							company: null,
							location: null,
							blog: '',
							public_repos: 10,
							followers: 20,
							following: 30,
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			});

			const repoArtifacts = await plugin.enrich(
				createMockRequest({
					input: createMockAtomInput({
						hints: { url: 'https://github.com/charmbracelet/gum', name: 'charmbracelet/gum' },
					}),
				}),
				{
					now: () => '2026-01-01T00:00:00.000Z',
					signal: new AbortController().signal,
				}
			);

			expect(
				registry.validate(repoArtifacts[0]?.artifact_type ?? '', repoArtifacts[0]?.data).success
			).toBe(true);
			expect(repoArtifacts[0]?.data).toMatchObject({
				owner: 'charmbracelet',
				name: 'gum',
				fullName: 'charmbracelet/gum',
			});
			expect((repoArtifacts[0]?.data as { homepage?: string }).homepage).toBeUndefined();
			expect((repoArtifacts[0]?.data as { topics?: string[] }).topics).toBeUndefined();

			const userArtifacts = await plugin.enrich(
				createMockRequest({
					input: createMockAtomInput({
						hints: { url: 'https://github.com/acme', name: 'acme' },
					}),
				}),
				{
					now: () => '2026-01-01T00:00:00.000Z',
					signal: new AbortController().signal,
				}
			);

			expect(
				registry.validate(userArtifacts[0]?.artifact_type ?? '', userArtifacts[0]?.data).success
			).toBe(true);
			expect((userArtifacts[0]?.data as { blog?: string }).blog).toBeUndefined();
			expect((userArtifacts[0]?.data as { bio?: string }).bio).toBeUndefined();
		});

		runPluginConformanceSuite(
			createGitHubPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							owner: { login: 'acme' },
							name: 'acme-sdk',
							full_name: 'acme/acme-sdk',
						}),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({
							owner: { login: 'acme' },
							name: 'acme-sdk',
							full_name: 'acme/acme-sdk',
						}),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({
							login: 'acme',
							name: 'Acme Labs',
							avatar_url: 'https://avatars.githubusercontent.com/u/123?v=4',
						}),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({
							login: 'acme',
							name: 'Acme Labs',
							avatar_url: 'https://avatars.githubusercontent.com/u/123?v=4',
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports repository url',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { url: 'https://github.com/acme/acme-sdk', name: 'acme/acme-sdk' },
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['github-repo'],
				},
				{
					name: 'supports user profile url',
					request: createMockRequest({
						input: createMockAtomInput({ hints: { url: 'https://github.com/acme', name: 'acme' } }),
					}),
					expectedSupports: true,
					expectedClassifications: ['github-user'],
				},
				{
					name: 'does not support issue, pull, or commit github urls as repo fallbacks',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: {
								url: 'https://github.com/acme/acme-sdk/issues/123',
								name: 'acme/acme-sdk#123',
							},
						}),
					}),
					expectedSupports: false,
				},
				{
					name: 'does not support without github reference',
					request: createMockRequest({
						input: createNoNameNoUrlInput(),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('npm', () => {
		it('normalizes npm fixtures', async () => {
			const registryFixture = await readFixture(
				'../../src/plugins/providers/npm/__fixtures__/registry.json'
			);
			const downloadsFixture = await readFixture(
				'../../src/plugins/providers/npm/__fixtures__/downloads.json'
			);
			const plugin = createNpmPlugin({
				fetch: createFetchMock([
					{ body: registryFixture, headers: { 'content-type': 'application/json' } },
					{ body: downloadsFixture, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: { name: 'acme-sdk', url: 'https://www.npmjs.com/package/acme-sdk' },
				}),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('npm-package');
			expect(artifacts[0]?.data).toMatchObject({
				name: 'acme-sdk',
				version: '1.2.3',
				weeklyDownloads: 12034,
			});
		});

		runPluginConformanceSuite(
			createNpmPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							name: 'acme-sdk',
							'dist-tags': { latest: '1.0.0' },
							versions: {
								'1.0.0': {
									homepage: 'https://acme.example',
								},
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({ downloads: 10 }),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports npm package url',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { url: 'https://www.npmjs.com/package/acme-sdk', name: 'acme-sdk' },
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['npm-package'],
				},
				{
					name: 'does not support names with spaces',
					request: createMockRequest({
						input: createMockAtomInput({ hints: { name: 'Acme SDK Project', url: undefined } }),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('musicbrainz', () => {
		it('normalizes musicbrainz recording fixture', async () => {
			const response = await readFixture(
				'../../src/plugins/providers/musicbrainz/__fixtures__/recording.json'
			);
			const plugin = createMusicBrainzPlugin({
				fetch: createFetchMock([
					{ body: response, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {
						name: 'Acme Theme',
						url: 'https://acme.example',
						identifiers: { mbid: 'a3f4ec8d-7dd5-4da6-9e53-3f5aa4bd0d66' },
					},
				}),
			});
			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('musicbrainz');
			expect(artifacts[0]?.data).toMatchObject({
				name: 'Acme Theme',
				type: 'Recording',
			});
		});

		runPluginConformanceSuite(
			createMusicBrainzPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							recordings: [{ id: 'a3f4ec8d-7dd5-4da6-9e53-3f5aa4bd0d66', title: 'Acme Theme' }],
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports music recording name search',
					request: createMockRequest({
						input: createMockAtomInput({
							atomType: 'song',
							jsonLd: {
								'@context': 'https://schema.org',
								'@type': 'MusicRecording',
								name: 'Acme Theme',
							},
							hints: { name: 'Acme Theme', url: 'https://acme.example' },
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['musicbrainz'],
				},
				{
					name: 'does not support generic names',
					request: createMockRequest({
						input: createMockAtomInput({
							atomType: 'thing',
							jsonLd: {
								'@context': 'https://schema.org',
								'@type': 'Thing',
								name: 'Russian Blue',
							},
							hints: { name: 'Russian Blue', url: 'https://en.wikipedia.org/wiki/Russian_Blue' },
						}),
					}),
					expectedSupports: false,
				},
				{
					name: 'does not support music album name search',
					request: createMockRequest({
						input: createMockAtomInput({
							atomType: 'song',
							jsonLd: {
								'@context': 'https://schema.org',
								'@type': 'MusicAlbum',
								name: 'Acme Album',
							},
							hints: { name: 'Acme Album', url: 'https://acme.example/album' },
						}),
					}),
					expectedSupports: false,
				},
				{
					name: 'supports explicit mbid even without music recording classification',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: {
								name: 'Acme Theme',
								url: 'https://acme.example',
								identifiers: { mbid: 'a3f4ec8d-7dd5-4da6-9e53-3f5aa4bd0d66' },
							},
						}),
					}),
					expectedSupports: true,
				},
				{
					name: 'does not support without name or mbid',
					request: createMockRequest({
						input: createMockAtomInput({
							jsonLd: { '@context': 'https://schema.org', '@type': 'Thing' },
							hints: { url: 'https://acme.example' },
						}),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('tmdb', () => {
		it('normalizes tmdb movie fixture', async () => {
			const response = await readFixture(
				'../../src/plugins/providers/tmdb/__fixtures__/movie.json'
			);
			const plugin = createTmdbPlugin({
				fetch: createFetchMock([
					{ body: response, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({ hints: { identifiers: { tmdb: 'movie:550' } } }),
			});
			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('tmdb');
			expect(artifacts[0]?.data).toMatchObject({
				tmdbId: 550,
				mediaType: 'movie',
				title: 'Acme Origins',
			});
		});

		it('normalizes tmdb tv URLs into structured artifacts', async () => {
			let requestedUrl = '';
			const plugin = createTmdbPlugin({
				fetch: async (url) => {
					requestedUrl = String(url);
					return new Response(
						JSON.stringify({
							id: 1396,
							name: 'Breaking Bad',
							first_air_date: '2008-01-20',
							genres: [{ name: 'Drama' }],
							episode_run_time: [47],
						}),
						{ headers: { 'content-type': 'application/json' } }
					);
				},
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: { url: 'https://www.themoviedb.org/tv/1396-breaking-bad' },
				}),
			});
			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(requestedUrl).toContain('/3/tv/1396?');
			expect(artifacts[0]).toMatchObject({
				artifact_type: 'tmdb',
				data: {
					tmdbId: 1396,
					mediaType: 'tv',
					title: 'Breaking Bad',
					releaseDate: '2008-01-20',
					runtime: 47,
				},
				meta: {
					pluginId: 'tmdb',
					provider: 'tmdb',
					sourceUrl: 'https://www.themoviedb.org/tv/1396',
				},
			});
		});

		runPluginConformanceSuite(
			createTmdbPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							id: 550,
							title: 'Acme Origins',
							genres: [{ name: 'Drama' }],
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports tmdb movie url',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { url: 'https://www.themoviedb.org/movie/550', name: 'Acme Origins' },
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['tmdb'],
				},
				{
					name: 'supports tmdb tv url',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { url: 'https://www.themoviedb.org/tv/1396-breaking-bad' },
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['tmdb'],
				},
				{
					name: 'does not support without tmdb reference',
					request: createMockRequest({
						input: createNoNameNoUrlInput(),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('youtube', () => {
		it('normalizes youtube video fixture', async () => {
			const response = await readFixture(
				'../../src/plugins/providers/youtube/__fixtures__/video.json'
			);
			const plugin = createYouTubePlugin({
				fetch: createFetchMock([
					{ body: response, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: { url: 'https://www.youtube.com/watch?v=abc123xyz89' },
				}),
			});
			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('youtube');
			expect(artifacts[0]?.data).toMatchObject({
				videoId: 'abc123xyz89',
				title: 'Acme Demo',
				viewCount: 1024,
			});
		});

		runPluginConformanceSuite(
			createYouTubePlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							items: [
								{
									id: 'abc123xyz89',
									snippet: { title: 'Acme Demo' },
								},
							],
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports youtube watch url',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { url: 'https://www.youtube.com/watch?v=abc123xyz89' },
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['youtube'],
				},
				{
					name: 'does not support without youtube reference',
					request: createMockRequest({
						input: createNoNameNoUrlInput(),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('brand', () => {
		it('normalizes brand provider fixture', async () => {
			const response = await readFixture(
				'../../src/plugins/providers/brand/__fixtures__/brand.json'
			);
			const plugin = createBrandPlugin({
				fetch: createFetchMock([
					{ body: response, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({ hints: { url: 'https://acme.example' } }),
			});
			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('brand');
			expect(artifacts[0]?.data).toMatchObject({
				domain: 'acme.example',
				logoUrl: 'https://cdn.brandfetch.io/acme.example/logo.svg',
				primaryColor: '#1F2937',
			});
		});

		it('does not emit an unauthenticated Logo.dev fallback when Brandfetch is unavailable', async () => {
			const plugin = createBrandPlugin({
				fetch: createFetchMock([{ body: '{"message":"unauthorized"}', status: 401 }]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({ hints: { url: 'https://www.gucci.com/us/en/' } }),
			});
			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});
			const data = artifacts[0]?.data as { iconUrl?: string; logoUrl?: string } | undefined;

			expect(artifacts[0]?.artifact_type).toBe('brand');
			expect(data?.logoUrl).toBeUndefined();
			expect(data?.iconUrl).toBe('https://www.google.com/s2/favicons?domain=www.gucci.com&sz=128');
			expect(JSON.stringify(data)).not.toContain('img.logo.dev');
		});

		runPluginConformanceSuite(
			createBrandPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							domain: 'acme.example',
							logos: [{ formats: [{ src: 'https://cdn.brandfetch.io/acme.example/logo.svg' }] }],
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports with website url',
					request: createMockRequest({
						input: createMockAtomInput({ hints: { url: 'https://acme.example' } }),
					}),
					expectedSupports: true,
					expectedClassifications: ['brand'],
				},
				{
					name: 'does not support without domain',
					request: createMockRequest({
						input: createNoNameNoUrlInput(),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('favicon', () => {
		it('returns deterministic favicon url', async () => {
			const plugin = createFaviconPlugin();
			const request = createMockRequest({
				input: createMockAtomInput({ hints: { name: 'Acme', url: 'https://acme.example/docs' } }),
			});
			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('favicon');
			expect(artifacts[0]?.data).toMatchObject({
				url: 'https://www.google.com/s2/favicons?domain=acme.example&sz=128',
			});
		});

		runPluginConformanceSuite(
			createFaviconPlugin(),
			[
				{
					name: 'supports valid url',
					request: createMockRequest({
						input: createMockAtomInput({ hints: { url: 'https://acme.example', name: 'Acme' } }),
					}),
					expectedSupports: true,
					expectedClassifications: ['favicon'],
				},
				{
					name: 'does not support invalid url',
					request: createMockRequest({
						input: createMockAtomInput({ hints: { url: undefined, name: 'Acme' } }),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('coingecko', () => {
		it('normalizes coingecko token fixture', async () => {
			const response = await readFixture(
				'../../src/plugins/providers/coingecko/__fixtures__/coin.json'
			);
			const plugin = createCoinGeckoPlugin({
				fetch: createFetchMock([
					{ body: response, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({ hints: { identifiers: { coingecko: 'acme-token' } } }),
			});
			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('token-metadata');
			expect(artifacts[0]?.data).toMatchObject({
				address: '0x1111111111111111111111111111111111111111',
				name: 'Acme Token',
				symbol: 'ACME',
				decimals: 18,
				priceUsd: 1.23,
				coingeckoApiPayload: {
					id: 'acme-token',
					symbol: 'acme',
					name: 'Acme Token',
				},
			});
		});

		it('resolves contract target from etherscan url/name without explicit identifiers', async () => {
			const response = await readFixture(
				'../../src/plugins/providers/coingecko/__fixtures__/coin.json'
			);
			const plugin = createCoinGeckoPlugin({
				fetch: createFetchMock([
					{ body: response, headers: { 'content-type': 'application/json' } },
				]),
			});
			const address = '0x1111111111111111111111111111111111111111';
			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {
						name: `Ethereum Account ${address}`,
						url: `https://etherscan.io/address/${address}`,
					},
				}),
			});

			expect(plugin.supports(request)).toBe(true);

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('token-metadata');
			expect(artifacts[0]?.data).toMatchObject({
				address,
				coingeckoId: 'acme-token',
			});
		});

		it('returns not_found token-metadata artifact when contract lookup is missing upstream', async () => {
			const plugin = createCoinGeckoPlugin({
				fetch: createFetchMock([
					{ body: JSON.stringify({ status: { error_message: 'not found' } }), status: 404 },
				]),
			});
			const address = '0x1111111111111111111111111111111111111111';
			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {
						name: `Ethereum Account ${address}`,
						url: `https://etherscan.io/address/${address}`,
					},
				}),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('token-metadata');
			expect(artifacts[0]?.data).toMatchObject({
				address,
				lookupStatus: 'not_found',
				coingeckoLookupEndpoint:
					'https://api.coingecko.com/api/v3/coins/ethereum/contract/0x1111111111111111111111111111111111111111',
			});
		});

		it('returns error token-metadata artifact when upstream returns non-404 error', async () => {
			const plugin = createCoinGeckoPlugin({
				fetch: createFetchMock([
					{ body: JSON.stringify({ status: { error_message: 'upstream failure' } }), status: 500 },
				]),
			});
			const address = '0x1111111111111111111111111111111111111111';
			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {
						name: `Ethereum Account ${address}`,
						url: `https://etherscan.io/address/${address}`,
					},
				}),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('token-metadata');
			expect(artifacts[0]?.data).toMatchObject({
				address,
				lookupStatus: 'error',
				coingeckoLookupEndpoint:
					'https://api.coingecko.com/api/v3/coins/ethereum/contract/0x1111111111111111111111111111111111111111',
			});
		});

		runPluginConformanceSuite(
			createCoinGeckoPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							id: 'acme-token',
							symbol: 'acme',
							name: 'Acme Token',
							detail_platforms: {
								ethereum: {
									decimal_place: 18,
									contract_address: '0x1111111111111111111111111111111111111111',
								},
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports with coin id',
					request: createMockRequest({
						input: createMockAtomInput({ hints: { identifiers: { coingecko: 'acme-token' } } }),
					}),
					expectedSupports: true,
					expectedClassifications: ['token-metadata'],
				},
				{
					name: 'does not support without coin or contract reference',
					request: createMockRequest({
						input: createNoNameNoUrlInput(),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('etherscan', () => {
		it('uses Etherscan V2 endpoints with chainid for all lookups', async () => {
			const requestedUrls: string[] = [];
			const plugin = createEtherscanPlugin({
				apiKey: 'etherscan-key',
				fetch: async (url) => {
					requestedUrls.push(String(url));

					if (String(url).includes('action=balance')) {
						return new Response(JSON.stringify({ status: '1', result: '1200000000000000000' }), {
							headers: { 'content-type': 'application/json' },
						});
					}

					if (String(url).includes('action=eth_getTransactionCount')) {
						return new Response(JSON.stringify({ result: '0x1a' }), {
							headers: { 'content-type': 'application/json' },
						});
					}

					return new Response(
						JSON.stringify({
							status: '1',
							result: [
								{
									ContractName: 'AcmeToken',
									ABI: '[{}]',
									TokenName: 'Acme Token',
									TokenSymbol: 'ACME',
								},
							],
						}),
						{
							headers: { 'content-type': 'application/json' },
						}
					);
				},
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {
						identifiers: { address: '0x1111111111111111111111111111111111111111' },
					},
				}),
			});

			await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(requestedUrls).toHaveLength(3);
			for (const url of requestedUrls) {
				expect(url).toContain('https://api.etherscan.io/v2/api?');
				expect(url).toContain('chainid=1');
				expect(url).toContain('apikey=etherscan-key');
			}
		});

		it('normalizes etherscan address fixtures', async () => {
			const balanceResponse = await readFixture(
				'../../src/plugins/providers/etherscan/__fixtures__/balance.json'
			);
			const txCountResponse = await readFixture(
				'../../src/plugins/providers/etherscan/__fixtures__/txcount.json'
			);
			const contractResponse = await readFixture(
				'../../src/plugins/providers/etherscan/__fixtures__/contract.json'
			);
			const plugin = createEtherscanPlugin({
				fetch: createFetchMock([
					{ body: balanceResponse, headers: { 'content-type': 'application/json' } },
					{ body: txCountResponse, headers: { 'content-type': 'application/json' } },
					{ body: contractResponse, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {
						identifiers: { address: '0x1111111111111111111111111111111111111111' },
					},
				}),
			});
			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('etherscan');
			expect(artifacts[0]?.data).toMatchObject({
				address: '0x1111111111111111111111111111111111111111',
				balance: '1234500000000000000',
				transactionCount: 42,
				isContract: true,
				contractName: 'AcmeToken',
				tokenSymbol: 'ACME',
			});
		});

		runPluginConformanceSuite(
			createEtherscanPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({ status: '1', result: '1200000000000000000' }),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({ result: '0x1a' }),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({
							status: '1',
							result: [
								{
									ContractName: 'AcmeToken',
									ABI: '[{}]',
									TokenName: 'Acme Token',
									TokenSymbol: 'ACME',
								},
							],
						}),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({ status: '1', result: '1200000000000000000' }),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({ result: '0x1a' }),
						headers: { 'content-type': 'application/json' },
					},
					{
						body: JSON.stringify({
							status: '1',
							result: [
								{
									ContractName: 'AcmeToken',
									ABI: '[{}]',
									TokenName: 'Acme Token',
									TokenSymbol: 'ACME',
								},
							],
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports with ethereum address',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: { identifiers: { address: '0x1111111111111111111111111111111111111111' } },
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['etherscan'],
				},
				{
					name: 'does not support without ethereum address',
					request: createMockRequest({
						input: createNoNameNoUrlInput(),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});

	describe('crossref', () => {
		it('normalizes crossref response fixture', async () => {
			const response = await readFixture(
				'../../src/plugins/providers/crossref/__fixtures__/work.json'
			);
			const plugin = createCrossrefPlugin({
				fetch: createFetchMock([
					{ body: response, headers: { 'content-type': 'application/json' } },
				]),
			});

			const request = createMockRequest({
				input: createMockAtomInput({
					hints: {
						name: '10.1234/acme.2026.1',
						url: 'https://doi.org/10.1234/acme.2026.1',
						identifiers: { doi: '10.1234/acme.2026.1' },
					},
				}),
			});

			const artifacts = await plugin.enrich(request, {
				now: () => '2026-01-01T00:00:00.000Z',
				signal: new AbortController().signal,
			});

			expect(artifacts[0]?.artifact_type).toBe('doi');
			expect(artifacts[0]?.data).toMatchObject({
				doi: '10.1234/acme.2026.1',
				title: 'Acme Research Paper',
				journal: 'Acme Journal',
			});
		});

		runPluginConformanceSuite(
			createCrossrefPlugin({
				fetch: createFetchMock([
					{
						body: JSON.stringify({
							message: {
								DOI: '10.1234/acme.1',
								title: ['Acme Work'],
								URL: 'https://doi.org/10.1234/acme.1',
							},
						}),
						headers: { 'content-type': 'application/json' },
					},
				]),
			}),
			[
				{
					name: 'supports doi',
					request: createMockRequest({
						input: createMockAtomInput({
							hints: {
								name: '10.1234/acme.1',
								url: 'https://doi.org/10.1234/acme.1',
								identifiers: { doi: '10.1234/acme.1' },
							},
						}),
					}),
					expectedSupports: true,
					expectedClassifications: ['doi'],
				},
				{
					name: 'does not support without doi',
					request: createMockRequest({
						input: createMockAtomInput({ hints: { name: 'Acme', url: 'https://acme.example' } }),
					}),
					expectedSupports: false,
				},
			],
			registry
		);
	});
});

function assertRegistryCoverage(registryToCheck: ClassificationRegistry): void {
	expect(registryToCheck.has('opengraph')).toBe(true);
	expect(registryToCheck.has('oembed')).toBe(true);
	expect(registryToCheck.has('wikipedia')).toBe(true);
	expect(registryToCheck.has('wikidata')).toBe(true);
	expect(registryToCheck.has('github-repo')).toBe(true);
	expect(registryToCheck.has('github-user')).toBe(true);
	expect(registryToCheck.has('npm-package')).toBe(true);
	expect(registryToCheck.has('musicbrainz')).toBe(true);
	expect(registryToCheck.has('spotify')).toBe(true);
	expect(registryToCheck.has('tmdb')).toBe(true);
	expect(registryToCheck.has('youtube')).toBe(true);
	expect(registryToCheck.has('brand')).toBe(true);
	expect(registryToCheck.has('favicon')).toBe(true);
	expect(registryToCheck.has('token-metadata')).toBe(true);
	expect(registryToCheck.has('etherscan')).toBe(true);
	expect(registryToCheck.has('doi')).toBe(true);
}

describe('v1 provider registry coverage', () => {
	it('includes all expected v1 provider output classifications', () => {
		assertRegistryCoverage(registry);
	});
});
