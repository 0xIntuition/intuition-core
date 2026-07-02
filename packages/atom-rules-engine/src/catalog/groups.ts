import type { RuleDocSnippet } from './types';

export const socialRuleDocs = [
	{
		variantId: 'x-profile',
		summary: 'Render a social profile card for X or legacy Twitter profile atoms.',
		identity: {
			categories: ['person'],
			schemaTypes: ['SocialMediaAccount'],
			urlSignals: ['https://x.com/<handle>', 'https://twitter.com/<handle>'],
		},
		enrichment: {
			primary: ['x-profile', 'twitter-profile'],
			supporting: ['wikipedia'],
		},
		selectionNotes: [
			'Prefer this over wikipedia when the atom is a profile rather than a post.',
			'Reject status URLs so individual posts fall through to x-post.',
		],
		dbExamples: ['https://x.com/elonmusk'],
	},
	{
		variantId: 'x-post',
		summary: 'Render a post card for X status URLs and canonical X post identities.',
		identity: {
			schemaTypes: ['SocialMediaPosting'],
			urlSignals: ['https://x.com/<handle>/status/<id>'],
			canonicalIdSignals: ['x:post:<id>'],
		},
		enrichment: {
			primary: [],
			supporting: ['x-profile'],
		},
		selectionNotes: [
			'This is identity-led rather than enrichment-led.',
			'It only wins when the atom is clearly a post, not a profile.',
		],
		dbExamples: [],
	},
] as const satisfies readonly RuleDocSnippet[];

export const mediaRuleDocs = [
	{
		variantId: 'apple-music-song',
		summary: 'Render an Apple Music song banner when Apple Music enrichment resolves a song.',
		identity: {
			categories: ['song'],
			schemaTypes: ['MusicRecording'],
			urlSignals: ['https://music.apple.com/...'],
		},
		enrichment: {
			primary: ['apple-music'],
		},
		selectionNotes: [
			'Only match when the Apple Music payload type is song.',
			'Album and artist handling can be added later as separate variants without changing callers.',
		],
		dbExamples: [],
	},
	{
		variantId: 'spotify-track',
		summary: 'Render a Spotify track card for music recordings enriched from Spotify.',
		identity: {
			categories: ['song'],
			schemaTypes: ['MusicRecording'],
			urlSignals: ['https://open.spotify.com/track/<id>'],
		},
		enrichment: {
			primary: ['spotify'],
		},
		selectionNotes: [
			'Only match when the Spotify payload type is track.',
			'This is intentionally split from album, artist, and playlist so subtype-specific UI stays explicit.',
		],
		dbExamples: ['https://open.spotify.com/track/1kcfGBb6kSrGqNIMW7rAlB'],
	},
	{
		variantId: 'spotify-artist',
		summary: 'Render a Spotify artist card for artist atoms enriched from Spotify.',
		identity: {
			categories: ['song'],
			schemaTypes: ['MusicRecording', 'MusicGroup', 'Person'],
			urlSignals: ['https://open.spotify.com/artist/<id>'],
		},
		enrichment: {
			primary: ['spotify'],
		},
		selectionNotes: ['Only match when the Spotify payload type is artist.'],
		dbExamples: [],
	},
	{
		variantId: 'spotify-album',
		summary: 'Render a Spotify album card for album atoms enriched from Spotify.',
		identity: {
			categories: ['song'],
			schemaTypes: ['MusicAlbum'],
			urlSignals: ['https://open.spotify.com/album/<id>'],
		},
		enrichment: {
			primary: ['spotify'],
		},
		selectionNotes: ['Only match when the Spotify payload type is album.'],
		dbExamples: [],
	},
	{
		variantId: 'spotify-playlist',
		summary: 'Render a Spotify playlist card for playlist atoms enriched from Spotify.',
		identity: {
			categories: ['song'],
			urlSignals: ['https://open.spotify.com/playlist/<id>'],
		},
		enrichment: {
			primary: ['spotify'],
		},
		selectionNotes: ['Only match when the Spotify payload type is playlist.'],
		dbExamples: [],
	},
	{
		variantId: 'spotify-podcast-show',
		summary: 'Render a Spotify podcast show card for podcast series atoms enriched from Spotify.',
		identity: {
			categories: ['thing'],
			schemaTypes: ['PodcastSeries'],
			urlSignals: ['https://open.spotify.com/show/<id>'],
			canonicalIdSignals: ['spotify:show:<id>'],
		},
		enrichment: {
			primary: ['spotify'],
			supporting: ['opengraph'],
		},
		selectionNotes: [
			'Only match typed Spotify artifacts when the payload type is show.',
			'When typed Spotify data is absent, require PodcastSeries identity plus Spotify show URL or canonical signals.',
		],
		dbExamples: ['https://open.spotify.com/show/38bS44xjbVVZ3No3ByF1dJ'],
	},
	{
		variantId: 'spotify-podcast-episode',
		summary:
			'Render a Spotify podcast episode card for podcast episode atoms enriched from Spotify.',
		identity: {
			categories: ['thing'],
			schemaTypes: ['PodcastEpisode'],
			urlSignals: ['https://open.spotify.com/episode/<id>'],
			canonicalIdSignals: ['spotify:episode:<id>'],
		},
		enrichment: {
			primary: ['spotify'],
			supporting: ['opengraph'],
		},
		selectionNotes: [
			'Only match typed Spotify artifacts when the payload type is episode.',
			'When typed Spotify data is absent, require PodcastEpisode identity plus Spotify episode URL or canonical signals.',
		],
		dbExamples: ['https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk'],
	},
	{
		variantId: 'youtube-video',
		summary:
			'Render a YouTube video card for video atoms enriched from YouTube or embeddable metadata.',
		identity: {
			schemaTypes: ['VideoObject'],
			urlSignals: ['https://www.youtube.com/watch?v=<id>', 'https://youtu.be/<id>'],
		},
		enrichment: {
			primary: ['youtube'],
			supporting: ['oembed'],
		},
		selectionNotes: [
			'Allow either a direct YouTube artifact or oEmbed support.',
			'Video schema or YouTube URL signals let this stay robust when enrichment sets differ.',
		],
		dbExamples: ['https://www.youtube.com/watch?v=qtSA95I2X30'],
	},
	{
		variantId: 'wikipedia-article',
		summary: 'Render a reference/article card for atoms enriched with Wikipedia or Wikidata.',
		identity: {
			urlSignals: ['https://en.wikipedia.org/wiki/<title>'],
		},
		enrichment: {
			primary: ['wikipedia'],
			supporting: ['wikidata'],
		},
		selectionNotes: [
			'This is a strong informational fallback when a more specific provider card is absent.',
			'It intentionally loses to x-profile and github-repo when both exist on the same atom.',
		],
		dbExamples: ['https://en.wikipedia.org/wiki/TypeScript'],
	},
	{
		variantId: 'tmdb-movie',
		summary: 'Render a movie card for entertainment atoms enriched from TMDB.',
		identity: {
			urlSignals: ['https://www.themoviedb.org/movie/<id>'],
		},
		enrichment: {
			primary: ['tmdb'],
		},
		selectionNotes: [
			'Only match when the TMDB payload mediaType is movie.',
			'TV support should be a separate explicit variant if we add it.',
		],
		dbExamples: [],
	},
] as const satisfies readonly RuleDocSnippet[];

export const softwareRuleDocs = [
	{
		variantId: 'github-repo',
		summary: 'Render a repository card for software atoms that have GitHub repo enrichment.',
		identity: {
			categories: ['software'],
			schemaTypes: ['SoftwareSourceCode'],
			urlSignals: ['https://github.com/<owner>/<repo>'],
		},
		enrichment: {
			primary: ['github-repo'],
			supporting: ['npm-package', 'wikipedia'],
		},
		selectionNotes: [
			'Prefer this over npm-package and wikipedia when repo enrichment exists for the same atom.',
			'This keeps the primary software identity anchored to the source repository.',
		],
		dbExamples: ['https://github.com/microsoft/TypeScript'],
	},
	{
		variantId: 'github-profile',
		summary: 'Render a GitHub profile card for organization or user profile atoms.',
		identity: {
			categories: ['company', 'person'],
			schemaTypes: ['Organization', 'Person'],
			urlSignals: ['https://github.com/<login>'],
		},
		enrichment: {
			primary: ['github-user'],
		},
		selectionNotes: [
			'This is distinct from github-repo so org/user presentation logic stays separate.',
		],
		dbExamples: ['https://github.com/0xIntuition'],
	},
	{
		variantId: 'npm-package',
		summary: 'Render a package card for software atoms enriched from npm.',
		identity: {
			categories: ['software'],
			schemaTypes: ['SoftwareSourceCode', 'SoftwareApplication'],
			urlSignals: ['https://www.npmjs.com/package/<name>'],
		},
		enrichment: {
			primary: ['npm-package'],
			supporting: ['github-repo'],
		},
		selectionNotes: [
			'This is a software fallback when repo enrichment is absent.',
			'Repo enrichment intentionally outranks npm when both are attached to the same atom.',
		],
		dbExamples: ['https://www.npmjs.com/package/typescript'],
	},
] as const satisfies readonly RuleDocSnippet[];

export const commerceRuleDocs = [
	{
		variantId: 'amazon-product',
		summary:
			'Render a product listing card for ecommerce product atoms, especially Amazon listings.',
		identity: {
			categories: ['product'],
			schemaTypes: ['Product'],
			urlSignals: ['https://www.amazon.com/dp/<asin>'],
			canonicalIdSignals: ['asin:<id>'],
		},
		enrichment: {
			primary: ['product-listing'],
			supporting: ['opengraph'],
		},
		selectionNotes: [
			'Key nuance: rely on enrichment artifactType product-listing, not artifact_link.classification alone.',
			'This covers real DB rows where the link classification is metadata but the wrapped artifact is product-listing.',
		],
		dbExamples: ['asin:B0C9TXYZ8G', 'https://www.amazon.com/dp/B0C9TXYZ8G?_encoding=UTF8&psc=1'],
	},
] as const satisfies readonly RuleDocSnippet[];

export const onchainRuleDocs = [
	{
		variantId: 'etherscan-contract',
		summary: 'Render an onchain address card using Etherscan enrichment for Ethereum addresses.',
		identity: {
			schemaTypes: ['EthereumAccount'],
			canonicalIdSignals: ['0x<address>'],
			urlSignals: ['https://etherscan.io/address/<address>'],
		},
		enrichment: {
			primary: ['etherscan'],
			supporting: ['token-metadata'],
		},
		selectionNotes: [
			'Current precedence prefers this over token metadata when both artifacts exist.',
			'This rule family is the right place to later split wallet, contract, and token behavior for 0x addresses.',
		],
		dbExamples: ['0xb95ca3d3144e9d1daff0ee3d35a4488a4a5c9fc5'],
	},
	{
		variantId: 'coingecko-token',
		summary: 'Render a token-style card for 0x addresses enriched with token metadata.',
		identity: {
			schemaTypes: ['EthereumAccount'],
			canonicalIdSignals: ['0x<address>'],
		},
		enrichment: {
			primary: ['token-metadata'],
			supporting: ['etherscan'],
		},
		selectionNotes: [
			'This is the token-side rule for 0x addresses.',
			'If we later add stronger token/account/contract routing, this rule should use token metadata quality rather than pure priority.',
		],
		dbExamples: ['0xb95ca3d3144e9d1daff0ee3d35a4488a4a5c9fc5'],
	},
] as const satisfies readonly RuleDocSnippet[];

export const identityRuleDocs = [
	{
		variantId: 'website',
		summary: 'Render a website-style card for generic sites identified as WebSite schema.',
		identity: {
			schemaTypes: ['WebSite'],
			urlSignals: ['https://<domain>'],
		},
		enrichment: {
			primary: [],
			supporting: ['brand', 'company-profile', 'opengraph'],
		},
		selectionNotes: [
			'This currently outranks brand-company when the identity is a generic WebSite.',
			'That keeps broad website atoms from automatically becoming company cards.',
		],
		dbExamples: ['https://www.doordash.com'],
	},
	{
		variantId: 'brand-company',
		summary: 'Render a brand or company card when branding enrichments are present.',
		identity: {
			categories: ['company'],
			schemaTypes: ['Organization', 'WebSite'],
		},
		enrichment: {
			primary: ['brand', 'company-profile'],
		},
		selectionNotes: [
			'This is the company-focused fallback when website does not take precedence.',
			'It is useful for domains enriched by Brandfetch or company profile providers.',
		],
		dbExamples: ['https://www.doordash.com'],
	},
] as const satisfies readonly RuleDocSnippet[];

export const fallbackRuleDocs = [
	{
		variantId: 'generic',
		summary: 'Fallback rendering when no specialized frontend style matches.',
		identity: {},
		enrichment: {
			primary: [],
		},
		selectionNotes: [
			'This should always remain available as the terminal fallback.',
			'If a new provider card is added, it should beat generic through an explicit rule rather than ad hoc UI conditionals.',
		],
		dbExamples: [],
	},
] as const satisfies readonly RuleDocSnippet[];
