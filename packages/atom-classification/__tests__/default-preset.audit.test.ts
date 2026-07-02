import { describe, expect, it } from 'bun:test';

import { createNonUrlV0Profiles, createPlatformV0Profiles } from '../src/plugins/index';
import {
	type DefaultClassificationPresetOptions,
	defaultClassificationPreset,
} from '../src/presets';
import { createServerEngine } from '../src/server';
import type { ClassificationResult } from '../src/types';

const AUDIT_NOW = '2026-04-01T00:00:00.000Z';

type AuditDisposition = 'keep' | 'remove';

type AuditRecord = {
	fixtureId: string;
	input: string;
	classification: {
		domain: string | undefined;
		subtype: string | undefined;
		confidence: number | undefined;
	};
	resolverId: string | undefined;
	fallbackUsed: boolean | undefined;
	platformResolver: {
		fallbackStage: string | undefined;
		attemptedStages: string[];
		skippedStages: string[];
		stageErrors: string[];
	} | null;
	atom: {
		schemaType: string | undefined;
		category: string | undefined;
		canonicalId: string | undefined;
		source: string | undefined;
		metadata: {
			pluginId: string | undefined;
			provider: string | undefined;
			platform: string | undefined;
			subtype: string | undefined;
			fallbackStage: string | undefined;
			resolutionMode?: string | undefined;
		};
	} | null;
	failureMode: string;
	disposition: AuditDisposition;
};

type AuditFixture = {
	id: string;
	input: string;
	options?: DefaultClassificationPresetOptions;
	expected: AuditRecord;
};

describe('default preset audit', () => {
	it('keeps the active preset inventory deterministic and includes amazon', () => {
		const activePluginIds = createAuditPlugins().map((plugin) => plugin.manifest.id);
		const activePlatformPluginIds = activePluginIds.filter((pluginId) =>
			createPlatformV0Profiles().some((profile) => pluginId === profile.domain)
		);

		expect(createNonUrlV0Profiles().map((profile) => profile.id)).toEqual([
			'ethereum',
			'isbn',
			'lexical',
			'plain-text',
		]);
		expect(createPlatformV0Profiles().map((profile) => profile.domain)).toEqual([
			'spotify',
			'amazon',
			'github',
			'npm',
			'x',
			'instagram',
			'tiktok',
			'youtube',
			'wikipedia',
			'imdb',
			'tmdb',
		]);
		expect(activePluginIds).toEqual([
			'type-profiles',
			'etherscan',
			'isbn',
			'plain-text',
			'spotify',
			'amazon',
			'github',
			'npm',
			'x',
			'instagram',
			'tiktok',
			'youtube',
			'wikipedia',
			'imdb',
			'tmdb',
			'default-url',
		]);
		expect(activePlatformPluginIds).toEqual([
			'spotify',
			'amazon',
			'github',
			'npm',
			'x',
			'instagram',
			'tiktok',
			'youtube',
			'wikipedia',
			'imdb',
			'tmdb',
		]);
	});

	it('covers every active default preset path plus degraded provider cases with deterministic audit fixtures', async () => {
		for (const fixture of auditFixtures) {
			const engine = createServerEngine({
				now: () => new Date(AUDIT_NOW),
				plugins: createAuditPlugins(fixture.options),
			});
			const result = await engine.classify({
				input: fixture.input,
				mode: 'progressive',
				classificationSessionId: `audit-${fixture.id}`,
			});

			expect(projectAuditRecord(fixture, result, engine.getLastMetadata())).toEqual(
				fixture.expected
			);
		}
	});
});

const auditFixtures: AuditFixture[] = [
	{
		id: 'ethereum-account',
		input: '0x1111111111111111111111111111111111111111',
		expected: {
			fixtureId: 'ethereum-account',
			input: '0x1111111111111111111111111111111111111111',
			classification: {
				domain: 'ethereum',
				subtype: 'account',
				confidence: 0.99,
			},
			resolverId: 'etherscan-resolver',
			fallbackUsed: true,
			platformResolver: null,
			atom: {
				schemaType: 'EthereumAccount',
				category: 'thing',
				canonicalId: 'eip155:1:0x1111111111111111111111111111111111111111',
				source: 'etherscan-resolver',
				metadata: {
					pluginId: 'etherscan',
					provider: 'etherscan',
					platform: undefined,
					subtype: undefined,
					fallbackStage: undefined,
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'isbn-book',
		input: 'ISBN 9780306406157',
		expected: {
			fixtureId: 'isbn-book',
			input: 'ISBN 9780306406157',
			classification: {
				domain: 'isbn',
				subtype: 'isbn-13',
				confidence: 0.98,
			},
			resolverId: 'isbn-resolver',
			fallbackUsed: true,
			platformResolver: null,
			atom: {
				schemaType: 'Book',
				category: 'thing',
				canonicalId: 'isbn:9780306406157',
				source: 'isbn-resolver',
				metadata: {
					pluginId: 'isbn',
					provider: 'isbn',
					platform: undefined,
					subtype: undefined,
					fallbackStage: undefined,
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'default-plain-text-word',
		input: 'semantic',
		expected: {
			fixtureId: 'default-plain-text-word',
			input: 'semantic',
			classification: {
				domain: 'plain-text',
				subtype: 'word',
				confidence: 0.64,
			},
			resolverId: 'plain-text-resolver',
			fallbackUsed: true,
			platformResolver: null,
			atom: {
				schemaType: 'Thing',
				category: 'thing',
				canonicalId: undefined,
				source: 'plain-text',
				metadata: {
					pluginId: 'plain-text',
					provider: 'plain-text',
					platform: undefined,
					subtype: undefined,
					fallbackStage: undefined,
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'plain-text-word',
		input: 'blorple',
		expected: {
			fixtureId: 'plain-text-word',
			input: 'blorple',
			classification: {
				domain: 'plain-text',
				subtype: 'word',
				confidence: 0.64,
			},
			resolverId: 'plain-text-resolver',
			fallbackUsed: true,
			platformResolver: null,
			atom: {
				schemaType: 'Thing',
				category: 'thing',
				canonicalId: undefined,
				source: 'plain-text',
				metadata: {
					pluginId: 'plain-text',
					provider: 'plain-text',
					platform: undefined,
					subtype: undefined,
					fallbackStage: undefined,
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'plain-text-phrase',
		input: 'semantic grounding',
		expected: {
			fixtureId: 'plain-text-phrase',
			input: 'semantic grounding',
			classification: {
				domain: 'plain-text',
				subtype: 'phrase',
				confidence: 0.61,
			},
			resolverId: 'plain-text-resolver',
			fallbackUsed: true,
			platformResolver: null,
			atom: {
				schemaType: 'Thing',
				category: 'thing',
				canonicalId: undefined,
				source: 'plain-text',
				metadata: {
					pluginId: 'plain-text',
					provider: 'plain-text',
					platform: undefined,
					subtype: undefined,
					fallbackStage: undefined,
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'spotify-domain-api',
		input: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
		options: createSpotifyDomainApiFixtureOptions(),
		expected: {
			fixtureId: 'spotify-domain-api',
			input: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
			classification: {
				domain: 'spotify',
				subtype: 'track',
				confidence: 0.99,
			},
			resolverId: 'spotify-resolver',
			fallbackUsed: false,
			platformResolver: {
				fallbackStage: 'domain-api',
				attemptedStages: ['domain-api'],
				skippedStages: [],
				stageErrors: [],
			},
			atom: {
				schemaType: 'MusicRecording',
				category: 'song',
				canonicalId: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
				source: 'platform-v0:domain-api',
				metadata: {
					pluginId: 'spotify',
					provider: 'spotify-audit-domain-api',
					platform: 'spotify',
					subtype: undefined,
					fallbackStage: 'domain-api',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'github-domain-api',
		input: 'https://github.com/openai/openai-node',
		options: createGitHubDomainApiFixtureOptions(),
		expected: {
			fixtureId: 'github-domain-api',
			input: 'https://github.com/openai/openai-node',
			classification: {
				domain: 'github',
				subtype: 'repo',
				confidence: 0.97,
			},
			resolverId: 'github-resolver',
			fallbackUsed: false,
			platformResolver: {
				fallbackStage: 'domain-api',
				attemptedStages: ['domain-api'],
				skippedStages: [],
				stageErrors: [],
			},
			atom: {
				schemaType: 'SoftwareSourceCode',
				category: 'software',
				canonicalId: 'github:repo:openai/openai-node',
				source: 'platform-v0:domain-api',
				metadata: {
					pluginId: 'github',
					provider: 'github-audit-domain-api',
					platform: 'github',
					subtype: undefined,
					fallbackStage: 'domain-api',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'x-post-generic',
		input: 'https://x.com/intuition/status/123456789',
		expected: {
			fixtureId: 'x-post-generic',
			input: 'https://x.com/intuition/status/123456789',
			classification: {
				domain: 'x',
				subtype: 'post',
				confidence: 0.98,
			},
			resolverId: 'x-resolver',
			fallbackUsed: true,
			platformResolver: {
				fallbackStage: 'generic',
				attemptedStages: ['oembed', 'opengraph', 'generic'],
				skippedStages: ['domain-api:no-credentials'],
				stageErrors: [],
			},
			atom: {
				schemaType: 'SocialMediaPosting',
				category: 'thing',
				canonicalId: 'x:post:123456789',
				source: 'platform-v0:generic',
				metadata: {
					pluginId: 'x',
					provider: 'x',
					platform: 'x',
					subtype: 'post',
					fallbackStage: 'generic',
					resolutionMode: 'identity-only',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'instagram-video-generic',
		input: 'https://www.instagram.com/reel/C4f6h1M0abc/',
		expected: {
			fixtureId: 'instagram-video-generic',
			input: 'https://www.instagram.com/reel/C4f6h1M0abc/',
			classification: {
				domain: 'instagram',
				subtype: 'video',
				confidence: 0.97,
			},
			resolverId: 'instagram-resolver',
			fallbackUsed: true,
			platformResolver: {
				fallbackStage: 'generic',
				attemptedStages: ['oembed', 'opengraph', 'generic'],
				skippedStages: ['domain-api:no-credentials'],
				stageErrors: [],
			},
			atom: {
				schemaType: 'VideoObject',
				category: 'thing',
				canonicalId: 'instagram:video:C4f6h1M0abc',
				source: 'platform-v0:generic',
				metadata: {
					pluginId: 'instagram',
					provider: 'instagram',
					platform: 'instagram',
					subtype: 'video',
					fallbackStage: 'generic',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'tiktok-video-generic',
		input: 'https://www.tiktok.com/@intuition/video/7345678901234567890',
		expected: {
			fixtureId: 'tiktok-video-generic',
			input: 'https://www.tiktok.com/@intuition/video/7345678901234567890',
			classification: {
				domain: 'tiktok',
				subtype: 'video',
				confidence: 0.98,
			},
			resolverId: 'tiktok-resolver',
			fallbackUsed: true,
			platformResolver: {
				fallbackStage: 'generic',
				attemptedStages: ['oembed', 'opengraph', 'generic'],
				skippedStages: ['domain-api:no-credentials'],
				stageErrors: [],
			},
			atom: {
				schemaType: 'VideoObject',
				category: 'thing',
				canonicalId: 'tiktok:video:7345678901234567890',
				source: 'platform-v0:generic',
				metadata: {
					pluginId: 'tiktok',
					provider: 'tiktok',
					platform: 'tiktok',
					subtype: 'video',
					fallbackStage: 'generic',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'youtube-oembed',
		input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		options: createYouTubeOEmbedFixtureOptions(),
		expected: {
			fixtureId: 'youtube-oembed',
			input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			classification: {
				domain: 'youtube',
				subtype: 'video',
				confidence: 0.99,
			},
			resolverId: 'youtube-resolver',
			fallbackUsed: true,
			platformResolver: {
				fallbackStage: 'oembed',
				attemptedStages: ['oembed'],
				skippedStages: ['domain-api:no-credentials'],
				stageErrors: [],
			},
			atom: {
				schemaType: 'VideoObject',
				category: 'thing',
				canonicalId: 'youtube:video:dQw4w9WgXcQ',
				source: 'platform-v0:oembed',
				metadata: {
					pluginId: 'youtube',
					provider: 'youtube-audit-oembed',
					platform: 'youtube',
					subtype: undefined,
					fallbackStage: 'oembed',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'wikipedia-software-generic',
		input: 'https://en.wikipedia.org/wiki/Notion_(software)',
		expected: {
			fixtureId: 'wikipedia-software-generic',
			input: 'https://en.wikipedia.org/wiki/Notion_(software)',
			classification: {
				domain: 'wikipedia',
				subtype: 'article',
				confidence: 0.95,
			},
			resolverId: 'wikipedia-resolver',
			fallbackUsed: true,
			platformResolver: {
				fallbackStage: 'generic',
				attemptedStages: ['oembed', 'opengraph', 'generic'],
				skippedStages: ['domain-api:no-credentials'],
				stageErrors: [],
			},
			atom: {
				schemaType: 'SoftwareApplication',
				category: 'software',
				canonicalId: 'wikipedia:notion-software',
				source: 'platform-v0:generic',
				metadata: {
					pluginId: 'wikipedia',
					provider: 'wikipedia',
					platform: 'wikipedia',
					subtype: 'article',
					fallbackStage: 'generic',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'imdb-title-domain-html',
		input: 'https://www.imdb.com/title/tt0133093/',
		options: createImdbDomainHtmlFixtureOptions(),
		expected: {
			fixtureId: 'imdb-title-domain-html',
			input: 'https://www.imdb.com/title/tt0133093/',
			classification: {
				domain: 'imdb',
				subtype: 'title',
				confidence: 0.98,
			},
			resolverId: 'imdb-resolver',
			fallbackUsed: false,
			platformResolver: {
				fallbackStage: 'domain-html',
				attemptedStages: ['domain-html'],
				skippedStages: ['domain-api:no-credentials'],
				stageErrors: [],
			},
			atom: {
				schemaType: 'Movie',
				category: 'thing',
				canonicalId: 'imdb:title:tt0133093',
				source: 'platform-v0:domain-html',
				metadata: {
					pluginId: 'imdb',
					provider: 'imdb-audit-html',
					platform: 'imdb',
					subtype: undefined,
					fallbackStage: 'domain-html',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'tmdb-tv',
		input: 'https://www.themoviedb.org/tv/1396-breaking-bad',
		expected: {
			fixtureId: 'tmdb-tv',
			input: 'https://www.themoviedb.org/tv/1396-breaking-bad',
			classification: {
				domain: 'tmdb',
				subtype: 'tv',
				confidence: 0.99,
			},
			resolverId: 'tmdb-resolver',
			fallbackUsed: true,
			platformResolver: {
				fallbackStage: 'generic',
				attemptedStages: ['opengraph', 'generic'],
				skippedStages: ['domain-api:no-credentials', 'oembed:unsupported'],
				stageErrors: [],
			},
			atom: {
				schemaType: 'TVSeries',
				category: 'thing',
				canonicalId: 'tmdb:tv:1396',
				source: 'platform-v0:generic',
				metadata: {
					pluginId: 'tmdb',
					provider: 'tmdb',
					platform: 'tmdb',
					subtype: 'tv',
					fallbackStage: 'generic',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'npm-package',
		input: 'https://www.npmjs.com/package/hono',
		expected: {
			fixtureId: 'npm-package',
			input: 'https://www.npmjs.com/package/hono',
			classification: {
				domain: 'npm',
				subtype: 'package',
				confidence: 0.99,
			},
			resolverId: 'npm-resolver',
			fallbackUsed: true,
			platformResolver: {
				fallbackStage: 'generic',
				attemptedStages: ['opengraph', 'generic'],
				skippedStages: ['domain-api:no-credentials', 'oembed:unsupported'],
				stageErrors: [],
			},
			atom: {
				schemaType: 'SoftwareSourceCode',
				category: 'software',
				canonicalId: 'npm:package:hono',
				source: 'platform-v0:generic',
				metadata: {
					pluginId: 'npm',
					provider: 'npm',
					platform: 'npm',
					subtype: 'package',
					fallbackStage: 'generic',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'default-url-website',
		input: 'https://intuition.systems',
		expected: {
			fixtureId: 'default-url-website',
			input: 'https://intuition.systems',
			classification: {
				domain: 'web',
				subtype: 'website',
				confidence: 0.72,
			},
			resolverId: 'default-url-resolver',
			fallbackUsed: true,
			platformResolver: null,
			atom: {
				schemaType: 'WebSite',
				category: 'thing',
				canonicalId: 'https://intuition.systems',
				source: 'default-url-resolver',
				metadata: {
					pluginId: 'default-url',
					provider: 'default-url',
					platform: undefined,
					subtype: undefined,
					fallbackStage: undefined,
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'default-url-bare-domain',
		input: 'example.com,',
		expected: {
			fixtureId: 'default-url-bare-domain',
			input: 'example.com,',
			classification: {
				domain: 'web',
				subtype: 'website',
				confidence: 0.72,
			},
			resolverId: 'default-url-resolver',
			fallbackUsed: true,
			platformResolver: null,
			atom: {
				schemaType: 'WebSite',
				category: 'thing',
				canonicalId: 'https://example.com',
				source: 'default-url-resolver',
				metadata: {
					pluginId: 'default-url',
					provider: 'default-url',
					platform: undefined,
					subtype: undefined,
					fallbackStage: undefined,
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
	{
		id: 'spotify-domain-api-blocked',
		input: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
		options: createSpotifyBlockedFixtureOptions(),
		expected: {
			fixtureId: 'spotify-domain-api-blocked',
			input: 'https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh',
			classification: {
				domain: 'spotify',
				subtype: 'track',
				confidence: 0.99,
			},
			resolverId: 'spotify-resolver',
			fallbackUsed: true,
			platformResolver: {
				fallbackStage: 'generic',
				attemptedStages: ['domain-api', 'oembed', 'opengraph', 'generic'],
				skippedStages: [],
				stageErrors: ['domain-api:spotify domain api blocked'],
			},
			atom: {
				schemaType: 'MusicRecording',
				category: 'song',
				canonicalId: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
				source: 'platform-v0:generic',
				metadata: {
					pluginId: 'spotify',
					provider: 'spotify',
					platform: 'spotify',
					subtype: 'track',
					fallbackStage: 'generic',
				},
			},
			failureMode: 'domain-api-blocked',
			disposition: 'keep',
		},
	},
	{
		id: 'youtube-oembed-blocked',
		input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		options: createYouTubeBlockedFixtureOptions(),
		expected: {
			fixtureId: 'youtube-oembed-blocked',
			input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			classification: {
				domain: 'youtube',
				subtype: 'video',
				confidence: 0.99,
			},
			resolverId: 'youtube-resolver',
			fallbackUsed: true,
			platformResolver: {
				fallbackStage: 'generic',
				attemptedStages: ['oembed', 'opengraph', 'generic'],
				skippedStages: ['domain-api:no-credentials'],
				stageErrors: ['oembed:youtube oembed blocked'],
			},
			atom: {
				schemaType: 'VideoObject',
				category: 'thing',
				canonicalId: 'youtube:video:dQw4w9WgXcQ',
				source: 'platform-v0:generic',
				metadata: {
					pluginId: 'youtube',
					provider: 'youtube',
					platform: 'youtube',
					subtype: 'video',
					fallbackStage: 'generic',
				},
			},
			failureMode: 'oembed-blocked',
			disposition: 'keep',
		},
	},
	{
		id: 'amazon-domain-html',
		input: 'https://www.amazon.com/dp/B0916J478T?th=1',
		options: createAmazonDomainHtmlFixtureOptions(),
		expected: {
			fixtureId: 'amazon-domain-html',
			input: 'https://www.amazon.com/dp/B0916J478T?th=1',
			classification: {
				domain: 'amazon',
				subtype: 'product',
				confidence: 0.96,
			},
			resolverId: 'amazon-resolver',
			fallbackUsed: false,
			platformResolver: {
				fallbackStage: 'domain-html',
				attemptedStages: ['domain-html'],
				skippedStages: ['domain-api:no-credentials'],
				stageErrors: [],
			},
			atom: {
				schemaType: 'Product',
				category: 'product',
				canonicalId: 'asin:B0916J478T',
				source: 'platform-v0:domain-html',
				metadata: {
					pluginId: 'amazon',
					provider: 'amazon-audit-html',
					platform: 'amazon',
					subtype: undefined,
					fallbackStage: 'domain-html',
				},
			},
			failureMode: 'none',
			disposition: 'keep',
		},
	},
];

function createAuditPlugins(options: DefaultClassificationPresetOptions = {}) {
	return defaultClassificationPreset({
		...options,
		xPluginOptions: {
			useDefaultDomainApiAdapter: false,
			useDefaultPublicMetadataAdapter: false,
			useDefaultOpenGraphAdapter: false,
			...(options.xPluginOptions ?? {}),
		},
		youtubePluginOptions: {
			useDefaultOEmbedAdapter: false,
			...(options.youtubePluginOptions ?? {}),
		},
	});
}

function createSpotifyDomainApiFixtureOptions(): DefaultClassificationPresetOptions {
	return {
		spotifyPluginOptions: {
			credentials: {
				spotify: {
					clientId: 'spotify-audit-client-id',
					clientSecret: 'spotify-audit-client-secret',
				},
			},
			adapters: {
				domainApi: ({ domain, canonicalUrl }) => {
					if (domain !== 'spotify') {
						return null;
					}

					return {
						schemaType: 'MusicRecording',
						category: 'song',
						title: 'Never Gonna Give You Up',
						canonicalId: 'spotify:track:4iV5W9uYEdYUVa79Axb7Rh',
						sameAs: [canonicalUrl],
						metadata: {
							pluginId: 'spotify',
							provider: 'spotify-audit-domain-api',
							sourceUrl: canonicalUrl,
						},
					};
				},
			},
		},
	};
}

function createGitHubDomainApiFixtureOptions(): DefaultClassificationPresetOptions {
	return {
		githubPluginOptions: {
			adapters: {
				domainApi: ({ domain, canonicalUrl }) => {
					if (domain !== 'github') {
						return null;
					}

					return {
						schemaType: 'SoftwareSourceCode',
						category: 'software',
						title: 'openai/openai-node',
						canonicalId: 'github:repo:openai/openai-node',
						sameAs: [canonicalUrl],
						metadata: {
							pluginId: 'github',
							provider: 'github-audit-domain-api',
							sourceUrl: canonicalUrl,
						},
					};
				},
			},
		},
	};
}

function createSpotifyBlockedFixtureOptions(): DefaultClassificationPresetOptions {
	return {
		spotifyPluginOptions: {
			credentials: {
				spotify: {
					clientId: 'spotify-audit-client-id',
					clientSecret: 'spotify-audit-client-secret',
				},
			},
			adapters: {
				domainApi: ({ domain }) => {
					if (domain !== 'spotify') {
						return null;
					}

					throw new Error('spotify domain api blocked');
				},
			},
		},
	};
}

function createYouTubeOEmbedFixtureOptions(): DefaultClassificationPresetOptions {
	return {
		youtubePluginOptions: {
			adapters: {
				oEmbed: ({ domain, classification, canonicalUrl }) => {
					if (domain !== 'youtube' || classification.subtype !== 'video') {
						return null;
					}

					return {
						schemaType: 'VideoObject',
						category: 'thing',
						title: 'Rick Astley - Never Gonna Give You Up (Official Video)',
						canonicalId: 'youtube:video:dQw4w9WgXcQ',
						sameAs: [canonicalUrl],
						metadata: {
							pluginId: 'youtube',
							provider: 'youtube-audit-oembed',
							sourceUrl: canonicalUrl,
						},
					};
				},
			},
		},
	};
}

function createYouTubeBlockedFixtureOptions(): DefaultClassificationPresetOptions {
	return {
		youtubePluginOptions: {
			adapters: {
				oEmbed: ({ domain }) => {
					if (domain !== 'youtube') {
						return null;
					}

					throw new Error('youtube oembed blocked');
				},
			},
		},
	};
}

function createImdbDomainHtmlFixtureOptions(): DefaultClassificationPresetOptions {
	return {
		imdbPluginOptions: {
			adapters: {
				domainHtml: ({ domain, classification, canonicalUrl }) => {
					if (domain !== 'imdb' || classification.subtype !== 'title') {
						return null;
					}

					return {
						schemaType: 'Movie',
						category: 'thing',
						title: 'The Matrix',
						canonicalId: 'imdb:title:tt0133093',
						sameAs: [canonicalUrl],
						data: {
							'@context': 'https://schema.org/',
							'@type': 'Movie',
							name: 'The Matrix',
							url: canonicalUrl,
							sameAs: [canonicalUrl],
						},
						metadata: {
							pluginId: 'imdb',
							provider: 'imdb-audit-html',
							sourceUrl: canonicalUrl,
						},
					};
				},
			},
		},
	};
}

function createAmazonDomainHtmlFixtureOptions(): DefaultClassificationPresetOptions {
	return {
		amazonPluginOptions: {
			adapters: {
				domainHtml: ({ domain, classification, canonicalUrl }) => {
					if (domain !== 'amazon' || classification.subtype !== 'product') {
						return null;
					}

					return {
						schemaType: 'Product',
						category: 'product',
						title: 'Carepod One Stainless Steel Humidifier for Large Room',
						canonicalId: 'asin:B0916J478T',
						sameAs: [canonicalUrl],
						data: {
							'@context': 'https://schema.org/',
							'@type': 'Product',
							name: 'Carepod One Stainless Steel Humidifier for Large Room',
							url: canonicalUrl,
							sameAs: [canonicalUrl],
							sku: 'B0916J478T',
							brand: 'Carepod',
						},
						metadata: {
							pluginId: 'amazon',
							provider: 'amazon-audit-html',
							sourceUrl: canonicalUrl,
						},
					};
				},
			},
		},
	};
}

function projectAuditRecord(
	fixture: AuditFixture,
	result: ClassificationResult,
	metadata: Record<string, unknown>
): AuditRecord {
	const atom = result.resolved?.atoms[0];
	const atomMetadata =
		atom?.metadata && typeof atom.metadata === 'object' && !Array.isArray(atom.metadata)
			? (atom.metadata as Record<string, unknown>)
			: {};
	const platformResolver =
		metadata.platformResolver &&
		typeof metadata.platformResolver === 'object' &&
		!Array.isArray(metadata.platformResolver)
			? (metadata.platformResolver as Record<string, unknown>)
			: null;

	return {
		fixtureId: fixture.id,
		input: fixture.input,
		classification: {
			domain: result.classification?.domain,
			subtype: result.classification?.subtype,
			confidence: result.classification?.confidence,
		},
		resolverId: result.resolved?.resolverId,
		fallbackUsed: result.resolved?.fallbackUsed,
		platformResolver: platformResolver
			? {
					fallbackStage: toStringMaybe(platformResolver.fallbackStage),
					attemptedStages: toStringArray(platformResolver.attemptedStages),
					skippedStages: toStringArray(platformResolver.skippedStages),
					stageErrors: toStringArray(platformResolver.stageErrors),
				}
			: null,
		atom: atom
			? {
					schemaType: atom.schemaType,
					category: atom.category,
					canonicalId: atom.canonicalId,
					source: atom.source,
					metadata: {
						pluginId: toStringMaybe(atomMetadata.pluginId),
						provider: toStringMaybe(atomMetadata.provider),
						platform: toStringMaybe(atomMetadata.platform),
						subtype: toStringMaybe(atomMetadata.subtype),
						fallbackStage: toStringMaybe(atomMetadata.fallbackStage),
						...(toStringMaybe(atomMetadata.resolutionMode)
							? { resolutionMode: toStringMaybe(atomMetadata.resolutionMode) }
							: {}),
					},
				}
			: null,
		failureMode: fixture.expected.failureMode,
		disposition: fixture.expected.disposition,
	};
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((entry): entry is string => typeof entry === 'string');
}

function toStringMaybe(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0 ? value : undefined;
}
