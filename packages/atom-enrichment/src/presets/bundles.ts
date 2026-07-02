import type { EnrichmentPlugin } from '../plugins';
import {
	createAppleMusicPlugin,
	createBrandPlugin,
	createCoinGeckoPlugin,
	createCrossrefPlugin,
	createEtherscanPlugin,
	createFaviconPlugin,
	createGitHubPlugin,
	createMicrodataPlugin,
	createMusicBrainzPlugin,
	createNpmPlugin,
	createOEmbedPlugin,
	createOpenGraphPlugin,
	createPlacesPlugin,
	createPodcastIndexPlugin,
	createProductListingPlugin,
	createSpotifyPlugin,
	createTmdbPlugin,
	createWikidataPlugin,
	createWikipediaPlugin,
	createXProfilePlugin,
	createYouTubePlugin,
} from '../plugins/providers';

export type EnrichmentPreset = EnrichmentPlugin[];

type AppleMusicPluginOptions = NonNullable<Parameters<typeof createAppleMusicPlugin>[0]>;
type OpenGraphPluginOptions = NonNullable<Parameters<typeof createOpenGraphPlugin>[0]>;
type PlacesPluginOptions = NonNullable<Parameters<typeof createPlacesPlugin>[0]>;
type PodcastIndexPluginOptions = NonNullable<Parameters<typeof createPodcastIndexPlugin>[0]>;
type BrandPluginOptions = NonNullable<Parameters<typeof createBrandPlugin>[0]>;
type FaviconPluginOptions = NonNullable<Parameters<typeof createFaviconPlugin>[0]>;
type GitHubPluginOptions = NonNullable<Parameters<typeof createGitHubPlugin>[0]>;
type MicrodataPluginOptions = NonNullable<Parameters<typeof createMicrodataPlugin>[0]>;
type MusicBrainzPluginOptions = NonNullable<Parameters<typeof createMusicBrainzPlugin>[0]>;
type OEmbedPluginOptions = NonNullable<Parameters<typeof createOEmbedPlugin>[0]>;
type ProductListingPluginOptions = NonNullable<Parameters<typeof createProductListingPlugin>[0]>;
type SpotifyPluginOptions = NonNullable<Parameters<typeof createSpotifyPlugin>[0]>;
type TmdbPluginOptions = NonNullable<Parameters<typeof createTmdbPlugin>[0]>;
type XProfilePluginOptions = NonNullable<Parameters<typeof createXProfilePlugin>[0]>;
type WikidataPluginOptions = NonNullable<Parameters<typeof createWikidataPlugin>[0]>;
type EtherscanPluginOptions = NonNullable<Parameters<typeof createEtherscanPlugin>[0]>;
type CoinGeckoPluginOptions = NonNullable<Parameters<typeof createCoinGeckoPlugin>[0]>;
type CrossrefPluginOptions = NonNullable<Parameters<typeof createCrossrefPlugin>[0]>;
type WikipediaPluginOptions = NonNullable<Parameters<typeof createWikipediaPlugin>[0]>;
type YouTubePluginOptions = NonNullable<Parameters<typeof createYouTubePlugin>[0]>;

export type CompanyPresetOptions = {
	opengraph?: OpenGraphPluginOptions;
	brand?: BrandPluginOptions;
	favicon?: FaviconPluginOptions;
};

export type MusicPresetOptions = {
	opengraph?: OpenGraphPluginOptions;
	spotify?: SpotifyPluginOptions;
	musicbrainz?: MusicBrainzPluginOptions;
	appleMusic?: AppleMusicPluginOptions;
};

export type CryptoPresetOptions = {
	etherscan?: EtherscanPluginOptions;
	coingecko?: CoinGeckoPluginOptions;
};

export type AcademicPresetOptions = {
	crossref?: CrossrefPluginOptions;
	wikipedia?: WikipediaPluginOptions;
};

export type ServerDefaultPresetOptions = {
	appleMusic?: AppleMusicPluginOptions;
	brand?: BrandPluginOptions;
	coingecko?: CoinGeckoPluginOptions;
	crossref?: CrossrefPluginOptions;
	etherscan?: EtherscanPluginOptions;
	favicon?: FaviconPluginOptions;
	github?: GitHubPluginOptions;
	microdata?: MicrodataPluginOptions;
	musicbrainz?: MusicBrainzPluginOptions;
	oembed?: OEmbedPluginOptions;
	opengraph?: OpenGraphPluginOptions;
	places?: PlacesPluginOptions;
	podcastIndex?: PodcastIndexPluginOptions;
	productListing?: ProductListingPluginOptions;
	spotify?: SpotifyPluginOptions;
	tmdb?: TmdbPluginOptions;
	xProfile?: XProfilePluginOptions;
	wikidata?: WikidataPluginOptions;
	wikipedia?: WikipediaPluginOptions;
	youtube?: YouTubePluginOptions;
};

export type ServerDefaultPresetEnvironment = Record<string, string | undefined>;

export function createServerDefaultPresetOptions(
	env: ServerDefaultPresetEnvironment
): ServerDefaultPresetOptions {
	return {
		appleMusic: {},
		brand: {
			apiKey: env.BRANDFETCH_API_KEY,
		},
		coingecko: {
			apiKey: env.COINGECKO_API_KEY,
		},
		crossref: {},
		etherscan: {
			apiKey: env.ETHERSCAN_API_KEY,
		},
		favicon: {},
		github: {
			token: env.GITHUB_TOKEN,
		},
		microdata: {},
		musicbrainz: {},
		oembed: {},
		opengraph: {},
		places: {
			apiKey: env.GOOGLE_PLACES_API_KEY,
		},
		podcastIndex: {
			apiKey: env.PODCAST_INDEX_API_KEY,
			apiSecret: env.PODCAST_INDEX_API_SECRET,
		},
		productListing: {
			apiKey: env.CANOPY_API_KEY,
		},
		spotify: {
			clientId: env.SPOTIFY_CLIENT_ID,
			clientSecret: env.SPOTIFY_CLIENT_SECRET,
			market: env.SPOTIFY_MARKET,
		},
		tmdb: {
			apiKey: env.TMDB_API_KEY,
		},
		xProfile: {
			token: env.X_BEARER_TOKEN,
		},
		wikidata: {},
		wikipedia: {},
		youtube: {
			apiKey: env.YOUTUBE_API_KEY,
		},
	};
}

export function companyPreset(options: CompanyPresetOptions = {}): EnrichmentPreset {
	return [
		createOpenGraphPlugin(options.opengraph),
		createBrandPlugin(options.brand),
		createFaviconPlugin(options.favicon),
	];
}

export function musicPreset(options: MusicPresetOptions = {}): EnrichmentPreset {
	return [
		createOpenGraphPlugin(options.opengraph),
		createSpotifyPlugin(options.spotify),
		createMusicBrainzPlugin(options.musicbrainz),
		createAppleMusicPlugin(options.appleMusic),
	];
}

export function cryptoPreset(options: CryptoPresetOptions = {}): EnrichmentPreset {
	return [createEtherscanPlugin(options.etherscan), createCoinGeckoPlugin(options.coingecko)];
}

export function academicPreset(options: AcademicPresetOptions = {}): EnrichmentPreset {
	return [createCrossrefPlugin(options.crossref), createWikipediaPlugin(options.wikipedia)];
}

export function serverDefaultPreset(options: ServerDefaultPresetOptions = {}): EnrichmentPreset {
	return [
		createOpenGraphPlugin(options.opengraph),
		createMicrodataPlugin(options.microdata),
		createOEmbedPlugin(options.oembed),
		createWikipediaPlugin(options.wikipedia),
		createWikidataPlugin(options.wikidata),
		createGitHubPlugin(options.github),
		createProductListingPlugin(options.productListing),
		createXProfilePlugin(options.xProfile),
		createNpmPlugin(),
		createSpotifyPlugin(options.spotify),
		createAppleMusicPlugin(options.appleMusic),
		createMusicBrainzPlugin(options.musicbrainz),
		createTmdbPlugin(options.tmdb),
		createPlacesPlugin(options.places),
		createPodcastIndexPlugin(options.podcastIndex),
		createYouTubePlugin(options.youtube),
		createBrandPlugin(options.brand),
		createFaviconPlugin(options.favicon),
		createCoinGeckoPlugin(options.coingecko),
		createEtherscanPlugin(options.etherscan),
		createCrossrefPlugin(options.crossref),
	];
}
