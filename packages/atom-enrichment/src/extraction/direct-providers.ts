// Field extractors backed by direct-provider artifacts (Spotify, Apple Music,
// GitHub, npm, YouTube, X, Google Places, Etherscan/CoinGecko) plus pure
// URL-parse tiers that need no network at all. Each returns candidate fields;
// the merge keeps the first value per key and drops keys the target spec does
// not define, so extractors can be generous.

import {
	CONFIDENCE,
	field,
	findArtifactData,
	parseAppleMusic,
	parseEtherscan,
	parseGithubRepo,
	parseNpm,
	parseOembed,
	parsePlaces,
	parsePodcastIndex,
	parseSpotify,
	parseTokenMetadata,
	parseXProfile,
	parseYoutube,
	readString,
} from './shared';
import type { ExtractedField, ExtractionContext } from './types';

const GENERATED_SPOTIFY_NAME_PATTERN =
	/^(?:Spotify )?(Track|Album|Artist|Playlist|Show|Episode) [A-Za-z0-9]+$/i;

// ── Music: spotify → apple-music ─────────────────────────────────────────────

export function extractMusicFields(context: ExtractionContext): ExtractedField[] {
	const spotify = findArtifactData(context.artifacts, 'spotify', parseSpotify);
	const appleMusic = findArtifactData(context.artifacts, 'apple-music', parseAppleMusic);
	const fields: ExtractedField[] = [];

	const spotifyName = readString(spotify?.data.name);
	const usableSpotifyName =
		spotifyName && !GENERATED_SPOTIFY_NAME_PATTERN.test(spotifyName) ? spotifyName : undefined;
	const spotifyArtists = (spotify?.data.artists ?? [])
		.map((artist) => readString(artist.name))
		.filter((name): name is string => Boolean(name))
		.join(', ');

	const name = usableSpotifyName ?? readString(appleMusic?.data.name);
	if (name) {
		fields.push(
			field(
				'name',
				name,
				usableSpotifyName ? 'spotify' : 'apple-music',
				CONFIDENCE.provider,
				usableSpotifyName ? spotify?.data.spotifyUrl : appleMusic?.data.appleMusicUrl
			)
		);
	}

	const byArtist =
		spotifyArtists.length > 0 ? spotifyArtists : readString(appleMusic?.data.artistName);
	if (byArtist) {
		fields.push(
			field(
				'byArtist',
				byArtist,
				spotifyArtists.length > 0 ? 'spotify' : 'apple-music',
				CONFIDENCE.provider
			)
		);
	}

	const inAlbum = readString(spotify?.data.albumName) ?? readString(appleMusic?.data.albumName);
	if (inAlbum) {
		fields.push(
			field(
				'inAlbum',
				inAlbum,
				readString(spotify?.data.albumName) ? 'spotify' : 'apple-music',
				CONFIDENCE.provider
			)
		);
	}

	return fields;
}

// ── Podcasts: spotify shows/episodes (apple podcasts arrives page-native) ───

// Layers podcast peers (cross-provider augmentation): Spotify is primary,
// the iTunes catalog and Podcast Index fill in when the pasted URL came from
// elsewhere — and their canonical URLs (including the RSS feed) all land in
// sameAs so dedup keys cover the whole media family.
export function extractPodcastFields(
	context: ExtractionContext,
	kind: 'series' | 'episode'
): ExtractedField[] {
	const spotify = findArtifactData(context.artifacts, 'spotify', parseSpotify);
	const expectedType = kind === 'series' ? 'show' : 'episode';
	const spotifyData = spotify && spotify.data.type === expectedType ? spotify.data : undefined;
	const appleMusic = findArtifactData(context.artifacts, 'apple-music', parseAppleMusic);
	const appleData = appleMusic?.data.type === 'podcast' ? appleMusic.data : undefined;
	const podcastIndex = findArtifactData(context.artifacts, 'podcast-index', parsePodcastIndex);

	const fields: ExtractedField[] = [];

	const spotifyName = readString(spotifyData?.name);
	const usableSpotifyName =
		spotifyName && !GENERATED_SPOTIFY_NAME_PATTERN.test(spotifyName) ? spotifyName : undefined;
	if (usableSpotifyName) {
		fields.push(
			field('name', usableSpotifyName, 'spotify', CONFIDENCE.provider, spotifyData?.spotifyUrl)
		);
	} else if (kind === 'series') {
		// Peer providers index the series, not individual episodes — never let
		// a show title overwrite an episode name.
		const peerName = readString(appleData?.name) ?? readString(podcastIndex?.data.title);
		if (peerName) {
			fields.push(
				field(
					'name',
					peerName,
					appleData?.name ? 'apple-music' : 'podcast-index',
					CONFIDENCE.provider,
					appleData?.name ? appleData.appleMusicUrl : podcastIndex?.sourceUrl
				)
			);
		}
	}

	const url =
		readString(spotifyData?.spotifyUrl) ??
		(kind === 'series'
			? (readString(appleData?.appleMusicUrl) ?? readString(podcastIndex?.data.link))
			: undefined);
	if (url) {
		fields.push(
			field(
				'url',
				url,
				spotifyData?.spotifyUrl
					? 'spotify'
					: appleData?.appleMusicUrl
						? 'apple-music'
						: 'podcast-index',
				CONFIDENCE.provider
			)
		);
	}

	if (kind === 'series') {
		const sameAs = [
			...new Set(
				[
					context.url,
					spotifyData?.spotifyUrl,
					appleData?.appleMusicUrl,
					appleData?.feedUrl,
					podcastIndex?.data.feedUrl,
					podcastIndex?.data.link,
				].filter((value): value is string => typeof value === 'string' && value.length > 0)
			),
		];
		if (sameAs.length > 1) {
			const sameAsSource = spotifyData ? 'spotify' : appleData ? 'apple-music' : 'podcast-index';
			fields.push(field('sameAs', sameAs, sameAsSource, CONFIDENCE.provider));
		}
	}

	if (kind === 'episode' && spotifyData) {
		const showName = readString(spotifyData.showName);
		if (showName) {
			fields.push(field('partOfSeries', showName, 'spotify', CONFIDENCE.provider));
		}
		const releaseDate = readString(spotifyData.releaseDate);
		if (releaseDate && /^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) {
			fields.push(field('datePublished', releaseDate, 'spotify', CONFIDENCE.provider));
		}
	}
	return fields;
}

// ── Software: github repo / npm package ──────────────────────────────────────

const GITHUB_REPO_URL_PATTERN = /^https?:\/\/(www\.)?github\.com\/[^/]+\/[^/]+/i;

// GitHub repo URLs are self-describing: /{owner}/{repo} IS the canonical
// repository slug. Used as the deterministic fallback when the GitHub API is
// unreachable (rate limit, bad token) so required fields still fill.
function parseGitHubRepoFromUrl(url: string): { owner: string; repo: string } | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}
	const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
	if (host !== 'github.com') return undefined;
	const [owner, repo, third] = parsed.pathname.split('/').filter(Boolean);
	// Deep paths (issues, pulls, …) are not the repo identity; blob/tree are.
	if (third && third !== 'blob' && third !== 'tree') return undefined;
	if (!(owner && repo)) return undefined;
	return { owner, repo: repo.replace(/\.git$/, '') };
}

export function extractSoftwareFields(context: ExtractionContext): ExtractedField[] {
	const repo = findArtifactData(context.artifacts, 'github-repo', parseGithubRepo);
	if (repo) {
		const codeRepository = GITHUB_REPO_URL_PATTERN.test(context.url)
			? context.url
			: `https://github.com/${repo.data.fullName}`;
		return [
			field('name', repo.data.name, 'github', CONFIDENCE.provider, codeRepository),
			field('codeRepository', codeRepository, 'github', CONFIDENCE.provider),
		];
	}

	const fromUrl = parseGitHubRepoFromUrl(context.url);
	if (!fromUrl) return [];
	const codeRepository = `https://github.com/${fromUrl.owner}/${fromUrl.repo}`;
	return [
		field('name', fromUrl.repo, 'input-url', CONFIDENCE.urlParse, codeRepository),
		field('codeRepository', codeRepository, 'input-url', CONFIDENCE.urlParse),
	];
}

export function extractSoftwareApplicationFields(context: ExtractionContext): ExtractedField[] {
	const repo = findArtifactData(context.artifacts, 'github-repo', parseGithubRepo);
	const npm = findArtifactData(context.artifacts, 'npm-package', parseNpm);
	const fields: ExtractedField[] = [];

	const name = readString(repo?.data.name) ?? readString(npm?.data.name);
	if (name) {
		fields.push(field('name', name, repo ? 'github' : 'npm', CONFIDENCE.provider));
	}

	const url = readString(repo?.data.homepage) ?? readString(npm?.data.homepage) ?? context.url;
	fields.push(
		field(
			'url',
			url,
			repo?.data.homepage || npm?.data.homepage ? (repo ? 'github' : 'npm') : 'input-url',
			CONFIDENCE.provider
		)
	);

	return fields;
}

// ── Video: youtube → generic oembed ──────────────────────────────────────────

export function extractVideoObjectFields(context: ExtractionContext): ExtractedField[] {
	const youtube = findArtifactData(context.artifacts, 'youtube', parseYoutube);
	const fields: ExtractedField[] = [];

	if (youtube) {
		fields.push(field('name', youtube.data.title, 'youtube', CONFIDENCE.provider));
		const description = readString(youtube.data.description);
		if (description) {
			fields.push(field('description', description, 'youtube', CONFIDENCE.provider));
		}
		fields.push(field('contentUrl', context.url, 'input-url', CONFIDENCE.inputUrl));
		return fields;
	}

	const oembed = findArtifactData(context.artifacts, 'oembed', parseOembed);
	if (oembed && (oembed.data.type === 'video' || oembed.data.type === 'rich')) {
		const name = readString(oembed.data.title);
		if (name) {
			fields.push(field('name', name, 'oembed', CONFIDENCE.provider));
			fields.push(field('contentUrl', context.url, 'input-url', CONFIDENCE.inputUrl));
		}
	}
	return fields;
}

// ── Social media accounts: x-profile artifact, else pure URL parse ──────────

type SocialPlatformRule = {
	platform: string;
	hostSuffixes: string[];
	parseHandle: (segments: string[]) => string | undefined;
	reserved?: Set<string>;
};

const SOCIAL_PLATFORM_RULES: SocialPlatformRule[] = [
	{
		platform: 'X',
		hostSuffixes: ['x.com', 'twitter.com'],
		reserved: new Set([
			'home',
			'explore',
			'search',
			'i',
			'intent',
			'notifications',
			'messages',
			'settings',
			'hashtag',
			'share',
			'login',
		]),
		parseHandle: (segments) => (segments.length === 1 ? segments[0]?.replace(/^@/, '') : undefined),
	},
	{
		platform: 'GitHub',
		hostSuffixes: ['github.com'],
		reserved: new Set([
			'orgs',
			'about',
			'features',
			'pricing',
			'topics',
			'collections',
			'trending',
			'marketplace',
			'sponsors',
			'settings',
			'login',
			'signup',
			'explore',
		]),
		parseHandle: (segments) => (segments.length === 1 ? segments[0] : undefined),
	},
	{
		platform: 'Instagram',
		hostSuffixes: ['instagram.com'],
		reserved: new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts']),
		parseHandle: (segments) => (segments.length === 1 ? segments[0] : undefined),
	},
	{
		platform: 'TikTok',
		hostSuffixes: ['tiktok.com'],
		parseHandle: (segments) =>
			segments.length === 1 && segments[0]?.startsWith('@') ? segments[0].slice(1) : undefined,
	},
	{
		platform: 'LinkedIn',
		hostSuffixes: ['linkedin.com'],
		parseHandle: (segments) =>
			(segments[0] === 'in' || segments[0] === 'company') && segments.length === 2
				? segments[1]
				: undefined,
	},
	{
		platform: 'YouTube',
		hostSuffixes: ['youtube.com'],
		parseHandle: (segments) =>
			segments.length === 1 && segments[0]?.startsWith('@') ? segments[0].slice(1) : undefined,
	},
	{
		platform: 'Twitch',
		hostSuffixes: ['twitch.tv'],
		reserved: new Set(['directory', 'videos', 'settings']),
		parseHandle: (segments) => (segments.length === 1 ? segments[0] : undefined),
	},
];

export function parseSocialAccountUrl(
	url: string
): { username: string; platform: string } | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}

	const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
	const segments = parsed.pathname.split('/').filter(Boolean);

	for (const rule of SOCIAL_PLATFORM_RULES) {
		const matchesHost = rule.hostSuffixes.some(
			(suffix) => host === suffix || host.endsWith(`.${suffix}`)
		);
		if (!matchesHost) continue;
		const handle = rule.parseHandle(segments);
		if (!handle || rule.reserved?.has(handle.toLowerCase())) continue;
		return { username: handle, platform: rule.platform };
	}

	return undefined;
}

export function extractSocialMediaAccountFields(context: ExtractionContext): ExtractedField[] {
	const xProfile = findArtifactData(context.artifacts, 'x-profile', parseXProfile);
	if (xProfile) {
		return [
			field('username', xProfile.data.username, 'x-profile', CONFIDENCE.provider),
			field('platform', 'X', 'x-profile', CONFIDENCE.provider),
			field('url', context.url, 'input-url', CONFIDENCE.inputUrl),
		];
	}

	const parsed = parseSocialAccountUrl(context.url);
	if (!parsed) return [];
	return [
		field('username', parsed.username, 'input-url', CONFIDENCE.urlParse),
		field('platform', parsed.platform, 'input-url', CONFIDENCE.urlParse),
		field('url', context.url, 'input-url', CONFIDENCE.inputUrl),
	];
}

// ── Ethereum: explorer URLs + etherscan/coingecko artifacts ─────────────────

// Chain ids inferred from the explorer host serving the pasted URL.
const EXPLORER_CHAIN_IDS: Record<string, number> = {
	'etherscan.io': 1,
	'sepolia.etherscan.io': 11_155_111,
	'holesky.etherscan.io': 17_000,
	'basescan.org': 8453,
	'sepolia.basescan.org': 84_532,
	'arbiscan.io': 42_161,
	'optimistic.etherscan.io': 10,
	'polygonscan.com': 137,
	'bscscan.com': 56,
	'snowtrace.io': 43_114,
	'lineascan.build': 59_144,
	'blastscan.io': 81_457,
	'scrollscan.com': 534_352,
};

const ETHEREUM_ADDRESS_PATTERN = /0x[a-fA-F0-9]{40}/;

export function resolveExplorerChainId(url: string): number | undefined {
	try {
		const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
		return EXPLORER_CHAIN_IDS[host];
	} catch {
		return undefined;
	}
}

function resolveEthereumAddress(context: ExtractionContext): string | undefined {
	const etherscan = findArtifactData(context.artifacts, 'etherscan', parseEtherscan);
	if (etherscan?.data.address && ETHEREUM_ADDRESS_PATTERN.test(etherscan.data.address)) {
		return etherscan.data.address;
	}
	const token = findArtifactData(context.artifacts, 'token-metadata', parseTokenMetadata);
	if (token?.data.address && ETHEREUM_ADDRESS_PATTERN.test(token.data.address)) {
		return token.data.address;
	}
	return ETHEREUM_ADDRESS_PATTERN.exec(context.url)?.[0];
}

export function extractEthereumAccountFields(context: ExtractionContext): ExtractedField[] {
	const address = resolveEthereumAddress(context);
	return address ? [field('address', address, 'input-url', CONFIDENCE.provider)] : [];
}

export function extractEthereumContractFields(context: ExtractionContext): ExtractedField[] {
	const fields = extractEthereumAccountFields(context);
	const chainId = resolveExplorerChainId(context.url);
	if (chainId !== undefined) {
		fields.push(field('chainId', chainId, 'input-url', CONFIDENCE.urlParse));
	}
	return fields;
}

export function extractEthereumErc20Fields(context: ExtractionContext): ExtractedField[] {
	const fields = extractEthereumContractFields(context);
	const token = findArtifactData(context.artifacts, 'token-metadata', parseTokenMetadata);
	const etherscan = findArtifactData(context.artifacts, 'etherscan', parseEtherscan);

	const name = readString(token?.data.name) ?? readString(etherscan?.data.tokenName);
	if (name) {
		fields.push(field('name', name, token ? 'coingecko' : 'etherscan', CONFIDENCE.provider));
	}
	const symbol = readString(token?.data.symbol) ?? readString(etherscan?.data.tokenSymbol);
	if (symbol) {
		fields.push(field('symbol', symbol, token ? 'coingecko' : 'etherscan', CONFIDENCE.provider));
	}
	if (token && Number.isInteger(token.data.decimals)) {
		fields.push(field('decimals', token.data.decimals, 'coingecko', CONFIDENCE.provider));
	}
	return fields;
}

// ── Physical places: Google Places artifact ──────────────────────────────────

export function extractPlacesBackedFields(context: ExtractionContext): ExtractedField[] {
	const places = findArtifactData(context.artifacts, 'places', parsePlaces);
	if (!places) return [];

	const evidenceUrl = places.sourceUrl;
	const fields: ExtractedField[] = [
		field('name', places.data.name, 'google-places', CONFIDENCE.provider, evidenceUrl),
	];
	const address = readString(places.data.formattedAddress);
	if (address) {
		fields.push(field('address', address, 'google-places', CONFIDENCE.provider, evidenceUrl));
	}
	const telephone = readString(places.data.phoneNumber);
	if (telephone) {
		fields.push(field('telephone', telephone, 'google-places', CONFIDENCE.provider, evidenceUrl));
	}
	const website = readString(places.data.website);
	if (website) {
		fields.push(field('url', website, 'google-places', CONFIDENCE.provider, evidenceUrl));
	}
	return fields;
}
