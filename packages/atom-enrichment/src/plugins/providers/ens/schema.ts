import { z } from 'zod/v4';

export const ensDataSchema = z.object({
	name: z.string(),
	address: z.string(),
	avatarUrl: z.string().url().optional(),
	contentHash: z.string().optional(),
	textRecords: z.record(z.string(), z.string()).optional(),
	expiryDate: z.string().optional(),
});

export type EnsData = z.infer<typeof ensDataSchema>;
