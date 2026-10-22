import { readEntityIdClaimValues } from '../../../extraction/wikidata-claims';
import type { EnrichmentIdentityCapability, EnrichmentPluginLogger } from '../../../plugins';
import { wikidataEntityLookupResponseSchema } from '../wikidata/external';
import { type FetchLike, fetchJsonWithSchema } from './http';

// Schema.org vocabulary families, independent of the module's P31 identity policy.
const TYPE_FAMILIES = [
	['TVSeries', 'TVSeason', 'TVEpisode'],
	['MusicAlbum', 'MusicRecording'],
	['Person', 'Organization', 'MusicGroup'],
] as const;

export function schemaTypesAgree(expected: unknown, actual: string): boolean {
	const types = Array.isArray(expected) ? expected : [expected];
	return types.some(
		(type) =>
			typeof type === 'string' &&
			(type === actual ||
				TYPE_FAMILIES.some(
					(family) =>
						family.some((member) => member === type) && family.some((member) => member === actual)
				))
	);
}

export function wikidataTypeAgreement(
	claims: unknown,
	expected: unknown,
	identity?: EnrichmentIdentityCapability,
	logger?: EnrichmentPluginLogger,
	signal?: AbortSignal
): 'agree' | 'mismatch' | 'unknown' {
	const expectedTypes = Array.isArray(expected) ? expected : [expected];
	if (
		!identity ||
		!expectedTypes.some((type) => typeof type === 'string' && type.length > 0 && type !== 'Thing')
	) {
		return 'unknown';
	}
	let schemaType: string | undefined;
	try {
		schemaType = identity.resolveWikidataSchemaType(readEntityIdClaimValues(claims, 'P31'));
	} catch (error) {
		if (signal?.aborted) throw error;
		logger?.warn('Wikidata type resolver failed.', {
			error: error instanceof Error ? error.message : String(error),
		});
		return 'unknown';
	}
	if (!schemaType || schemaType === 'Thing') return 'unknown';
	return schemaTypesAgree(expected, schemaType) ? 'agree' : 'mismatch';
}

/** Reuse the providers' injected, schema-validated Wikidata entity-data path. */
export async function fetchWikidataEntity(
	fetcher: FetchLike,
	entityId: string,
	signal: AbortSignal
) {
	const payload = await fetchJsonWithSchema(
		fetcher,
		`https://www.wikidata.org/wiki/Special:EntityData/${encodeURIComponent(entityId)}.json`,
		wikidataEntityLookupResponseSchema,
		{ signal }
	);
	return payload.entities?.[entityId];
}
