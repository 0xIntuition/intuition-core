import { z } from 'zod/v4';

export const productListingDataSchema = z.object({
	name: z.string(),
	brand: z.string().optional(),
	description: z.string().optional(),
	price: z.string().optional(),
	currency: z.string().optional(),
	imageUrl: z.string().url().optional(),
	rating: z.number().optional(),
	reviewCount: z.number().optional(),
	availability: z.string().optional(),
	sku: z.string().optional(),
	gtin: z.string().optional(),
});

export type ProductListingData = z.infer<typeof productListingDataSchema>;
