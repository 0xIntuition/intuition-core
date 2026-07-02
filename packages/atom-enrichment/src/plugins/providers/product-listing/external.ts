import { z } from 'zod/v4';

const scalarOrRecordSchema = z.union([z.string(), z.number(), z.object({}).passthrough()]);

export const canopyAmazonProductSchema = z
	.object({
		title: z.string().optional(),
		brand: z.string().optional(),
		description: z.string().optional(),
		subtitle: z.string().optional(),
		currentPrice: scalarOrRecordSchema.optional(),
		price: scalarOrRecordSchema.optional(),
		currencyCode: z.string().optional(),
		currency: z.string().optional(),
		mainImageUrl: z.string().optional(),
		imageUrls: z.array(z.string()).optional(),
		rating: scalarOrRecordSchema.optional(),
		ratingValue: scalarOrRecordSchema.optional(),
		reviewCount: scalarOrRecordSchema.optional(),
		ratingsTotal: scalarOrRecordSchema.optional(),
		totalReviews: scalarOrRecordSchema.optional(),
		availability: z.string().optional(),
		availabilityText: z.string().optional(),
		availabilityStatus: z.string().optional(),
		asin: z.string().optional(),
		gtin: z.string().optional(),
		upc: z.string().optional(),
		ean: z.string().optional(),
		featureBullets: z.array(z.string()).optional(),
		url: z.string().optional(),
	})
	.passthrough();

export const canopyAmazonProductResponseSchema = z
	.object({
		data: z
			.object({
				amazonProduct: canopyAmazonProductSchema.optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

export type CanopyAmazonProduct = z.infer<typeof canopyAmazonProductSchema>;
export type CanopyAmazonProductResponse = z.infer<typeof canopyAmazonProductResponseSchema>;
