import { z } from 'zod/v4';

export const classificationCategorySchema = z.enum([
	'web-metadata',
	'brand-identity',
	'knowledge',
	'location',
	'music',
	'video',
	'social',
	'financial',
	'academic',
	'blockchain',
	'image',
	'product',
	'ai',
]);

export const classificationSlugSchema = z
	.string()
	.min(2)
	.max(40)
	.regex(
		/^[a-z][a-z0-9-]{0,38}[a-z0-9]$/,
		'Classification slug must be lowercase alphanumeric with hyphens, 2-40 chars'
	);

export type ClassificationCategory = z.infer<typeof classificationCategorySchema>;

export {
	type AiEntitiesData,
	aiEntitiesDataSchema,
} from '../plugins/providers/ai-entities/schema';
export {
	type AiSummaryData,
	aiSummaryDataSchema,
} from '../plugins/providers/ai-summary/schema';
export {
	type AppleMusicData,
	appleMusicDataSchema,
} from '../plugins/providers/apple-music/schema';
export { type ArxivData, arxivDataSchema } from '../plugins/providers/arxiv/schema';
export { type BrandData, brandDataSchema } from '../plugins/providers/brand/schema';
export {
	type TokenMetadataData,
	tokenMetadataDataSchema,
} from '../plugins/providers/coingecko/schema';
export {
	type ColorPaletteData,
	colorPaletteDataSchema,
} from '../plugins/providers/color-palette/schema';
export {
	type CompanyProfileData,
	companyProfileDataSchema,
} from '../plugins/providers/company-profile/schema';
export { type DoiData, doiDataSchema } from '../plugins/providers/crossref/schema';
export {
	type CrunchbaseData,
	crunchbaseDataSchema,
} from '../plugins/providers/crunchbase/schema';
export {
	type DictionaryData,
	dictionaryDataSchema,
} from '../plugins/providers/dictionary/schema';
export { type EnsData, ensDataSchema } from '../plugins/providers/ens/schema';
export {
	type EtherscanData,
	etherscanDataSchema,
} from '../plugins/providers/etherscan/schema';
export { type FaviconData, faviconDataSchema } from '../plugins/providers/favicon/schema';
export {
	type GeocodeData,
	geocodeDataSchema,
} from '../plugins/providers/geocode/schema';
export {
	type GitHubRepoData,
	type GitHubUserData,
	githubRepoDataSchema,
	githubUserDataSchema,
} from '../plugins/providers/github/schema';
export { type IsbnData, isbnDataSchema } from '../plugins/providers/isbn/schema';
export {
	type MicrodataData,
	microdataDataSchema,
} from '../plugins/providers/microdata/schema';
export {
	type MusicBrainzData,
	musicbrainzDataSchema,
} from '../plugins/providers/musicbrainz/schema';
export {
	type NftMetadataData,
	nftMetadataDataSchema,
} from '../plugins/providers/nft-metadata/schema';
export { type NpmPackageData, npmPackageDataSchema } from '../plugins/providers/npm/schema';
export { type OEmbedData, oembedDataSchema } from '../plugins/providers/oembed/schema';
export {
	type OpenGraphData,
	opengraphDataSchema,
} from '../plugins/providers/opengraph/schema';
export { type PlacesData, placesDataSchema } from '../plugins/providers/places/schema';
export {
	type ProductListingData,
	productListingDataSchema,
} from '../plugins/providers/product-listing/schema';
export { type PubmedData, pubmedDataSchema } from '../plugins/providers/pubmed/schema';
export {
	type RedditPostData,
	redditPostDataSchema,
} from '../plugins/providers/reddit-post/schema';
export {
	type ScreenshotData,
	screenshotDataSchema,
} from '../plugins/providers/screenshot/schema';
export { type SpotifyData, spotifyDataSchema } from '../plugins/providers/spotify/schema';
export { type TmdbData, tmdbDataSchema } from '../plugins/providers/tmdb/schema';
export { type VimeoData, vimeoDataSchema } from '../plugins/providers/vimeo/schema';
export { type WikidataData, wikidataDataSchema } from '../plugins/providers/wikidata/schema';
export { type WikipediaData, wikipediaDataSchema } from '../plugins/providers/wikipedia/schema';
export { type XProfileData, xProfileDataSchema } from '../plugins/providers/x-profile/schema';
export { type YouTubeData, youtubeDataSchema } from '../plugins/providers/youtube/schema';
