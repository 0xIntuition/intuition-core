import { amazonProductRule } from './amazon-product';
import { appleMusicSongRule } from './apple-music-song';
import { brandCompanyRule } from './brand-company';
import { coingeckoTokenRule } from './coingecko-token';
import { etherscanContractRule } from './etherscan-contract';
import { genericRule } from './generic';
import { githubProfileRule } from './github-profile';
import { githubRepoRule } from './github-repo';
import { npmPackageRule } from './npm-package';
import type { Rule } from './shared';
import { spotifyAlbumRule } from './spotify-album';
import { spotifyArtistRule } from './spotify-artist';
import { spotifyPlaylistRule } from './spotify-playlist';
import { spotifyPodcastEpisodeRule, spotifyPodcastShowRule } from './spotify-podcast';
import { spotifyTrackRule } from './spotify-track';
import { tmdbMovieRule } from './tmdb-movie';
import { websiteRule } from './website';
import { wikipediaArticleRule } from './wikipedia-article';
import { xPostRule } from './x-post';
import { xProfileRule } from './x-profile';
import { youtubeVideoRule } from './youtube-video';

export const rules = [
	xProfileRule,
	xPostRule,
	appleMusicSongRule,
	spotifyTrackRule,
	spotifyArtistRule,
	spotifyAlbumRule,
	spotifyPlaylistRule,
	spotifyPodcastShowRule,
	spotifyPodcastEpisodeRule,
	youtubeVideoRule,
	wikipediaArticleRule,
	githubRepoRule,
	githubProfileRule,
	npmPackageRule,
	amazonProductRule,
	etherscanContractRule,
	coingeckoTokenRule,
	websiteRule,
	brandCompanyRule,
	tmdbMovieRule,
	genericRule,
] as const satisfies readonly Rule[];
