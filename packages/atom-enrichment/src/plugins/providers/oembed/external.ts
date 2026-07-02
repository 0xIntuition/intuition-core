import { z } from 'zod/v4';

const numericResponseSchema = z.union([z.number(), z.string()]);

export const oembedResponseSchema = z
	.object({
		type: z.enum(['photo', 'video', 'link', 'rich']),
		title: z.string().optional(),
		author_name: z.string().optional(),
		author_url: z.string().optional(),
		provider_name: z.string().optional(),
		provider_url: z.string().optional(),
		thumbnail_url: z.string().optional(),
		thumbnail_width: numericResponseSchema.optional(),
		thumbnail_height: numericResponseSchema.optional(),
		html: z.string().optional(),
		width: numericResponseSchema.optional(),
		height: numericResponseSchema.optional(),
		url: z.string().optional(),
	})
	.passthrough();

export type OEmbedResponse = z.infer<typeof oembedResponseSchema>;
