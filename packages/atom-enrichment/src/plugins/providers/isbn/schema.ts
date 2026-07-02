import { z } from 'zod/v4';

export const isbnDataSchema = z.object({
	isbn: z.string(),
	title: z.string(),
	authors: z.array(z.string()).optional(),
	publisher: z.string().optional(),
	publishedDate: z.string().optional(),
	pageCount: z.number().optional(),
	coverUrl: z.string().url().optional(),
	description: z.string().optional(),
	subjects: z.array(z.string()).optional(),
});

export type IsbnData = z.infer<typeof isbnDataSchema>;
