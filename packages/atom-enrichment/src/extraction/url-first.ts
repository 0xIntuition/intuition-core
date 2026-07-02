import { getClassification } from '@0xintuition/classifications';
import type { AtomType, ClassifiedAtomInput, EnrichmentArtifact } from '../types';

// URL-first creation: the user picks a classification spec, then provides a
// single URL. These helpers turn that pair into the classified-atom input the
// enrichment engine expects, without the caller needing to depend on the
// classifications package directly.

export type UrlFirstEnrichmentPreset = 'default' | 'company' | 'music' | 'crypto' | 'academic';

export type UrlFirstClassification = {
	slug: string;
	type: string;
	displayName: string;
	atomType: AtomType;
	preset: UrlFirstEnrichmentPreset;
	requiredFieldKeys: string[];
};

const SCHEMA_TYPE_TO_ATOM_TYPE: Record<string, AtomType> = {
	Person: 'person',
	Place: 'place',
	LocalBusiness: 'place',
	Organization: 'company',
	Brand: 'company',
	Service: 'company',
	Product: 'product',
	MusicRecording: 'song',
	MusicAlbum: 'song',
	MusicGroup: 'song',
	SoftwareApplication: 'software',
	SoftwareSourceCode: 'software',
	MobileApplication: 'software',
};

function resolvePreset(atomType: AtomType, category: string): UrlFirstEnrichmentPreset {
	if (atomType === 'song') return 'music';
	if (atomType === 'company') return 'company';
	if (category === 'Blockchain') return 'crypto';
	return 'default';
}

export function resolveUrlFirstClassification(slug: string): UrlFirstClassification | null {
	const spec = getClassification(slug);
	if (!spec) return null;

	const atomType = SCHEMA_TYPE_TO_ATOM_TYPE[spec.type] ?? 'thing';
	return {
		slug: spec.slug,
		type: spec.type,
		displayName: spec.displayName,
		atomType,
		preset: resolvePreset(atomType, spec.category),
		requiredFieldKeys: spec.fields.filter((field) => field.required).map((field) => field.key),
	};
}

export function buildUrlFirstClassifiedAtomInput(
	classification: UrlFirstClassification,
	url: string,
	classifiedAt: string
): ClassifiedAtomInput {
	return {
		atomType: classification.atomType,
		jsonLd: {
			'@context': 'https://schema.org/',
			'@type': classification.type,
			url,
			sameAs: [url],
		},
		source: {
			classificationEngine: 'url-first-manual',
			classifiedAt,
		},
		hints: {
			url,
		},
	};
}

const WIKIBASE_ITEM_PATTERN = /^Q\d+$/i;

// Reads the deterministic Wikipedia -> Wikidata pivot captured by the
// wikipedia plugin so a second targeted wikidata enrichment pass can run
// without fuzzy name search.
export function readWikibaseItemFromArtifacts(
	artifacts: readonly EnrichmentArtifact[]
): string | undefined {
	for (const artifact of artifacts) {
		if (artifact.artifact_type !== 'wikipedia') continue;
		const wikibaseItem = artifact.data.wikibaseItem;
		if (typeof wikibaseItem === 'string' && WIKIBASE_ITEM_PATTERN.test(wikibaseItem.trim())) {
			return wikibaseItem.trim().toUpperCase();
		}
	}
	return undefined;
}

export function hasArtifactOfType(
	artifacts: readonly EnrichmentArtifact[],
	artifactType: string
): boolean {
	return artifacts.some((artifact) => artifact.artifact_type === artifactType);
}
