import { z } from 'zod/v4';

export const wikipediaSummaryResponseSchema = z
	.object({
		title: z.string().optional(),
		extract: z.string().optional(),
		extract_html: z.string().nullable().optional(),
		thumbnail: z
			.object({
				source: z.string().optional(),
			})
			.passthrough()
			.optional(),
		content_urls: z
			.object({
				desktop: z.object({ page: z.string().optional() }).passthrough().optional(),
				mobile: z.object({ page: z.string().optional() }).passthrough().optional(),
			})
			.passthrough()
			.optional(),
		pageid: z.number().optional(),
		lang: z.string().optional(),
		timestamp: z.string().optional(),
		wikibase_item: z.string().optional(),
	})
	.passthrough();

export type WikipediaSummaryResponse = z.infer<typeof wikipediaSummaryResponseSchema>;
