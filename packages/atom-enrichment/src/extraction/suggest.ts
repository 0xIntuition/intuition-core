// Deterministic classification suggestions for the type-mismatch guard: when
// the user's chosen classification disagrees with what the URL family and the
// gathered artifacts indicate, the UI offers a one-tap switch. No classifier
// run, no AI — URL shapes and wikidata instance-of claims only.

import type { EnrichmentArtifact } from '../types';
import { pickPrimaryJsonLdType } from './page-native';
import { parseMicrodata, parseWikidata } from './shared';

// Wikidata P31 (instance of) entity ids → classification spec slugs.
const INSTANCE_OF_SUGGESTIONS: Record<string, string> = {
	Q5: 'person', // human
	Q11424: 'movie', // film
	Q5398426: 'tv-series', // television series
	Q7366: 'music-recording', // song
	Q134556: 'music-recording', // single
	Q482994: 'music-album', // album
	Q215380: 'music-group', // musical group
	Q4830453: 'company', // business
	Q6881511: 'company', // enterprise
	Q43229: 'company', // organization
	Q783794: 'company', // company
	Q571: 'book', // book
	Q7725634: 'book', // literary work
	Q1656682: 'event', // event
	Q132241: 'event', // festival
	Q41176: 'location', // building
	Q570116: 'location', // tourist attraction
	Q486972: 'location', // human settlement
	Q515: 'location', // city
	Q7397: 'software-application', // software
};

type UrlSuggestionRule = {
	hostSuffixes: string[];
	suggest: (parsed: URL) => string[];
};

const URL_SUGGESTION_RULES: UrlSuggestionRule[] = [
	{
		hostSuffixes: ['open.spotify.com'],
		suggest: (parsed) => {
			if (parsed.pathname.includes('/track/')) return ['music-recording'];
			if (parsed.pathname.includes('/album/')) return ['music-album'];
			if (parsed.pathname.includes('/artist/')) return ['music-group'];
			if (parsed.pathname.includes('/show/')) return ['podcast-series'];
			if (parsed.pathname.includes('/episode/')) return ['podcast-episode'];
			return [];
		},
	},
	{
		hostSuffixes: ['music.apple.com'],
		suggest: (parsed) => {
			if (parsed.searchParams.has('i') || parsed.pathname.includes('/song/')) {
				return ['music-recording'];
			}
			if (parsed.pathname.includes('/album/')) return ['music-album'];
			if (parsed.pathname.includes('/artist/')) return ['music-group'];
			return [];
		},
	},
	{
		hostSuffixes: ['github.com'],
		suggest: (parsed) => {
			const segments = parsed.pathname.split('/').filter(Boolean);
			if (segments.length >= 2) return ['software'];
			if (segments.length === 1) return ['social-media-account'];
			return [];
		},
	},
	{
		hostSuffixes: ['npmjs.com'],
		suggest: () => ['software-application'],
	},
	{
		hostSuffixes: ['youtube.com', 'youtu.be'],
		suggest: (parsed) =>
			parsed.pathname.startsWith('/@') ? ['social-media-account'] : ['video-object'],
	},
	{
		hostSuffixes: ['x.com', 'twitter.com'],
		suggest: (parsed) => {
			const segments = parsed.pathname.split('/').filter(Boolean);
			if (segments.includes('status')) return ['social-media-posting'];
			if (segments.length === 1) return ['social-media-account', 'person'];
			return [];
		},
	},
	{
		hostSuffixes: ['maps.app.goo.gl', 'maps.google.com'],
		suggest: () => ['local-business', 'location'],
	},
	{
		hostSuffixes: ['etherscan.io', 'basescan.org', 'arbiscan.io', 'polygonscan.com'],
		suggest: (parsed) => {
			if (parsed.pathname.startsWith('/token/')) return ['ethereum-erc20'];
			if (parsed.pathname.startsWith('/address/')) return ['ethereum-account'];
			return [];
		},
	},
	{
		hostSuffixes: ['themoviedb.org'],
		suggest: (parsed) => {
			if (parsed.pathname.startsWith('/tv/')) return ['tv-series'];
			if (parsed.pathname.startsWith('/movie/')) return ['movie'];
			return [];
		},
	},
];

function suggestFromUrl(url: string): string[] {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return [];
	}

	const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
	// Google Maps long URLs live under google.com/maps.
	if (
		(host === 'google.com' || host.endsWith('.google.com')) &&
		parsed.pathname.startsWith('/maps')
	) {
		return ['local-business', 'location'];
	}
	if (/(^|\.)amazon\.[a-z.]+$/.test(host) && /\/(dp|gp\/product)\//.test(parsed.pathname)) {
		return ['product'];
	}

	for (const rule of URL_SUGGESTION_RULES) {
		const matches = rule.hostSuffixes.some(
			(suffix) => host === suffix || host.endsWith(`.${suffix}`)
		);
		if (matches) {
			return rule.suggest(parsed);
		}
	}
	return [];
}

// Page JSON-LD @type → classification slug for the most entity-like node.
const PAGE_TYPE_SUGGESTIONS: Record<string, string> = {
	JobPosting: 'job-posting',
	Event: 'event',
	MusicEvent: 'event',
	Festival: 'event',
	Product: 'product',
	Movie: 'movie',
	TVSeries: 'tv-series',
	Book: 'book',
	MusicRecording: 'music-recording',
	MusicAlbum: 'music-album',
	PodcastEpisode: 'podcast-episode',
	PodcastSeries: 'podcast-series',
	CreativeWorkSeries: 'podcast-series',
	Dataset: 'dataset',
	Review: 'review',
	NewsArticle: 'news-article',
	BlogPosting: 'article',
	Article: 'article',
	VideoObject: 'video-object',
	LocalBusiness: 'local-business',
	Restaurant: 'local-business',
	SoftwareApplication: 'software-application',
	MobileApplication: 'mobile-application',
	Person: 'person',
	Place: 'location',
	TouristAttraction: 'location',
};

function suggestFromArtifacts(artifacts: readonly EnrichmentArtifact[]): string[] {
	const suggestions: string[] = [];

	for (const artifact of artifacts) {
		if (artifact.artifact_type !== 'wikidata') continue;
		const wikidata = parseWikidata(artifact.data);
		if (!wikidata) continue;
		suggestions.push(
			...(wikidata.instanceOf ?? [])
				.map((entityId) => INSTANCE_OF_SUGGESTIONS[entityId.toUpperCase()])
				.filter((slug): slug is string => Boolean(slug))
		);
		break;
	}

	for (const artifact of artifacts) {
		if (artifact.artifact_type !== 'microdata') continue;
		const microdata = parseMicrodata(artifact.data);
		const primaryType = pickPrimaryJsonLdType(microdata?.jsonLd ?? []);
		const slug = primaryType ? PAGE_TYPE_SUGGESTIONS[primaryType] : undefined;
		if (slug) suggestions.push(slug);
		break;
	}

	return suggestions;
}

/**
 * Returns classification slugs the URL + artifacts indicate, most-specific
 * first. Empty when there is no strong deterministic signal — the guard only
 * fires on confident disagreement.
 */
export function suggestClassifications(
	url: string,
	artifacts: readonly EnrichmentArtifact[]
): string[] {
	return [...new Set([...suggestFromUrl(url), ...suggestFromArtifacts(artifacts)])];
}
