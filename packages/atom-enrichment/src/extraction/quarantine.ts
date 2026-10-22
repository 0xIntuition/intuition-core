import type { EnrichmentArtifact } from '../types';
import type { ExtractedField, ExtractionContext } from './types';

/**
 * Core classification-spec descriptions and measurements. Image is a
 * descriptive URL; resource URLs, codes, contacts and unknown keys are not.
 * Keep this explicit: a new spec field is identity-bearing until reviewed.
 */
export const TITLE_STRENGTH_DESCRIPTIVE_FIELDS = Object.freeze([
	'name',
	'description',
	'image',
	'headline',
	'title',
	'text',
	'caption',
	'reviewBody',
	'keywords',
	'genre',
	'inLanguage',
	'dateCreated',
	'datePublished',
	'datePosted',
	'startDate',
	'endDate',
	'duration',
	'numberOfPages',
	'ratingValue',
	'reviewCount',
	'bestRating',
	'worstRating',
	'decimals',
	'author',
	'about',
	'location',
	'hiringOrganization',
	'jobLocation',
	'operatingSystem',
	'applicationCategory',
	'byArtist',
	'inAlbum',
	'givenName',
	'familyName',
	'partOfSeries',
	'brand',
	'itemReviewed',
	'provider',
	'areaServed',
	'platform',
	'isPartOf',
] as const);

const descriptiveFields: ReadonlySet<string> = new Set(TITLE_STRENGTH_DESCRIPTIVE_FIELDS);

export function isTitleStrengthDescriptiveField(key: string): boolean {
	return descriptiveFields.has(key);
}

/** Omitted strength is identifier-admissible for legacy compatibility. */
export function getIdentityArtifacts(
	artifacts: readonly EnrichmentArtifact[]
): EnrichmentArtifact[] {
	return artifacts.filter((artifact) => artifact.meta.identityStrength !== 'title');
}

/** Shared public-extractor boundary: all evidence for descriptions, strong evidence for identities. */
export function quarantineFields<TArgs extends unknown[]>(
	extract: (context: ExtractionContext, ...args: TArgs) => ExtractedField[]
): (context: ExtractionContext, ...args: TArgs) => ExtractedField[] {
	return (context, ...args) => {
		const identityArtifacts = getIdentityArtifacts(context.artifacts);
		if (identityArtifacts.length === context.artifacts.length) return extract(context, ...args);
		const descriptiveContext = {
			...context,
			spec: {
				...context.spec,
				fields: context.spec.fields.filter((field) => isTitleStrengthDescriptiveField(field.key)),
			},
		};
		return [
			...extract(descriptiveContext, ...args).filter((field) =>
				isTitleStrengthDescriptiveField(field.key)
			),
			...extract({ ...context, artifacts: identityArtifacts }, ...args).filter(
				(field) => !isTitleStrengthDescriptiveField(field.key)
			),
		];
	};
}
