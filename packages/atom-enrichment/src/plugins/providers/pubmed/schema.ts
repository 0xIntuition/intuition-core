import { z } from 'zod/v4';

export const pubmedDataSchema = z.object({
	pmid: z.string(),
	title: z.string(),
	authors: z.array(z.string()).optional(),
	journal: z.string().optional(),
	publishedDate: z.string().optional(),
	abstract: z.string().optional(),
	doi: z.string().optional(),
	url: z.string().url().optional(),
	meshTerms: z.array(z.string()).optional(),
});

export type PubmedData = z.infer<typeof pubmedDataSchema>;
