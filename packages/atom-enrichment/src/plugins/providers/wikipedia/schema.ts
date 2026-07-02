import { z } from 'zod/v4';

export const wikipediaDataSchema = z.object({
	title: z.string(),
	extract: z.string(),
	extractHtml: z.string().optional(),
	thumbnailUrl: z.string().url().optional(),
	pageUrl: z.string().url(),
	pageId: z.number().optional(),
	language: z.string().default('en'),
	lastModified: z.string().optional(),
	wikibaseItem: z.string().optional(),
});

export type WikipediaData = z.infer<typeof wikipediaDataSchema>;
