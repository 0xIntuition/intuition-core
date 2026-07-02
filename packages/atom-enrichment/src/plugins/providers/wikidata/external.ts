import { z } from 'zod/v4';

export const wikidataSearchResultResponseSchema = z
	.object({
		id: z.string().optional(),
	})
	.passthrough();

export const wikidataSearchResponseSchema = z
	.object({
		search: z.array(wikidataSearchResultResponseSchema).optional(),
	})
	.passthrough();

export const wikidataMonolingualValueResponseSchema = z
	.object({
		value: z.string().optional(),
	})
	.passthrough();

export const wikidataClaimResponseSchema = z
	.object({
		mainsnak: z
			.object({
				datavalue: z
					.object({
						// Wikidata claim values are genuinely polymorphic across properties:
						// entity refs, strings, quantities, times, URLs, media titles, and more.
						value: z.unknown().optional(),
					})
					.passthrough()
					.optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

export const wikidataSitelinkResponseSchema = z
	.object({
		site: z.string().optional(),
		title: z.string().optional(),
		url: z.string().optional(),
	})
	.passthrough();

export const wikidataEntityResponseSchema = z
	.object({
		id: z.string().optional(),
		labels: z.record(z.string(), wikidataMonolingualValueResponseSchema).optional(),
		descriptions: z.record(z.string(), wikidataMonolingualValueResponseSchema).optional(),
		aliases: z.record(z.string(), z.array(wikidataMonolingualValueResponseSchema)).optional(),
		claims: z.record(z.string(), z.array(wikidataClaimResponseSchema)).optional(),
		sitelinks: z.record(z.string(), wikidataSitelinkResponseSchema).optional(),
	})
	.passthrough();

export const wikidataEntityLookupResponseSchema = z
	.object({
		entities: z.record(z.string(), wikidataEntityResponseSchema).optional(),
	})
	.passthrough();

export type WikidataSearchResponse = z.infer<typeof wikidataSearchResponseSchema>;
export type WikidataMonolingualValueResponse = z.infer<
	typeof wikidataMonolingualValueResponseSchema
>;
export type WikidataClaimResponse = z.infer<typeof wikidataClaimResponseSchema>;
export type WikidataEntityResponse = z.infer<typeof wikidataEntityResponseSchema>;
export type WikidataEntityLookupResponse = z.infer<typeof wikidataEntityLookupResponseSchema>;
