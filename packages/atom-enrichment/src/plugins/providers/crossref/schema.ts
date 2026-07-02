import { z } from 'zod/v4';

export const doiDataSchema = z.object({
	doi: z.string(),
	title: z.string(),
	authors: z.array(z.object({ given: z.string().optional(), family: z.string() })).optional(),
	publishedDate: z.string().optional(),
	journal: z.string().optional(),
	publisher: z.string().optional(),
	abstract: z.string().optional(),
	url: z.string().url(),
	type: z.string().optional(),
	citationCount: z.number().optional(),
});

export type DoiData = z.infer<typeof doiDataSchema>;
