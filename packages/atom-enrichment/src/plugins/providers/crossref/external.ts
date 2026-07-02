import { z } from 'zod/v4';

export const crossrefAuthorResponseSchema = z
	.object({
		given: z.string().optional(),
		family: z.string().optional(),
	})
	.passthrough();

export const crossrefDatePartsResponseSchema = z
	.object({
		'date-parts': z.array(z.array(z.number())).optional(),
	})
	.passthrough();

export const crossrefMessageResponseSchema = z
	.object({
		DOI: z.string().optional(),
		title: z.array(z.string()).optional(),
		author: z.array(crossrefAuthorResponseSchema).optional(),
		issued: crossrefDatePartsResponseSchema.optional(),
		'published-print': crossrefDatePartsResponseSchema.optional(),
		'container-title': z.array(z.string()).optional(),
		publisher: z.string().optional(),
		abstract: z.string().nullable().optional(),
		URL: z.string().optional(),
		type: z.string().optional(),
		'is-referenced-by-count': z.number().optional(),
	})
	.passthrough();

export const crossrefResponseSchema = z
	.object({
		message: crossrefMessageResponseSchema.optional(),
	})
	.passthrough();

export type CrossrefAuthorResponse = z.infer<typeof crossrefAuthorResponseSchema>;
export type CrossrefMessageResponse = z.infer<typeof crossrefMessageResponseSchema>;
export type CrossrefResponse = z.infer<typeof crossrefResponseSchema>;
