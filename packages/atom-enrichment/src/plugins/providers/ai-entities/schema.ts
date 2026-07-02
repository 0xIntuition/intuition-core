import { z } from 'zod/v4';

export const aiEntitiesDataSchema = z.object({
	entities: z.array(
		z.object({
			name: z.string(),
			type: z.string(),
			confidence: z.number(),
			wikidataId: z.string().optional(),
		})
	),
	model: z.string(),
	generatedAt: z.string(),
});

export type AiEntitiesData = z.infer<typeof aiEntitiesDataSchema>;
