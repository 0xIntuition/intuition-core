import { z } from 'zod/v4';

export const faviconDataSchema = z.object({
	url: z.string().url(),
	type: z.string().optional(),
	sizes: z.string().optional(),
});

export type FaviconData = z.infer<typeof faviconDataSchema>;
