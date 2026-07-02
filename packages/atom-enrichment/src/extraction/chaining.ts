// Identifier-chaining: after an enrichment pass, harvest exact provider ids
// from the artifacts already gathered (the Wikipedia → Wikidata pivot, then
// Wikidata's external-id claims) so a follow-up pass can run ONLY the plugins
// those ids unlock — never fuzzy search. See classification-parity-spec.md §2.

import type { EnrichmentArtifact } from '../types';
import { parsePlaces, parseWikidata, parseWikipedia, readString } from './shared';
import { readCoordinateClaimValue, readStringClaimValues } from './wikidata-claims';

export type ChainHarvest = {
	/** hints.identifiers entries for the next enrichment pass. */
	identifiers: Record<string, string>;
	/** Plugin slugs those identifiers unlock. */
	pluginSlugs: string[];
};

// Wikidata external-id properties → identifier keys the target plugins read.
const WIKIDATA_EXTERNAL_ID_CHAINS: Array<{
	property: string;
	identifierKey: string;
	pluginSlug: string;
	/** Formats the raw claim value into the identifier the plugin expects. */
	format?: (value: string) => string;
}> = [
	{ property: 'P4947', identifierKey: 'tmdb', pluginSlug: 'tmdb', format: (v) => `movie:${v}` },
	{ property: 'P4983', identifierKey: 'tmdb', pluginSlug: 'tmdb', format: (v) => `tv:${v}` },
	{ property: 'P1651', identifierKey: 'youtubeVideoId', pluginSlug: 'youtube' },
	{ property: 'P2207', identifierKey: 'spotifyTrackId', pluginSlug: 'spotify' },
	{ property: 'P2205', identifierKey: 'spotifyAlbumId', pluginSlug: 'spotify' },
	{ property: 'P1902', identifierKey: 'spotifyArtistId', pluginSlug: 'spotify' },
];

function harvestFromWikipedia(
	artifacts: readonly EnrichmentArtifact[],
	harvest: ChainHarvest
): void {
	for (const artifact of artifacts) {
		if (artifact.artifact_type !== 'wikipedia') continue;
		const wikibaseItem = readString(artifact.data.wikibaseItem);
		if (wikibaseItem && /^Q\d+$/i.test(wikibaseItem)) {
			harvest.identifiers.wikidata = wikibaseItem.toUpperCase();
			harvest.pluginSlugs.push('wikidata');
			return;
		}
	}
}

function harvestFromWikidata(
	artifacts: readonly EnrichmentArtifact[],
	harvest: ChainHarvest
): void {
	for (const artifact of artifacts) {
		if (artifact.artifact_type !== 'wikidata') continue;
		const wikidata = parseWikidata(artifact.data);
		if (!wikidata) continue;

		for (const chain of WIKIDATA_EXTERNAL_ID_CHAINS) {
			if (harvest.identifiers[chain.identifierKey]) continue;
			const value = readStringClaimValues(wikidata.claims, chain.property)[0];
			if (!value) continue;
			harvest.identifiers[chain.identifierKey] = chain.format ? chain.format(value) : value;
			harvest.pluginSlugs.push(chain.pluginSlug);
		}

		// P856 official website → brand plugin domain (explicitly bypasses the
		// brand platform blocklist, which is exactly the intent here).
		const websiteUrl = readStringClaimValues(wikidata.claims, 'P856')[0];
		if (websiteUrl && !harvest.identifiers.domain) {
			try {
				const domain = new URL(websiteUrl).hostname.replace(/^www\./, '').toLowerCase();
				if (domain.includes('.')) {
					harvest.identifiers.domain = domain;
					harvest.pluginSlugs.push('brand');
				}
			} catch {
				// Malformed website claim — skip the brand chain.
			}
		}

		// P625 coordinates + the entity label → Places (street address, phone,
		// hours, photo for Wikipedia-sourced physical places).
		const coordinates = readCoordinateClaimValue(wikidata.claims, 'P625');
		if (coordinates && !harvest.identifiers.placeQuery) {
			harvest.identifiers.placeQuery = wikidata.label;
			harvest.identifiers.placeLatitude = String(coordinates.latitude);
			harvest.identifiers.placeLongitude = String(coordinates.longitude);
			harvest.pluginSlugs.push('places');
		}
		return;
	}
}

/**
 * Harvests chainable identifiers from gathered artifacts, excluding plugins
 * that already produced an artifact (no point re-running them).
 */
export function harvestChainIdentifiers(artifacts: readonly EnrichmentArtifact[]): ChainHarvest {
	const harvest: ChainHarvest = { identifiers: {}, pluginSlugs: [] };
	harvestFromWikipedia(artifacts, harvest);
	harvestFromWikidata(artifacts, harvest);

	const presentTypes = new Set(artifacts.map((artifact) => artifact.artifact_type));
	const slugToArtifactType: Record<string, string> = {
		wikidata: 'wikidata',
		tmdb: 'tmdb',
		youtube: 'youtube',
		spotify: 'spotify',
		brand: 'brand',
		places: 'places',
	};

	const pluginSlugs = [...new Set(harvest.pluginSlugs)].filter((slug) => {
		const artifactType = slugToArtifactType[slug];
		return !(artifactType && presentTypes.has(artifactType));
	});

	if (pluginSlugs.length === 0) {
		return { identifiers: {}, pluginSlugs: [] };
	}
	return { identifiers: harvest.identifiers, pluginSlugs };
}

// Confirms whether a places artifact actually resolved (used for loop tests).
export function hasResolvedPlace(artifacts: readonly EnrichmentArtifact[]): boolean {
	return artifacts.some(
		(artifact) => artifact.artifact_type === 'places' && parsePlaces(artifact.data) !== null
	);
}

export function hasWikipediaPivot(artifacts: readonly EnrichmentArtifact[]): boolean {
	return artifacts.some(
		(artifact) =>
			artifact.artifact_type === 'wikipedia' &&
			parseWikipedia(artifact.data)?.wikibaseItem !== undefined
	);
}
