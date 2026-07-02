import { z } from 'zod/v4';
import type { FetchLike } from '../plugins/providers/__shared__/http';
import { fetchJsonWithSchema } from '../plugins/providers/__shared__/http';

// Wikidata property ids used by deterministic field extractors.
export const WIKIDATA_PROPERTY = {
	givenName: 'P735',
	familyName: 'P734',
	birthDate: 'P569',
} as const;

const WIKIDATA_LABEL_BATCH_SIZE = 50;

const wikidataEntityIdSchema = z.object({
	'entity-type': z.string().optional(),
	id: z.string(),
});

const wikidataClaimSchema = z.object({
	mainsnak: z
		.object({
			datavalue: z
				.object({
					value: z.unknown(),
				})
				.optional(),
		})
		.optional(),
	rank: z.string().optional(),
});

const wikidataLabelsResponseSchema = z
	.object({
		entities: z
			.record(
				z.string(),
				z
					.object({
						labels: z.record(z.string(), z.object({ value: z.string() }).passthrough()).optional(),
					})
					.passthrough()
			)
			.optional(),
	})
	.passthrough();

function readClaimList(claims: unknown, propertyId: string): unknown[] {
	if (!claims || typeof claims !== 'object' || Array.isArray(claims)) {
		return [];
	}
	const list = (claims as Record<string, unknown>)[propertyId];
	return Array.isArray(list) ? list : [];
}

function orderedClaimValues(claims: unknown, propertyId: string): unknown[] {
	const parsed = readClaimList(claims, propertyId)
		.map((claim) => wikidataClaimSchema.safeParse(claim))
		.filter((result) => result.success)
		.map((result) => result.data);

	// Preferred-rank statements are the canonical values; deprecated ones are
	// excluded. Order is otherwise preserved as returned by Wikidata.
	const usable = parsed.filter((claim) => claim.rank !== 'deprecated');
	const preferred = usable.filter((claim) => claim.rank === 'preferred');
	const source = preferred.length > 0 ? preferred : usable;

	return source
		.map((claim) => claim.mainsnak?.datavalue?.value)
		.filter((value) => value !== undefined);
}

export function readEntityIdClaimValues(claims: unknown, propertyId: string): string[] {
	const ids: string[] = [];
	for (const value of orderedClaimValues(claims, propertyId)) {
		const parsed = wikidataEntityIdSchema.safeParse(value);
		if (parsed.success) {
			ids.push(parsed.data.id);
		}
	}
	return ids;
}

export function readStringClaimValues(claims: unknown, propertyId: string): string[] {
	const values: string[] = [];
	for (const value of orderedClaimValues(claims, propertyId)) {
		if (typeof value === 'string' && value.trim().length > 0) {
			values.push(value.trim());
		}
	}
	return values;
}

export function readQuantityClaimValue(claims: unknown, propertyId: string): number | undefined {
	for (const value of orderedClaimValues(claims, propertyId)) {
		const record =
			value && typeof value === 'object' && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: null;
		const amount = typeof record?.amount === 'string' ? Number(record.amount) : undefined;
		if (amount !== undefined && Number.isFinite(amount)) {
			return amount;
		}
	}
	return undefined;
}

export function readCoordinateClaimValue(
	claims: unknown,
	propertyId: string
): { latitude: number; longitude: number } | undefined {
	for (const value of orderedClaimValues(claims, propertyId)) {
		const record =
			value && typeof value === 'object' && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: null;
		const latitude = typeof record?.latitude === 'number' ? record.latitude : undefined;
		const longitude = typeof record?.longitude === 'number' ? record.longitude : undefined;
		if (latitude !== undefined && longitude !== undefined) {
			return { latitude, longitude };
		}
	}
	return undefined;
}

export function readTimeClaimValue(claims: unknown, propertyId: string): string | undefined {
	for (const value of orderedClaimValues(claims, propertyId)) {
		const record =
			value && typeof value === 'object' && !Array.isArray(value)
				? (value as Record<string, unknown>)
				: null;
		const time = typeof record?.time === 'string' ? record.time : undefined;
		const precision = typeof record?.precision === 'number' ? record.precision : 0;
		// Precision 11 is "day" in the Wikidata time model; coarser values
		// cannot be represented as an ISO date without fabricating detail.
		if (!time || precision < 11) continue;
		const match = /^\+(\d{4}-\d{2}-\d{2})T/.exec(time);
		if (match?.[1]) {
			return match[1];
		}
	}
	return undefined;
}

function pickLabel(
	labels: Record<string, { value: string }> | undefined,
	language: string
): string | undefined {
	if (!labels) return undefined;
	// `mul` is Wikidata's language-independent label; many name entities carry
	// only that (for example family names), so it is the standard fallback.
	const candidates = [language, 'en', 'mul'];
	for (const key of candidates) {
		const value = labels[key]?.value;
		if (value && value.trim().length > 0) {
			return value.trim();
		}
	}
	const first = Object.values(labels)[0]?.value;
	return first && first.trim().length > 0 ? first.trim() : undefined;
}

export async function resolveWikidataEntityLabels(
	fetcher: FetchLike,
	entityIds: readonly string[],
	options: { language?: string; signal?: AbortSignal } = {}
): Promise<Map<string, string>> {
	const language = options.language ?? 'en';
	const uniqueIds = [...new Set(entityIds.filter((id) => /^Q\d+$/i.test(id)))].map((id) =>
		id.toUpperCase()
	);
	const labels = new Map<string, string>();

	for (let index = 0; index < uniqueIds.length; index += WIKIDATA_LABEL_BATCH_SIZE) {
		const batch = uniqueIds.slice(index, index + WIKIDATA_LABEL_BATCH_SIZE);
		const endpoint = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${batch.join('|')}&props=labels&format=json&origin=*`;
		const payload = await fetchJsonWithSchema(fetcher, endpoint, wikidataLabelsResponseSchema, {
			signal: options.signal,
		});

		for (const [entityId, entity] of Object.entries(payload.entities ?? {})) {
			const label = pickLabel(entity.labels, language);
			if (label) {
				labels.set(entityId.toUpperCase(), label);
			}
		}
	}

	return labels;
}
