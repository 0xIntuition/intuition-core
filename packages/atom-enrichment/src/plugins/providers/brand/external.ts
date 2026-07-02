import { z } from 'zod/v4';

export const brandFetchLinkResponseSchema = z
	.object({
		name: z.string().optional(),
		url: z.string().optional(),
	})
	.passthrough();

export const brandFetchAssetFormatResponseSchema = z
	.object({
		src: z.string().optional(),
		background: z.string().nullable().optional(),
		format: z.string().optional(),
		height: z.number().nullable().optional(),
		width: z.number().nullable().optional(),
		size: z.number().nullable().optional(),
	})
	.passthrough();

export const brandFetchAssetResponseSchema = z
	.object({
		theme: z.string().optional(),
		formats: z.array(brandFetchAssetFormatResponseSchema).optional(),
		tags: z.array(z.string()).optional(),
		type: z.string().optional(),
	})
	.passthrough();

export const brandFetchColorResponseSchema = z
	.object({
		hex: z.string().optional(),
		type: z.string().optional(),
		brightness: z.number().optional(),
	})
	.passthrough();

export const brandFetchFontResponseSchema = z
	.object({
		name: z.string().optional(),
		type: z.string().optional(),
		origin: z.string().optional(),
		originId: z.string().nullable().optional(),
		weights: z.array(z.union([z.string(), z.number()])).optional(),
	})
	.passthrough();

export const brandFetchFontReferenceResponseSchema = z.union([
	z.string(),
	brandFetchFontResponseSchema,
]);

export const brandFetchIndustryParentResponseSchema = z
	.object({
		emoji: z.string().optional(),
		id: z.string().optional(),
		name: z.string().optional(),
		slug: z.string().optional(),
	})
	.passthrough();

export const brandFetchIndustryResponseSchema = z
	.object({
		score: z.number().optional(),
		id: z.string().optional(),
		name: z.string().optional(),
		emoji: z.string().optional(),
		parent: brandFetchIndustryParentResponseSchema.optional(),
		slug: z.string().optional(),
	})
	.passthrough();

export const brandFetchFinancialIdentifiersResponseSchema = z
	.object({
		isin: z.array(z.string()).optional(),
		ticker: z.array(z.string()).optional(),
	})
	.passthrough();

export const brandFetchCompanyLocationResponseSchema = z
	.object({
		city: z.string().optional(),
		country: z.string().optional(),
		countryCode: z.string().optional(),
		region: z.string().optional(),
		state: z.string().optional(),
		subregion: z.string().optional(),
	})
	.passthrough();

export const brandFetchCompanyResponseSchema = z
	.object({
		employees: z.number().optional(),
		financialIdentifiers: brandFetchFinancialIdentifiersResponseSchema.optional(),
		foundedYear: z.number().optional(),
		industries: z.array(brandFetchIndustryResponseSchema).optional(),
		kind: z.string().optional(),
		location: brandFetchCompanyLocationResponseSchema.optional(),
	})
	.passthrough();

export const brandFetchResponseSchema = z
	.object({
		id: z.string().optional(),
		brandId: z.string().optional(),
		name: z.string().optional(),
		domain: z.string().optional(),
		claimed: z.boolean().optional(),
		description: z.string().optional(),
		longDescription: z.string().optional(),
		links: z.array(brandFetchLinkResponseSchema).optional(),
		logos: z.array(brandFetchAssetResponseSchema).optional(),
		icons: z.array(brandFetchAssetResponseSchema).optional(),
		colors: z.array(brandFetchColorResponseSchema).optional(),
		fonts: z.array(brandFetchFontReferenceResponseSchema).optional(),
		fontDetails: z.array(brandFetchFontResponseSchema).optional(),
		images: z.array(brandFetchAssetResponseSchema).optional(),
		qualityScore: z.number().optional(),
		company: brandFetchCompanyResponseSchema.optional(),
		isNsfw: z.boolean().optional(),
		urn: z.string().optional(),
		logoUrl: z.string().optional(),
		iconUrl: z.string().optional(),
		primaryColor: z.string().optional(),
		secondaryColor: z.string().optional(),
	})
	.passthrough();

export type BrandFetchResponse = z.infer<typeof brandFetchResponseSchema>;
