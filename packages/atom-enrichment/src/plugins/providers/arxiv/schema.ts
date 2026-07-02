import { z } from 'zod/v4';

export const arxivDataSchema = z.object({
	arxivId: z.string(),
	title: z.string(),
	authors: z.array(z.string()),
	summary: z.string().optional(),
	publishedDate: z.string().optional(),
	updatedDate: z.string().optional(),
	categories: z.array(z.string()).optional(),
	pdfUrl: z.string().url().optional(),
	doi: z.string().optional(),
	comment: z.string().optional(),
});

export type ArxivData = z.infer<typeof arxivDataSchema>;
