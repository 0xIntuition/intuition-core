import { z } from 'zod/v4';

export const wikidataDataSchema = z.object({
	entityId: z.string(),
	label: z.string(),
	description: z.string().optional(),
	aliases: z.array(z.string()).optional(),
	claims: z.record(z.string(), z.unknown()).optional(),
	sitelinks: z.record(z.string(), z.string().url()).optional(),
	instanceOf: z.array(z.string()).optional(),
});

export type WikidataData = z.infer<typeof wikidataDataSchema>;
