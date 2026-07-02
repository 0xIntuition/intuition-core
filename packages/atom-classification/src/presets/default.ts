import type { AtomClassificationPlugin } from '../plugins';
import {
	createAmazonPlugin,
	createDefaultUrlPlugin,
	createEtherscanPlugin,
	createGitHubPlugin,
	createImdbPlugin,
	createInstagramPlugin,
	createIsbnPlugin,
	createNpmPlugin,
	createPlainTextPlugin,
	createSpotifyPlugin,
	createTikTokPlugin,
	createTmdbPlugin,
	createTypeProfilesPlugin,
	createWikipediaPlugin,
	createXPlugin,
	createYouTubePlugin,
	type EtherscanPluginOptions,
	type GitHubPluginOptions,
	type NpmPluginOptions,
	type SpotifyPluginOptions,
	type XPluginOptions,
} from '../plugins/index';
import type { PlatformV0PluginOptions } from '../plugins/shared/platform';
import type { YouTubePluginOptions } from '../plugins/youtube';

type PlatformStageAdapters = NonNullable<PlatformV0PluginOptions['adapters']>;
type SharedPlatformAdapters = Pick<PlatformStageAdapters, 'oEmbed' | 'openGraph'>;

export type DefaultClassificationPresetPlatformOptions = Omit<
	PlatformV0PluginOptions,
	'adapters'
> & {
	adapters?: Partial<SharedPlatformAdapters>;
};

export type DefaultClassificationPresetOptions = {
	amazonPluginOptions?: PlatformV0PluginOptions;
	etherscanPluginOptions?: EtherscanPluginOptions;
	githubPluginOptions?: GitHubPluginOptions;
	imdbPluginOptions?: PlatformV0PluginOptions;
	instagramPluginOptions?: PlatformV0PluginOptions;
	npmPluginOptions?: NpmPluginOptions;
	platformV0PluginOptions?: DefaultClassificationPresetPlatformOptions;
	spotifyPluginOptions?: SpotifyPluginOptions;
	tiktokPluginOptions?: PlatformV0PluginOptions;
	tmdbPluginOptions?: PlatformV0PluginOptions;
	wikipediaPluginOptions?: PlatformV0PluginOptions;
	xPluginOptions?: XPluginOptions;
	youtubePluginOptions?: YouTubePluginOptions;
	includeDefaultUrlPlugin?: boolean;
};

export function defaultClassificationPreset(
	options: DefaultClassificationPresetOptions = {}
): AtomClassificationPlugin[] {
	const sharedPlatformOptions = normalizeSharedPlatformOptions(options.platformV0PluginOptions);
	const youtubePluginOptions = mergeYouTubePluginOptions(
		sharedPlatformOptions,
		options.youtubePluginOptions
	);
	const githubPluginOptions = mergeGitHubPluginOptions(
		sharedPlatformOptions,
		options.githubPluginOptions
	);
	const spotifyPluginOptions = mergeSpotifyPluginOptions(
		sharedPlatformOptions,
		options.spotifyPluginOptions
	);
	const npmPluginOptions = mergePlatformPluginOptions(
		sharedPlatformOptions,
		options.npmPluginOptions
	);
	const amazonPluginOptions = mergePlatformPluginOptions(
		sharedPlatformOptions,
		options.amazonPluginOptions
	);
	const xPluginOptions = mergeXPluginOptions(sharedPlatformOptions, options.xPluginOptions);
	const instagramPluginOptions = mergePlatformPluginOptions(
		sharedPlatformOptions,
		options.instagramPluginOptions
	);
	const tiktokPluginOptions = mergePlatformPluginOptions(
		sharedPlatformOptions,
		options.tiktokPluginOptions
	);
	const wikipediaPluginOptions = mergePlatformPluginOptions(
		sharedPlatformOptions,
		options.wikipediaPluginOptions
	);
	const imdbPluginOptions = mergePlatformPluginOptions(
		sharedPlatformOptions,
		options.imdbPluginOptions
	);
	const tmdbPluginOptions = mergePlatformPluginOptions(
		sharedPlatformOptions,
		options.tmdbPluginOptions
	);

	const plugins: AtomClassificationPlugin[] = [
		createTypeProfilesPlugin(),
		createEtherscanPlugin(options.etherscanPluginOptions),
		createIsbnPlugin(),
		// Keep lexical available as an explicit plugin, but do not include it in the
		// default preset. Generic non-URL text should resolve through plain-text
		// fallback unless a caller opts into lexical classification deliberately.
		createPlainTextPlugin(),
		createSpotifyPlugin(spotifyPluginOptions),
		createAmazonPlugin(amazonPluginOptions),
		createGitHubPlugin(githubPluginOptions),
		createNpmPlugin(npmPluginOptions),
		createXPlugin(xPluginOptions),
		createInstagramPlugin(instagramPluginOptions),
		createTikTokPlugin(tiktokPluginOptions),
		createYouTubePlugin(youtubePluginOptions),
		createWikipediaPlugin(wikipediaPluginOptions),
		createImdbPlugin(imdbPluginOptions),
		createTmdbPlugin(tmdbPluginOptions),
	];

	if (options.includeDefaultUrlPlugin !== false) {
		plugins.push(createDefaultUrlPlugin());
	}

	return plugins;
}

// Only cross-domain fallback stages should be inherited from the preset layer.
// Domain-aware stages like `domainApi` or `domainHtml` must stay plugin-scoped so
// one plugin cannot accidentally override another plugin's resolver behavior.
function normalizeSharedPlatformOptions(
	options: DefaultClassificationPresetPlatformOptions | undefined
): PlatformV0PluginOptions | undefined {
	if (!options) {
		return undefined;
	}

	const adapters: PlatformV0PluginOptions['adapters'] = {};
	if (options.adapters?.oEmbed) {
		adapters.oEmbed = options.adapters.oEmbed;
	}
	if (options.adapters?.openGraph) {
		adapters.openGraph = options.adapters.openGraph;
	}

	return {
		...options,
		adapters: Object.keys(adapters).length > 0 ? adapters : undefined,
	};
}

function mergeXPluginOptions(
	platformOptions: PlatformV0PluginOptions | undefined,
	xOptions: XPluginOptions | undefined
): XPluginOptions {
	return mergePlatformPluginOptions(platformOptions, xOptions);
}

function mergeSpotifyPluginOptions(
	platformOptions: PlatformV0PluginOptions | undefined,
	spotifyOptions: SpotifyPluginOptions | undefined
): SpotifyPluginOptions {
	return mergePlatformPluginOptions(platformOptions, spotifyOptions);
}

function mergeGitHubPluginOptions(
	platformOptions: PlatformV0PluginOptions | undefined,
	githubOptions: GitHubPluginOptions | undefined
): GitHubPluginOptions {
	return mergePlatformPluginOptions(platformOptions, githubOptions);
}

function mergeYouTubePluginOptions(
	platformOptions: PlatformV0PluginOptions | undefined,
	youtubeOptions: YouTubePluginOptions | undefined
): YouTubePluginOptions {
	return mergePlatformPluginOptions(platformOptions, youtubeOptions);
}

function mergePlatformPluginOptions<T extends PlatformV0PluginOptions>(
	platformOptions: PlatformV0PluginOptions | undefined,
	pluginOptions: T | undefined
): T {
	// Shared preset options provide the baseline cross-domain stages, while the
	// plugin-specific options own any domain-aware adapter overrides.
	return {
		...(platformOptions ?? {}),
		...(pluginOptions ?? {}),
		adapters: {
			...(platformOptions?.adapters ?? {}),
			...(pluginOptions?.adapters ?? {}),
		},
	} as T;
}
