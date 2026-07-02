import { z } from 'zod/v4';

export const oembedDataSchema = z.object({
	type: z.enum(['photo', 'video', 'link', 'rich']),
	title: z.string().optional(),
	authorName: z.string().optional(),
	authorUrl: z.string().url().optional(),
	providerName: z.string().optional(),
	providerUrl: z.string().url().optional(),
	thumbnailUrl: z.string().url().optional(),
	thumbnailWidth: z.number().optional(),
	thumbnailHeight: z.number().optional(),
	html: z.string().optional(),
	width: z.number().optional(),
	height: z.number().optional(),
	url: z.string().url().optional(),
});

export type OEmbedData = z.infer<typeof oembedDataSchema>;
