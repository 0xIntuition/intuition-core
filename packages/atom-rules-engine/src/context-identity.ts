import { isHttpUrl, isYouTubeUrl, type RawRecord, readString } from './context-utils';
import type { AnyNormalizedArtifact, ClassificationResultInput, ResolvedIdentity } from './types';

type IdentityResolutionInput = {
	atomData?: string;
	parsedAtomData?: RawRecord;
	structuredData?: RawRecord;
	classificationResult?: ClassificationResultInput | null;
	resolvedAtom?: {
		category?: string;
		schemaType?: string;
		title?: string;
		description?: string;
		canonicalId?: string;
		sameAs?: string[];
	};
	rawInput?: string;
	artifacts: AnyNormalizedArtifact[];
};

export function resolveIdentity(input: IdentityResolutionInput): ResolvedIdentity {
	const category =
		readString(input.resolvedAtom?.category) ??
		readString(input.classificationResult?.category) ??
		resolveCategoryFromSchemaType(
			readString(input.resolvedAtom?.schemaType) ??
				readString(input.classificationResult?.schemaType) ??
				readString(input.structuredData?.['@type']) ??
				readString(input.parsedAtomData?.['@type'])
		);

	const schemaType =
		readString(input.resolvedAtom?.schemaType) ??
		readString(input.classificationResult?.schemaType) ??
		readString(input.structuredData?.['@type']) ??
		readString(input.parsedAtomData?.['@type']);

	const canonicalId =
		readString(input.resolvedAtom?.canonicalId) ??
		readString(input.classificationResult?.targetUrl) ??
		readString(input.structuredData?.url) ??
		readString(input.parsedAtomData?.url) ??
		(isHttpUrl(input.atomData) ? input.atomData : undefined) ??
		input.artifacts.find((artifact) => artifact.sourceUrl)?.sourceUrl;

	const sameAs = Array.from(
		new Set(
			[
				...(input.resolvedAtom?.sameAs ?? []).filter(
					(candidate): candidate is string => typeof candidate === 'string' && candidate.length > 0
				),
				readString(input.structuredData?.url),
				readString(input.parsedAtomData?.url),
			].filter((candidate): candidate is string => Boolean(candidate))
		)
	);

	const title =
		readString(input.resolvedAtom?.title) ??
		readString(input.structuredData?.name) ??
		readString(input.structuredData?.title) ??
		readString(input.parsedAtomData?.name) ??
		readString(input.parsedAtomData?.title) ??
		(!input.atomData?.startsWith('{') ? input.atomData : undefined);

	const description =
		readString(input.resolvedAtom?.description) ??
		readString(input.structuredData?.description) ??
		readString(input.parsedAtomData?.description);

	const canonicalUrl =
		readString(input.classificationResult?.targetUrl) ??
		readString(input.structuredData?.url) ??
		readString(input.parsedAtomData?.url) ??
		(isHttpUrl(input.rawInput) ? input.rawInput : undefined) ??
		(isHttpUrl(input.atomData) ? input.atomData : undefined) ??
		input.artifacts.find((artifact) => artifact.sourceUrl)?.sourceUrl;

	return {
		category,
		schemaType,
		canonicalId,
		sameAs,
		title,
		description,
		canonicalUrl,
		presentationFamily: resolvePresentationFamily({
			category,
			schemaType,
			canonicalUrl,
		}),
	};
}

function resolveCategoryFromSchemaType(schemaType: string | undefined): string | undefined {
	switch (schemaType) {
		case 'Person':
		case 'SocialMediaAccount':
			return 'person';
		case 'Organization':
			return 'company';
		case 'Product':
			return 'product';
		case 'MusicRecording':
		case 'MusicAlbum':
			return 'song';
		case 'PodcastSeries':
		case 'PodcastEpisode':
			return 'podcast';
		case 'SoftwareSourceCode':
		case 'SoftwareApplication':
			return 'software';
		default:
			return undefined;
	}
}

function resolvePresentationFamily(input: {
	category?: string;
	schemaType?: string;
	canonicalUrl?: string;
}): ResolvedIdentity['presentationFamily'] {
	if (input.schemaType === 'WebSite') {
		return 'website';
	}

	switch (input.category) {
		case 'product':
			return 'product';
		case 'software':
			return 'software';
		case 'person':
			return 'person';
		case 'company':
			return 'company';
		case 'song':
			return 'song';
		case 'podcast':
			return 'generic';
	}

	if (isYouTubeUrl(input.canonicalUrl) || input.schemaType === 'VideoObject') {
		return 'video';
	}

	return 'generic';
}
