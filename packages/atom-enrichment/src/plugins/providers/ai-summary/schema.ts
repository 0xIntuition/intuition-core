import { z } from 'zod/v4';

export const aiSummaryDataSchema = z.object({
	summary: z.string(),
	model: z.string(),
	tokenCount: z.number().optional(),
	generatedAt: z.string(),
});

export type AiSummaryData = z.infer<typeof aiSummaryDataSchema>;
