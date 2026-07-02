import { describe, expect, it } from 'bun:test';
import {
	buildDecisionContextFromProcessPayload,
	resolveDecisionFromPersistedAtom,
	resolveDecisionFromProcessPayload,
	selectPrimaryArtifactForDecision,
} from '../src';
import type { PersistedArtifactInput, PersistedAtomInput } from '../src/types';

type DbArtifactFixture = {
	classification?: string | null;
	type?: string;
	linkData?: PersistedArtifactInput['linkData'];
	data: NonNullable<PersistedArtifactInput['data']>;
};

type DbAtomFixture = {
	atomData: string;
	category?: string;
	schemaType?: string;
	targetUrl?: string;
	parseData?: Record<string, unknown>;
	artifacts: DbArtifactFixture[];
};

function dbArtifact(id: string, artifact: DbArtifactFixture): PersistedArtifactInput {
	return {
		id,
		type: artifact.type ?? 'json',
		classification: artifact.classification,
		linkData: artifact.linkData,
		data: artifact.data,
	};
}

function dbAtom(input: DbAtomFixture): PersistedAtomInput {
	return {
		data: input.atomData,
		classification_result:
			input.category || input.schemaType || input.targetUrl
				? {
						category: input.category,
						schemaType: input.schemaType,
						targetUrl: input.targetUrl,
					}
				: null,
		parse_result: input.parseData
			? {
					structuredDocument: {
						schemaType: input.schemaType,
						data: input.parseData,
					},
				}
			: null,
		artifacts: input.artifacts.map((artifact, index) =>
			dbArtifact(`artifact:${index + 1}`, artifact)
		),
	};
}

function withArtifacts(
	base: PersistedAtomInput,
	artifacts: DbArtifactFixture[]
): PersistedAtomInput {
	return {
		...base,
		artifacts: [
			...(base.artifacts ?? []),
			...artifacts.map((artifact, index) => dbArtifact(`artifact:extra:${index + 1}`, artifact)),
		],
	};
}

// DB-derived persisted fixtures, trimmed down to the fields the engine and schemas rely on.

const productListingArtifact = {
	classification: 'metadata',
	linkData: {
		artifactType: 'product-listing',
		pluginId: 'product-listing',
		provider: 'product-listing',
		sourceUrl: 'https://www.amazon.com/dp/B0C9TXYZ8G?_encoding=UTF8&psc=1',
	},
	data: {
		artifactType: 'product-listing',
		kind: 'classification-enrichment',
		data: {
			brand: 'PILOT',
			description: 'Visit the PILOT Store',
			imageUrl: 'https://m.media-amazon.com/images/I/61KQupUr51L.jpg',
			name: 'Pilot G2 Limited Premium Metal Gel Pen, Fine Point, 0.7 mm, Black Ink',
			rating: 4.6,
			reviewCount: 131,
			sku: 'B0C9TXYZ8G',
		},
		meta: {
			pluginId: 'product-listing',
			provider: 'product-listing',
			sourceUrl: 'https://www.amazon.com/dp/B0C9TXYZ8G?_encoding=UTF8&psc=1',
		},
		resolvedAtom: {
			canonicalId: 'asin:B0C9TXYZ8G',
			category: 'product',
			schemaType: 'Product',
			title: 'Pilot G2 Limited Premium Metal Gel Pen, Fine Point, 0.7 mm, Black Ink',
		},
	},
} satisfies DbArtifactFixture;

const xProfileArtifact = {
	classification: 'x-profile',
	linkData: {
		pluginId: 'x-profile',
	},
	data: {
		classification: 'x-profile',
		data: {
			bio: 'https://t.co/dDtDyVssfm',
			followers: 238162536,
			following: 1312,
			joinedAt: '2009-06-02T20:12:29.000Z',
			name: 'Elon Musk',
			profileBannerUrl: 'https://pbs.twimg.com/profile_banners/44196397/1774145451',
			profileImageUrl:
				'https://pbs.twimg.com/profile_images/2035314704307081216/71U1ftM3_normal.jpg',
			tweetCount: 101381,
			username: 'elonmusk',
			verified: false,
		},
		meta: {
			pluginId: 'x-profile',
			provider: 'x-profile',
			sourceUrl: 'https://x.com/elonmusk',
		},
	},
} satisfies DbArtifactFixture;

const youtubeArtifact = {
	classification: 'youtube',
	linkData: {
		pluginId: 'youtube',
	},
	data: {
		classification: 'youtube',
		data: {
			channelId: 'UCaMh8ii0gfI8UKAu1VqzYIA',
			channelTitle: 'Ekali',
			duration: 'PT59M28S',
			thumbnailUrl: 'https://i.ytimg.com/vi/qtSA95I2X30/hqdefault.jpg',
			title: 'Ekali - Awakening - Mix.1',
			videoId: 'qtSA95I2X30',
			viewCount: 19948,
		},
		meta: {
			pluginId: 'youtube',
			provider: 'youtube',
			sourceUrl: 'https://www.youtube.com/watch?v=qtSA95I2X30',
		},
	},
} satisfies DbArtifactFixture;

const spotifyArtifact = {
	classification: 'spotify',
	linkData: {
		pluginId: 'spotify',
	},
	data: {
		classification: 'spotify',
		data: {
			albumName: 'Plural',
			artists: [{ name: 'Electric Guest', spotifyId: '7sgWBYtJpblXpJl2lU5WVs' }],
			durationMs: 217586,
			imageUrl: 'https://i.scdn.co/image/ab67616d0000b273a06911645b978c17372c9158',
			isrc: 'USUM71614152',
			name: 'Oh Devil',
			releaseDate: '2017-02-17',
			spotifyId: '1kcfGBb6kSrGqNIMW7rAlB',
			spotifyUrl: 'https://open.spotify.com/track/1kcfGBb6kSrGqNIMW7rAlB',
			type: 'track',
		},
		meta: {
			pluginId: 'spotify',
			provider: 'spotify-web-api',
			sourceUrl: 'https://open.spotify.com/track/1kcfGBb6kSrGqNIMW7rAlB',
		},
	},
} satisfies DbArtifactFixture;

const spotifyShowArtifact = {
	classification: 'spotify',
	linkData: {
		pluginId: 'spotify',
	},
	data: {
		classification: 'spotify',
		data: {
			description: 'Deep dives from Spotify engineering teams.',
			imageUrl: 'https://i.scdn.co/image/show',
			languages: ['en'],
			name: 'Spotify Engineering Culture',
			publisher: 'Spotify',
			spotifyId: '38bS44xjbVVZ3No3ByF1dJ',
			spotifyUrl: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
			totalEpisodes: 42,
			type: 'show',
		},
		meta: {
			pluginId: 'spotify',
			provider: 'spotify-web-api',
			sourceUrl: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
		},
	},
} satisfies DbArtifactFixture;

const spotifyEpisodeArtifact = {
	classification: 'spotify',
	linkData: {
		pluginId: 'spotify',
	},
	data: {
		classification: 'spotify',
		data: {
			description: 'A conversation about reliable engineering systems.',
			durationMs: 1_812_000,
			imageUrl: 'https://i.scdn.co/image/episode',
			name: 'How We Build',
			previewUrl: 'https://p.scdn.co/episode-preview.mp3',
			releaseDate: '2026-05-01',
			showName: 'Spotify Engineering Culture',
			showSpotifyId: '38bS44xjbVVZ3No3ByF1dJ',
			showSpotifyUrl: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
			spotifyId: '4rOoJ6Egrf8K2IrywzwOMk',
			spotifyUrl: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
			type: 'episode',
		},
		meta: {
			pluginId: 'spotify',
			provider: 'spotify-web-api',
			sourceUrl: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
		},
	},
} satisfies DbArtifactFixture;

const githubRepoArtifact = {
	classification: 'github-repo',
	linkData: {
		pluginId: 'github',
	},
	data: {
		classification: 'github-repo',
		data: {
			createdAt: '2014-06-17T15:28:39Z',
			defaultBranch: 'main',
			description:
				'TypeScript is a superset of JavaScript that compiles to clean JavaScript output.',
			forks: 13322,
			fullName: 'microsoft/TypeScript',
			homepage: 'https://www.typescriptlang.org',
			language: 'TypeScript',
			license: 'Apache-2.0',
			name: 'TypeScript',
			openIssues: 5009,
			owner: 'microsoft',
			stars: 108394,
			updatedAt: '2026-04-03T17:41:40Z',
		},
		meta: {
			pluginId: 'github',
			provider: 'github',
			sourceUrl: 'https://github.com/microsoft/TypeScript',
		},
	},
} satisfies DbArtifactFixture;

const githubUserArtifact = {
	classification: 'github-user',
	linkData: {
		pluginId: 'github',
	},
	data: {
		classification: 'github-user',
		data: {
			avatarUrl: 'https://avatars.githubusercontent.com/u/94311139?v=4',
			blog: 'https://intuition.systems',
			followers: 329,
			following: 0,
			location: 'Chad',
			login: '0xIntuition',
			name: 'Intuition',
			publicRepos: 64,
		},
		meta: {
			pluginId: 'github',
			provider: 'github',
			sourceUrl: 'https://github.com/0xIntuition',
		},
	},
} satisfies DbArtifactFixture;

const npmPackageArtifact = {
	classification: 'npm-package',
	linkData: {
		pluginId: 'npm',
	},
	data: {
		classification: 'npm-package',
		data: {
			author: 'Microsoft Corp.',
			description: 'TypeScript is a language for application scale JavaScript development',
			homepage: 'https://www.typescriptlang.org/',
			keywords: ['TypeScript', 'Microsoft', 'compiler', 'language', 'javascript'],
			license: 'Apache-2.0',
			maintainers: ['microsoft1es', 'typescript-bot'],
			name: 'typescript',
			repository: 'git+https://github.com/microsoft/TypeScript.git',
			version: '6.0.2',
			weeklyDownloads: 172105529,
		},
		meta: {
			pluginId: 'npm',
			provider: 'npm',
			sourceUrl: 'https://www.npmjs.com/package/typescript',
		},
	},
} satisfies DbArtifactFixture;

const etherscanArtifact = {
	classification: 'etherscan',
	linkData: {
		pluginId: 'etherscan',
	},
	data: {
		classification: 'etherscan',
		data: {
			address: '0xb95ca3d3144e9d1daff0ee3d35a4488a4a5c9fc5',
			balance: '25757697633293547',
			balanceEth: '0.025757697633293547',
			isContract: false,
			transactionCount: 6,
		},
		meta: {
			pluginId: 'etherscan',
			provider: 'etherscan',
			sourceUrl: 'https://etherscan.io/address/0xb95ca3d3144e9d1daff0ee3d35a4488a4a5c9fc5',
		},
	},
} satisfies DbArtifactFixture;

const tokenMetadataArtifact = {
	classification: 'token-metadata',
	linkData: {
		pluginId: 'coingecko',
	},
	data: {
		classification: 'token-metadata',
		data: {
			address: '0xb95ca3d3144e9d1daff0ee3d35a4488a4a5c9fc5',
			coingeckoLookupEndpoint:
				'https://api.coingecko.com/api/v3/coins/ethereum/contract/0xb95ca3d3144e9d1daff0ee3d35a4488a4a5c9fc5',
			decimals: 18,
			lookupStatus: 'not_found',
			name: '0xb95ca3d3144e9d1daff0ee3d35a4488a4a5c9fc5',
			symbol: 'UNKNOWN',
			website: 'https://etherscan.io/address/0xb95ca3d3144e9d1daff0ee3d35a4488a4a5c9fc5',
		},
		meta: {
			pluginId: 'coingecko',
			provider: 'coingecko',
			sourceUrl:
				'https://api.coingecko.com/api/v3/coins/ethereum/contract/0xb95ca3d3144e9d1daff0ee3d35a4488a4a5c9fc5',
		},
	},
} satisfies DbArtifactFixture;

const wikipediaArtifact = {
	classification: 'wikipedia',
	linkData: {
		pluginId: 'wikipedia',
	},
	data: {
		classification: 'wikipedia',
		data: {
			extract:
				'TypeScript (TS) is a high-level programming language that adds static typing to JavaScript.',
			extractHtml:
				'<p><b>TypeScript</b> (<b>TS</b>) is a high-level programming language that adds static typing to JavaScript.</p>',
			language: 'en',
			lastModified: '2026-03-24T13:47:30Z',
			pageId: 8157205,
			pageUrl: 'https://en.wikipedia.org/wiki/TypeScript',
			thumbnailUrl:
				'https://upload.wikimedia.org/wikipedia/commons/thumb/f/f5/Typescript.svg/330px-Typescript.svg.png',
			title: 'TypeScript',
		},
		meta: {
			pluginId: 'wikipedia',
			provider: 'wikipedia',
			sourceUrl: 'https://en.wikipedia.org/wiki/TypeScript',
		},
	},
} satisfies DbArtifactFixture;

const brandArtifact = {
	classification: 'brand',
	linkData: {
		pluginId: 'brand',
	},
	data: {
		classification: 'brand',
		data: {
			brandId: 'idrVhdDocf',
			claimed: false,
			colors: [
				{ brightness: 255, hex: '#ffffff', type: 'brand' },
				{ brightness: 66, hex: '#EB1700', type: 'accent' },
			],
			description:
				'DoorDash (NASDAQ: DASH) is a technology company that connects consumers with their favorite local businesses.',
			domain: 'doordash.com',
			links: [{ name: 'linkedin', url: 'https://linkedin.com/company/doordash' }],
			logoUrl:
				'https://cdn.brandfetch.io/idrVhdDocf/theme/light/logo.svg?c=1bxasrmep7px71iwrye9qclquwbDC2S6hCu',
			name: 'DoorDash',
		},
		meta: {
			pluginId: 'brand',
			provider: 'brandfetch',
			sourceUrl: 'https://www.doordash.com',
		},
	},
} satisfies DbArtifactFixture;

const amazonProductAtom = dbAtom({
	atomData:
		'{"@context":"https://schema.org/","@type":"Product","name":"Pilot G2 Limited Premium Metal Gel Pen, Fine Point, 0.7 mm, Black Ink","url":"https://www.amazon.com/dp/B0C9TXYZ8G?_encoding=UTF8&psc=1","sameAs":["https://www.amazon.com/dp/B0C9TXYZ8G?_encoding=UTF8&psc=1"],"sku":"B0C9TXYZ8G","brand":"PILOT"}',
	category: 'product',
	schemaType: 'Product',
	targetUrl: 'https://www.amazon.com/dp/B0C9TXYZ8G?_encoding=UTF8&psc=1',
	parseData: {
		'@context': 'https://schema.org/',
		'@type': 'Product',
		brand: 'PILOT',
		name: 'Pilot G2 Limited Premium Metal Gel Pen, Fine Point, 0.7 mm, Black Ink',
		sameAs: ['https://www.amazon.com/dp/B0C9TXYZ8G?_encoding=UTF8&psc=1'],
		sku: 'B0C9TXYZ8G',
		url: 'https://www.amazon.com/dp/B0C9TXYZ8G?_encoding=UTF8&psc=1',
	},
	artifacts: [productListingArtifact],
});

const xProfileAtom = dbAtom({
	atomData:
		'{"@context":"https://schema.org/","@type":"SocialMediaAccount","name":"Elon Musk","username":"elonmusk","platform":"x","url":"https://x.com/elonmusk","sameAs":["https://x.com/elonmusk"],"image":"https://pbs.twimg.com/profile_images/2035314704307081216/71U1ftM3_normal.jpg"}',
	category: 'person',
	schemaType: 'SocialMediaAccount',
	targetUrl: 'https://x.com/elonmusk',
	parseData: {
		'@context': 'https://schema.org/',
		'@type': 'SocialMediaAccount',
		name: 'Elon Musk',
		platform: 'x',
		sameAs: ['https://x.com/elonmusk'],
		url: 'https://x.com/elonmusk',
		username: 'elonmusk',
	},
	artifacts: [xProfileArtifact],
});

const youtubeAtom = dbAtom({
	atomData:
		'{"@context":"https://schema.org/","@type":"VideoObject","name":"Ekali - Awakening - Mix.1","url":"https://www.youtube.com/watch?v=qtSA95I2X30","contentUrl":"https://www.youtube.com/watch?v=qtSA95I2X30","sameAs":["https://www.youtube.com/watch?v=qtSA95I2X30"],"thumbnailUrl":"https://i.ytimg.com/vi/qtSA95I2X30/hqdefault.jpg"}',
	category: 'thing',
	schemaType: 'VideoObject',
	targetUrl: 'https://www.youtube.com/watch?v=qtSA95I2X30',
	parseData: {
		'@context': 'https://schema.org/',
		'@type': 'VideoObject',
		contentUrl: 'https://www.youtube.com/watch?v=qtSA95I2X30',
		name: 'Ekali - Awakening - Mix.1',
		sameAs: ['https://www.youtube.com/watch?v=qtSA95I2X30'],
		thumbnailUrl: 'https://i.ytimg.com/vi/qtSA95I2X30/hqdefault.jpg',
		url: 'https://www.youtube.com/watch?v=qtSA95I2X30',
	},
	artifacts: [youtubeArtifact],
});

const spotifyTrackAtom = dbAtom({
	atomData:
		'{"@context":"https://schema.org/","@type":"MusicRecording","name":"Oh Devil","sameAs":["https://open.spotify.com/track/1kcfGBb6kSrGqNIMW7rAlB"]}',
	category: 'song',
	schemaType: 'MusicRecording',
	targetUrl: 'https://open.spotify.com/track/1kcfGBb6kSrGqNIMW7rAlB',
	parseData: {
		'@context': 'https://schema.org/',
		'@type': 'MusicRecording',
		name: 'Oh Devil',
		sameAs: ['https://open.spotify.com/track/1kcfGBb6kSrGqNIMW7rAlB'],
	},
	artifacts: [spotifyArtifact],
});

const spotifyOpenGraphTrackAtom = dbAtom({
	atomData:
		'{"@context":"https://schema.org/","@type":"MusicRecording","name":"Spotify Track 591GsK4rqja522IwAb6ZgG","sameAs":["https://open.spotify.com/track/591GsK4rqja522IwAb6ZgG"]}',
	category: 'song',
	schemaType: 'MusicRecording',
	targetUrl: 'https://open.spotify.com/track/591GsK4rqja522IwAb6ZgG',
	parseData: {
		'@context': 'https://schema.org/',
		'@type': 'MusicRecording',
		name: 'Spotify Track 591GsK4rqja522IwAb6ZgG',
		sameAs: ['https://open.spotify.com/track/591GsK4rqja522IwAb6ZgG'],
	},
	artifacts: [
		{
			classification: 'opengraph',
			linkData: {
				artifactType: 'opengraph',
				pluginId: 'opengraph',
				provider: 'website',
				sourceUrl: 'https://open.spotify.com/track/591GsK4rqja522IwAb6ZgG',
			},
			data: {
				artifactType: 'opengraph',
				classification: 'opengraph',
				data: {
					url: 'https://open.spotify.com/track/591GsK4rqja522IwAb6ZgG',
					type: 'music.song',
					audio: 'https://p.scdn.co/mp3-preview/example',
					image: 'https://i.scdn.co/image/example',
					title: 'Poppy',
					audioUrl: 'https://p.scdn.co/mp3-preview/example',
					siteName: 'Spotify',
					description: 'Mac Miller · K.I.D.S. (Deluxe) · Song · 2010',
				},
				meta: {
					pluginId: 'opengraph',
					provider: 'website',
					sourceUrl: 'https://open.spotify.com/track/591GsK4rqja522IwAb6ZgG',
				},
			},
		},
	],
});

const spotifyPodcastShowAtom = dbAtom({
	atomData:
		'{"@context":"https://schema.org/","@type":"PodcastSeries","name":"Spotify Engineering Culture","sameAs":["https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ"]}',
	category: 'thing',
	schemaType: 'PodcastSeries',
	targetUrl: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
	parseData: {
		'@context': 'https://schema.org/',
		'@type': 'PodcastSeries',
		name: 'Spotify Engineering Culture',
		sameAs: ['https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ'],
	},
	artifacts: [spotifyShowArtifact],
});

const spotifyPodcastEpisodeAtom = dbAtom({
	atomData:
		'{"@context":"https://schema.org/","@type":"PodcastEpisode","name":"How We Build","sameAs":["https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk"]}',
	category: 'thing',
	schemaType: 'PodcastEpisode',
	targetUrl: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
	parseData: {
		'@context': 'https://schema.org/',
		'@type': 'PodcastEpisode',
		name: 'How We Build',
		sameAs: ['https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk'],
	},
	artifacts: [spotifyEpisodeArtifact],
});

const typescriptAtomBase = {
	atomData:
		'{"@context":"https://schema.org/","@type":"SoftwareSourceCode","codeRepository":"https://github.com/microsoft/TypeScript","name":"typescript"}',
	category: 'software',
	schemaType: 'SoftwareSourceCode',
	targetUrl: 'https://github.com/microsoft/TypeScript',
	parseData: {
		'@context': 'https://schema.org/',
		'@type': 'SoftwareSourceCode',
		codeRepository: 'https://github.com/microsoft/TypeScript',
		name: 'typescript',
	},
} satisfies Omit<DbAtomFixture, 'artifacts'>;

const githubRepoAtom = dbAtom({
	...typescriptAtomBase,
	artifacts: [githubRepoArtifact],
});

const npmPackageAtom = dbAtom({
	...typescriptAtomBase,
	artifacts: [npmPackageArtifact],
});

const wikipediaAtom = dbAtom({
	...typescriptAtomBase,
	artifacts: [wikipediaArtifact],
});

const githubUserAtom = dbAtom({
	atomData:
		'{"@context":"https://schema.org/","@type":"Organization","name":"Intuition","url":"https://github.com/0xIntuition","sameAs":["https://github.com/0xIntuition","https://intuition.systems"],"image":"https://avatars.githubusercontent.com/u/94311139?v=4"}',
	category: 'company',
	schemaType: 'Organization',
	targetUrl: 'https://github.com/0xIntuition',
	parseData: {
		'@context': 'https://schema.org/',
		'@type': 'Organization',
		image: 'https://avatars.githubusercontent.com/u/94311139?v=4',
		name: 'Intuition',
		sameAs: ['https://github.com/0xIntuition', 'https://intuition.systems'],
		url: 'https://github.com/0xIntuition',
	},
	artifacts: [githubUserArtifact],
});

const ethereumAddressBase = {
	atomData: '0xb95ca3d3144e9d1daff0ee3d35a4488a4a5c9fc5',
	category: 'thing',
	schemaType: 'EthereumAccount',
	artifacts: [] as DbArtifactFixture[],
} satisfies DbAtomFixture;

const etherscanAtom = dbAtom({
	...ethereumAddressBase,
	artifacts: [etherscanArtifact],
});

const tokenMetadataAtom = dbAtom({
	...ethereumAddressBase,
	artifacts: [tokenMetadataArtifact],
});

const brandWebsiteAtom = dbAtom({
	atomData:
		'{"@context":"https://schema.org/","@type":"WebSite","name":"Website doordash.com","url":"https://www.doordash.com","sameAs":["https://www.doordash.com"]}',
	category: 'thing',
	schemaType: 'WebSite',
	targetUrl: 'https://www.doordash.com/',
	parseData: {
		'@context': 'https://schema.org/',
		'@type': 'WebSite',
		name: 'Website doordash.com',
		sameAs: ['https://www.doordash.com'],
		url: 'https://www.doordash.com',
	},
	artifacts: [brandArtifact],
});

describe('@0xintuition/atom-rules-engine', () => {
	describe('persisted DB fixtures by type', () => {
		it('[product-listing] resolves amazon-product even when the artifact_link classification is metadata', () => {
			const decision = resolveDecisionFromPersistedAtom(amazonProductAtom);

			expect(decision.variantId).toBe('amazon-product');
			expect(decision.context.artifacts[0]?.slug).toBe('product-listing');
			expect(decision.trace.selectedRuleId).toBe('amazon-product');
		});

		it('[x-profile] resolves x-profile from the persisted provider artifact', () => {
			const decision = resolveDecisionFromPersistedAtom(xProfileAtom);

			expect(decision.variantId).toBe('x-profile');
			expect(decision.trace.artifactSlugs).toEqual(['x-profile']);
		});

		it('[youtube] resolves youtube-video from the persisted provider artifact', () => {
			const decision = resolveDecisionFromPersistedAtom(youtubeAtom);

			expect(decision.variantId).toBe('youtube-video');
		});

		it('[spotify] resolves spotify-track and preserves the typed track payload', () => {
			const decision = resolveDecisionFromPersistedAtom(spotifyTrackAtom);

			expect(decision.variantId).toBe('spotify-track');
			expect(decision.context.artifacts[0]?.slug).toBe('spotify');
			if (decision.context.artifacts[0]?.slug !== 'spotify') {
				throw new Error('Expected spotify artifact');
			}
			expect(decision.context.artifacts[0].data.type).toBe('track');
		});

		it('[spotify] resolves spotify-track from Spotify OpenGraph when the typed spotify artifact is missing', () => {
			const decision = resolveDecisionFromPersistedAtom(spotifyOpenGraphTrackAtom);

			expect(decision.variantId).toBe('spotify-track');
			expect(decision.trace.artifactSlugs).toEqual(['opengraph']);
		});

		it('[spotify] resolves spotify-podcast-show from typed Spotify show payloads', () => {
			const decision = resolveDecisionFromPersistedAtom(spotifyPodcastShowAtom);

			expect(decision.variantId).toBe('spotify-podcast-show');
			expect(decision.context.artifacts[0]?.slug).toBe('spotify');
			if (decision.context.artifacts[0]?.slug !== 'spotify') {
				throw new Error('Expected spotify artifact');
			}
			expect(decision.context.artifacts[0].data.type).toBe('show');
		});

		it('[spotify] resolves spotify-podcast-episode from typed Spotify episode payloads', () => {
			const decision = resolveDecisionFromPersistedAtom(spotifyPodcastEpisodeAtom);

			expect(decision.variantId).toBe('spotify-podcast-episode');
			expect(decision.context.artifacts[0]?.slug).toBe('spotify');
			if (decision.context.artifacts[0]?.slug !== 'spotify') {
				throw new Error('Expected spotify artifact');
			}
			expect(decision.context.artifacts[0].data.type).toBe('episode');
		});

		it('[spotify] resolves podcast shows from Spotify identity when typed Spotify artifacts are missing', () => {
			const decision = resolveDecisionFromPersistedAtom(
				dbAtom({
					atomData:
						'{"@context":"https://schema.org/","@type":"PodcastSeries","name":"Spotify Engineering Culture","sameAs":["https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ"]}',
					category: 'thing',
					schemaType: 'PodcastSeries',
					targetUrl: 'spotify:show:38bS44xjbVVZ3No3ByF1dJ',
					parseData: {
						'@context': 'https://schema.org/',
						'@type': 'PodcastSeries',
						name: 'Spotify Engineering Culture',
						sameAs: ['https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ'],
					},
					artifacts: [
						{
							classification: 'opengraph',
							linkData: { pluginId: 'opengraph' },
							data: {
								artifactType: 'opengraph',
								classification: 'opengraph',
								data: {
									siteName: 'Spotify',
									title: 'Spotify Engineering Culture',
									url: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
								},
								meta: {
									pluginId: 'opengraph',
									provider: 'website',
									sourceUrl: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
								},
							},
						},
					],
				})
			);

			expect(decision.variantId).toBe('spotify-podcast-show');
			expect(decision.trace.artifactSlugs).toEqual(['opengraph']);
		});

		it('[spotify] resolves podcast episodes from Spotify identity when typed Spotify artifacts are missing', () => {
			const decision = resolveDecisionFromPersistedAtom(
				dbAtom({
					atomData:
						'{"@context":"https://schema.org/","@type":"PodcastEpisode","name":"How We Build","sameAs":["https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk"]}',
					category: 'thing',
					schemaType: 'PodcastEpisode',
					targetUrl: 'spotify:episode:4rOoJ6Egrf8K2IrywzwOMk',
					parseData: {
						'@context': 'https://schema.org/',
						'@type': 'PodcastEpisode',
						name: 'How We Build',
						sameAs: ['https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk'],
					},
					artifacts: [
						{
							classification: 'opengraph',
							linkData: { pluginId: 'opengraph' },
							data: {
								artifactType: 'opengraph',
								classification: 'opengraph',
								data: {
									siteName: 'Spotify',
									title: 'How We Build',
									url: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
								},
								meta: {
									pluginId: 'opengraph',
									provider: 'website',
									sourceUrl: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
								},
							},
						},
					],
				})
			);

			expect(decision.variantId).toBe('spotify-podcast-episode');
			expect(decision.trace.artifactSlugs).toEqual(['opengraph']);
		});

		it('[spotify] keeps all Spotify artifact subtypes routed to their current variants', () => {
			const cases = [
				['track', 'spotify-track'],
				['artist', 'spotify-artist'],
				['album', 'spotify-album'],
				['playlist', 'spotify-playlist'],
				['show', 'spotify-podcast-show'],
				['episode', 'spotify-podcast-episode'],
			] as const;

			for (const [type, variantId] of cases) {
				const decision = resolveDecisionFromPersistedAtom(
					dbAtom({
						atomData: `https://open.spotify.com/${type}/spotify-id`,
						artifacts: [
							{
								...spotifyArtifact,
								data: {
									...spotifyArtifact.data,
									data: {
										...spotifyArtifact.data.data,
										spotifyUrl: `https://open.spotify.com/${type}/spotify-id`,
										type,
									},
								},
							},
						],
					})
				);

				expect(decision.variantId).toBe(variantId);
			}
		});

		it('[github-repo] resolves github-repo from the persisted provider artifact', () => {
			const decision = resolveDecisionFromPersistedAtom(githubRepoAtom);

			expect(decision.variantId).toBe('github-repo');
		});

		it('[github-user] resolves github-profile from the persisted provider artifact', () => {
			const decision = resolveDecisionFromPersistedAtom(githubUserAtom);

			expect(decision.variantId).toBe('github-profile');
		});

		it('[npm-package] resolves npm-package when it is the only enrichment on the atom', () => {
			const decision = resolveDecisionFromPersistedAtom(npmPackageAtom);

			expect(decision.variantId).toBe('npm-package');
		});

		it('[wikipedia] resolves wikipedia-article when it is the only enrichment on the atom', () => {
			const decision = resolveDecisionFromPersistedAtom(wikipediaAtom);

			expect(decision.variantId).toBe('wikipedia-article');
		});

		it('[etherscan] resolves etherscan-contract from the persisted provider artifact', () => {
			const decision = resolveDecisionFromPersistedAtom(etherscanAtom);

			expect(decision.variantId).toBe('etherscan-contract');
		});

		it('[token-metadata] resolves coingecko-token when it is the only enrichment on the atom', () => {
			const decision = resolveDecisionFromPersistedAtom(tokenMetadataAtom);

			expect(decision.variantId).toBe('coingecko-token');
		});

		it('[brand + website classification] resolves website while still matching the brand rule', () => {
			const decision = resolveDecisionFromPersistedAtom(brandWebsiteAtom);

			expect(decision.variantId).toBe('website');
			expect(
				decision.trace.evaluations.find((evaluation) => evaluation.ruleId === 'brand-company')
					?.matched
			).toBe(true);
		});
	});

	describe('persisted DB fixture precedence', () => {
		it('[github-repo > npm-package > wikipedia] prefers the repo card for the TypeScript atom', () => {
			const decision = resolveDecisionFromPersistedAtom(
				withArtifacts(githubRepoAtom, [npmPackageArtifact, wikipediaArtifact])
			);

			expect(decision.variantId).toBe('github-repo');
			expect(decision.trace.artifactSlugs).toEqual(['github-repo', 'npm-package', 'wikipedia']);
		});

		it('[etherscan > token-metadata] prefers the address card when both enrichments exist', () => {
			const decision = resolveDecisionFromPersistedAtom(
				withArtifacts(etherscanAtom, [tokenMetadataArtifact])
			);

			expect(decision.variantId).toBe('etherscan-contract');
			expect(
				decision.trace.evaluations.find((evaluation) => evaluation.ruleId === 'coingecko-token')
					?.matched
			).toBe(true);
		});
	});

	describe('create flow payloads', () => {
		it('[github-repo] keeps the create-flow preview on the repo card', () => {
			const decision = resolveDecisionFromProcessPayload({
				rawInput: 'https://github.com/openai/codex',
				processPayload: {
					classification: {
						resolved: {
							atoms: [
								{
									category: 'software',
									schemaType: 'SoftwareSourceCode',
									title: 'openai/codex',
									canonicalId: 'https://github.com/openai/codex',
									sameAs: ['https://github.com/openai/codex'],
									data: {},
								},
							],
						},
					},
					enrichment: {
						artifacts: [
							{
								artifact_type: 'github-repo',
								data: {
									owner: 'openai',
									name: 'codex',
									fullName: 'openai/codex',
									homepage: 'https://github.com/openai/codex',
								},
								meta: {
									pluginId: 'github',
									provider: 'github',
									sourceUrl: 'https://github.com/openai/codex',
								},
							},
						],
					},
				},
			});

			expect(decision.variantId).toBe('github-repo');
			expect(decision.trace.artifactSlugs).toContain('github-repo');
		});

		it('[spotify] keeps the create-flow preview on the typed spotify card', () => {
			const context = buildDecisionContextFromProcessPayload({
				rawInput: 'https://open.spotify.com/track/abc',
				processPayload: {
					classification: {
						resolved: {
							atoms: [
								{
									category: 'song',
									schemaType: 'MusicRecording',
									title: 'Midnight City',
									canonicalId: 'spotify:track:abc',
									sameAs: ['https://open.spotify.com/track/abc'],
									data: {},
								},
							],
						},
					},
					enrichment: {
						artifacts: [
							{
								artifact_type: 'spotify',
								data: {
									type: 'track',
									name: 'Midnight City',
									spotifyId: 'abc',
									spotifyUrl: 'https://open.spotify.com/track/abc',
									artists: [{ name: 'M83', spotifyId: 'm83' }],
								},
								meta: {
									pluginId: 'spotify',
									provider: 'spotify',
									sourceUrl: 'https://open.spotify.com/track/abc',
								},
							},
						],
					},
				},
			});

			expect(context.artifacts[0]?.slug).toBe('spotify');
			if (context.artifacts[0]?.slug !== 'spotify') {
				throw new Error('Expected spotify artifact');
			}
			expect(context.artifacts[0].data.type).toBe('track');
		});

		it('[spotify] routes create-flow podcast show payloads to spotify-podcast-show', () => {
			const decision = resolveDecisionFromProcessPayload({
				rawInput: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
				processPayload: {
					classification: {
						resolved: {
							atoms: [
								{
									category: 'thing',
									schemaType: 'PodcastSeries',
									title: 'Spotify Engineering Culture',
									canonicalId: 'spotify:show:38bS44xjbVVZ3No3ByF1dJ',
									sameAs: ['https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ'],
									data: {},
								},
							],
						},
					},
					enrichment: {
						artifacts: [
							{
								artifact_type: 'spotify',
								data: {
									type: 'show',
									name: 'Spotify Engineering Culture',
									spotifyId: '38bS44xjbVVZ3No3ByF1dJ',
									spotifyUrl: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
									publisher: 'Spotify',
								},
								meta: {
									pluginId: 'spotify',
									provider: 'spotify',
									sourceUrl: 'https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ',
								},
							},
						],
					},
				},
			});

			expect(decision.variantId).toBe('spotify-podcast-show');
			expect(decision.trace.artifactSlugs).toContain('spotify');
		});

		it('[spotify] routes create-flow podcast episode payloads to spotify-podcast-episode', () => {
			const decision = resolveDecisionFromProcessPayload({
				rawInput: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
				processPayload: {
					classification: {
						resolved: {
							atoms: [
								{
									category: 'thing',
									schemaType: 'PodcastEpisode',
									title: 'How We Build',
									canonicalId: 'spotify:episode:4rOoJ6Egrf8K2IrywzwOMk',
									sameAs: ['https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk'],
									data: {},
								},
							],
						},
					},
					enrichment: {
						artifacts: [
							{
								artifact_type: 'spotify',
								data: {
									type: 'episode',
									name: 'How We Build',
									spotifyId: '4rOoJ6Egrf8K2IrywzwOMk',
									spotifyUrl: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
									showName: 'Spotify Engineering Culture',
								},
								meta: {
									pluginId: 'spotify',
									provider: 'spotify',
									sourceUrl: 'https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk',
								},
							},
						],
					},
				},
			});

			expect(decision.variantId).toBe('spotify-podcast-episode');
			expect(decision.trace.artifactSlugs).toContain('spotify');
		});

		it('selects the catalog primary artifact from the winning create-flow decision', () => {
			const decision = resolveDecisionFromProcessPayload({
				rawInput: 'https://x.com/0xIntuition',
				processPayload: {
					classification: {
						resolved: {
							atoms: [
								{
									category: 'person',
									schemaType: 'SocialMediaAccount',
									title: 'Intuition',
									canonicalId: 'x:user:0xintuition',
									sameAs: ['https://x.com/0xIntuition'],
									data: {},
								},
							],
						},
					},
					enrichment: {
						artifacts: [
							{
								artifact_type: 'opengraph',
								data: {
									title: 'Intuition on X',
									url: 'https://x.com/0xIntuition',
								},
								meta: {
									pluginId: 'opengraph',
									provider: 'opengraph',
									sourceUrl: 'https://x.com/0xIntuition',
								},
							},
							{
								artifact_type: 'x-profile',
								data: {
									username: '0xIntuition',
									name: 'Intuition',
								},
								meta: {
									pluginId: 'x-profile',
									provider: 'x-profile',
									sourceUrl: 'https://x.com/0xIntuition',
								},
							},
						],
					},
				},
			});

			expect(decision.variantId).toBe('x-profile');
			expect(selectPrimaryArtifactForDecision(decision)?.slug).toBe('x-profile');
		});
	});
});
