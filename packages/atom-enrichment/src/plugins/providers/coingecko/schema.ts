import { z } from 'zod/v4';

export const tokenMetadataDataSchema = z.object({
	address: z.string(),
	name: z.string(),
	symbol: z.string(),
	decimals: z.number(),
	totalSupply: z.string().optional(),
	logoUrl: z.string().url().optional(),
	website: z.string().url().optional(),
	coingeckoId: z.string().optional(),
	priceUsd: z.number().optional(),
	marketCapUsd: z.number().optional(),
	coingeckoApiPayload: z.record(z.string(), z.unknown()).optional(),
	lookupStatus: z.enum(['resolved', 'not_found', 'error']).optional(),
	lookupMessage: z.string().optional(),
	coingeckoLookupEndpoint: z.string().url().optional(),
});

export type TokenMetadataData = z.infer<typeof tokenMetadataDataSchema>;
