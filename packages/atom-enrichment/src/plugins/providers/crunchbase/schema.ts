import { z } from 'zod/v4';

export const crunchbaseDataSchema = z.object({
	name: z.string(),
	shortDescription: z.string().optional(),
	foundedOn: z.string().optional(),
	numEmployeesEnum: z.string().optional(),
	totalFundingUsd: z.number().optional(),
	lastFundingType: z.string().optional(),
	lastFundingDate: z.string().optional(),
	categories: z.array(z.string()).optional(),
	headquarters: z.string().optional(),
	website: z.string().url().optional(),
	logoUrl: z.string().url().optional(),
	crunchbaseUrl: z.string().url().optional(),
});

export type CrunchbaseData = z.infer<typeof crunchbaseDataSchema>;
