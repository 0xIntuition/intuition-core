import { z } from 'zod/v4';

export const nftMetadataDataSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	imageUrl: z.string().url().optional(),
	animationUrl: z.string().url().optional(),
	externalUrl: z.string().url().optional(),
	contractAddress: z.string(),
	tokenId: z.string(),
	tokenStandard: z.string().optional(),
	attributes: z
		.array(z.object({ traitType: z.string(), value: z.union([z.string(), z.number()]) }))
		.optional(),
	collectionName: z.string().optional(),
});

export type NftMetadataData = z.infer<typeof nftMetadataDataSchema>;
