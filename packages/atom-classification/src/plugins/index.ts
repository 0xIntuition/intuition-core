import { amazonProfile } from './amazon';
import { ethereumProfile } from './etherscan';
import { githubProfile } from './github';
import { imdbProfile } from './imdb';
import { instagramProfile } from './instagram';
import { isbnProfile } from './isbn';
import { lexicalProfile } from './lexical';
import { npmProfile } from './npm';
import { plainTextProfile } from './plain-text';
import type { NonUrlV0Profile } from './shared/non-url';
import type { PlatformV0Profile } from './shared/platform';
import { spotifyProfile } from './spotify';
import { tiktokProfile } from './tiktok';
import { tmdbProfile } from './tmdb';
import { wikipediaProfile } from './wikipedia';
import { xProfile } from './x';
import { youtubeProfile } from './youtube';

export type { AmazonPluginOptions } from './amazon';
export { createAmazonPlugin } from './amazon';
export type { AmazonCanopyPluginOptionsInput } from './amazon/canopy';
export { createAmazonCanopyPluginOptions } from './amazon/canopy';
export type {
	AmazonDomainApiAdapter,
	AmazonDomainApiAdapterOptions,
} from './amazon/domain-api-adapter';
export { createAmazonDomainApiAdapter } from './amazon/domain-api-adapter';
export type {
	AmazonDomainHtmlAdapter,
	AmazonDomainHtmlAdapterOptions,
} from './amazon/domain-html-adapter';
export { createAmazonDomainHtmlAdapter } from './amazon/domain-html-adapter';
export { createDefaultUrlPlugin } from './default-url';
export type { EtherscanPluginOptions } from './etherscan';
export { createEthereumPlugin, createEtherscanPlugin } from './etherscan';
export type { GitHubPluginOptions } from './github';
export { createGitHubPlugin } from './github';
export type {
	GitHubDomainApiAdapter,
	GitHubDomainApiAdapterOptions,
} from './github/domain-api-adapter';
export { createGitHubDomainApiAdapter } from './github/domain-api-adapter';
export type { ImdbPluginOptions } from './imdb';
export { createImdbPlugin } from './imdb';
export type {
	ImdbDomainHtmlAdapter,
	ImdbDomainHtmlAdapterOptions,
} from './imdb/domain-html-adapter';
export { createImdbDomainHtmlAdapter } from './imdb/domain-html-adapter';
export type { InstagramPluginOptions } from './instagram';
export { createInstagramPlugin } from './instagram';
export { createIsbnPlugin } from './isbn';
export { createLexicalPlugin } from './lexical';
export type { NpmPluginOptions } from './npm';
export { createNpmPlugin } from './npm';
export { createPlainTextPlugin } from './plain-text';
export type { NonUrlV0Profile } from './shared/non-url';
export type {
	OpenGraphMetadata,
	OpenGraphPlatformAdapter,
	OpenGraphPlatformAdapterInput,
	OpenGraphPlatformAdapterOptions,
} from './shared/opengraph';
export { createOpenGraphPlatformAdapter } from './shared/opengraph';
export type { PlatformDomain, PlatformV0PluginOptions, PlatformV0Profile } from './shared/platform';
export type {
	PublicMetadataPlatformAdapter,
	PublicMetadataPlatformAdapterOptions,
	PublicMetadataSource,
	PublicMetadataSourceResult,
} from './shared/public-metadata';
export { createPublicMetadataPlatformAdapter } from './shared/public-metadata';
export type {
	SpotifyDomainApiAdapter,
	SpotifyDomainApiAdapterOptions,
	SpotifyPluginOptions,
} from './spotify';
export { createSpotifyDomainApiAdapter, createSpotifyPlugin } from './spotify';
export type { TikTokPluginOptions } from './tiktok';
export { createTikTokPlugin } from './tiktok';
export type { TmdbPluginOptions } from './tmdb';
export { createTmdbPlugin } from './tmdb';
export { createTypeProfilesPlugin, createV0TypeProfilesPlugin } from './type-profiles';
export type { WikipediaPluginOptions } from './wikipedia';
export { createWikipediaPlugin } from './wikipedia';
export type {
	XDomainApiAdapter,
	XDomainApiAdapterOptions,
	XEnrichmentAdapter,
	XEnrichmentAdapterInput,
	XEnrichmentPayload,
	XOpenGraphAdapter,
	XOpenGraphAdapterOptions,
	XPluginOptions,
	XPublicMetadataAdapter,
	XPublicMetadataAdapterOptions,
	XResolutionMode,
} from './x';
export { createXPlugin } from './x';
export { createXDomainApiAdapter } from './x/domain-api-adapter';
export { createXOpenGraphAdapter } from './x/opengraph-adapter';
export { createXPublicMetadataAdapter } from './x/public-metadata-adapter';
export type { YouTubePluginOptions } from './youtube';
export { createYouTubePlugin } from './youtube';
export type { YouTubeOEmbedAdapter, YouTubeOEmbedAdapterOptions } from './youtube/oembed-adapter';
export { createYouTubeOEmbedAdapter } from './youtube/oembed-adapter';

export function createPlatformV0Profiles(): PlatformV0Profile[] {
	return [
		spotifyProfile,
		amazonProfile,
		githubProfile,
		npmProfile,
		xProfile,
		instagramProfile,
		tiktokProfile,
		youtubeProfile,
		wikipediaProfile,
		imdbProfile,
		tmdbProfile,
	];
}

export function createNonUrlV0Profiles(): NonUrlV0Profile[] {
	return [ethereumProfile, isbnProfile, lexicalProfile, plainTextProfile];
}
