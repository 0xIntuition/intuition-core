import { z } from 'zod/v4';

export const xPublicMetricsResponseSchema = z
	.object({
		followers_count: z.number().optional(),
		following_count: z.number().optional(),
		tweet_count: z.number().optional(),
	})
	.passthrough();

export const xUserLookupUserSchema = z
	.object({
		username: z.string().optional(),
		name: z.string().optional(),
		description: z.string().optional(),
		profile_banner_url: z.string().optional(),
		profile_image_url: z.string().optional(),
		public_metrics: xPublicMetricsResponseSchema.optional(),
		verified: z.boolean().optional(),
		created_at: z.string().optional(),
	})
	.passthrough();

export const xUserLookupResponseSchema = z
	.object({
		data: xUserLookupUserSchema.optional(),
	})
	.passthrough();

export type XPublicMetricsResponse = z.infer<typeof xPublicMetricsResponseSchema>;
export type XUserLookupUser = z.infer<typeof xUserLookupUserSchema>;
export type XUserLookupResponse = z.infer<typeof xUserLookupResponseSchema>;
