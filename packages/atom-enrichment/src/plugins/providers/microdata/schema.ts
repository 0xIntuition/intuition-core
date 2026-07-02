import { z } from 'zod/v4';

export const microdataDataSchema = z.object({
	url: z.string().url().optional(),
	title: z.string().optional(),
	description: z.string().optional(),
	mainEntity: z.string().optional(),
	imageUrl: z.string().url().optional(),
	jsonLd: z.array(z.record(z.string(), z.unknown())).optional(),
	microdata: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type MicrodataData = z.infer<typeof microdataDataSchema>;
