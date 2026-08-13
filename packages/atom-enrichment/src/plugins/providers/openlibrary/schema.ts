import { z } from 'zod/v4';

export const openLibraryDataSchema = z
	.object({
		identifier: z.string().min(1),
		identifierType: z.enum(['isbn', 'olid']),
		entityType: z.enum(['book', 'edition', 'work', 'author']),
		isbn: z.string().optional(),
		olid: z.string().optional(),
		title: z.string().min(1),
		authors: z.array(z.string()).optional(),
		authorOlids: z.array(z.string()).optional(),
		publisher: z.string().optional(),
		publishedDate: z.string().optional(),
		pageCount: z.number().int().nonnegative().optional(),
		coverUrl: z.string().url().optional(),
		description: z.string().optional(),
		subjects: z.array(z.string()).optional(),
		sourceUrl: z.string().url(),
	})
	.strict();

export type OpenLibraryData = z.infer<typeof openLibraryDataSchema>;
