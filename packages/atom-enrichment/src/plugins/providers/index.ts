export type { FetchLike } from './__shared__';

export { createAppleMusicPlugin, parseAppleMusicUrl } from './apple-music';
export { createBrandPlugin } from './brand';
export { createCoinGeckoPlugin } from './coingecko';
export { createCrossrefPlugin } from './crossref';
export { createEtherscanPlugin } from './etherscan';
export { createFaviconPlugin } from './favicon';
export { createGitHubPlugin } from './github';
export { createMicrodataPlugin, flattenJsonLdNodes, parseJsonLdBlocks } from './microdata';
export { createMusicBrainzPlugin } from './musicbrainz';
export { createNpmPlugin } from './npm';
export { createOEmbedPlugin } from './oembed';
export { createOpenGraphPlugin } from './opengraph';
export { createPlacesPlugin, parseMapsUrl } from './places';
export {
	createPodcastIndexPlugin,
	parsePodcastIndexUrl,
	resolvePodcastIndexTarget,
} from './podcast-index';
export { createProductListingPlugin } from './product-listing';
export { createSpotifyPlugin } from './spotify';
export { createTmdbPlugin } from './tmdb';
export { createWikidataPlugin } from './wikidata';
export { createWikipediaPlugin } from './wikipedia';
export { createXProfilePlugin } from './x-profile';
export { createYouTubePlugin } from './youtube';
