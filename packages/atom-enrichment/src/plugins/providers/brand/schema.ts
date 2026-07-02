import { z } from 'zod/v4';

const brandLinkSchema = z.object({
	name: z.string().optional(),
	url: z.string().url(),
});

const brandAssetFormatSchema = z.object({
	src: z.string().url(),
	background: z.string().nullable().optional(),
	format: z.string().optional(),
	height: z.number().nullable().optional(),
	width: z.number().nullable().optional(),
	size: z.number().nullable().optional(),
});

const brandAssetSchema = z.object({
	theme: z.string().optional(),
	formats: z.array(brandAssetFormatSchema).optional(),
	tags: z.array(z.string()).optional(),
	type: z.string().optional(),
});

const brandColorSchema = z.object({
	hex: z.string(),
	type: z.string().optional(),
	brightness: z.number().optional(),
});

const brandFontSchema = z.object({
	name: z.string().optional(),
	type: z.string().optional(),
	origin: z.string().optional(),
	originId: z.string().nullable().optional(),
	weights: z.array(z.union([z.string(), z.number()])).optional(),
});

const brandIndustryParentSchema = z.object({
	emoji: z.string().optional(),
	id: z.string().optional(),
	name: z.string().optional(),
	slug: z.string().optional(),
});

const brandIndustrySchema = z.object({
	score: z.number().optional(),
	id: z.string().optional(),
	name: z.string().optional(),
	emoji: z.string().optional(),
	parent: brandIndustryParentSchema.optional(),
	slug: z.string().optional(),
});

const brandFinancialIdentifiersSchema = z.object({
	isin: z.array(z.string()).optional(),
	ticker: z.array(z.string()).optional(),
});

const brandCompanyLocationSchema = z.object({
	city: z.string().optional(),
	country: z.string().optional(),
	countryCode: z.string().optional(),
	region: z.string().optional(),
	state: z.string().optional(),
	subregion: z.string().optional(),
});

const brandCompanySchema = z.object({
	employees: z.number().optional(),
	financialIdentifiers: brandFinancialIdentifiersSchema.optional(),
	foundedYear: z.number().optional(),
	industries: z.array(brandIndustrySchema).optional(),
	kind: z.string().optional(),
	location: brandCompanyLocationSchema.optional(),
});

export const brandDataSchema = z.object({
	brandId: z.string().optional(),
	name: z.string().optional(),
	domain: z.string().optional(),
	claimed: z.boolean().optional(),
	description: z.string().optional(),
	longDescription: z.string().optional(),
	links: z.array(brandLinkSchema).optional(),
	logos: z.array(brandAssetSchema).optional(),
	icons: z.array(brandAssetSchema).optional(),
	images: z.array(brandAssetSchema).optional(),
	colors: z.array(brandColorSchema).optional(),
	fontDetails: z.array(brandFontSchema).optional(),
	qualityScore: z.number().optional(),
	company: brandCompanySchema.optional(),
	isNsfw: z.boolean().optional(),
	urn: z.string().optional(),
	logoUrl: z.string().url().optional(),
	iconUrl: z.string().url().optional(),
	primaryColor: z.string().optional(),
	secondaryColor: z.string().optional(),
	fonts: z.array(z.string()).optional(),
});

export type BrandData = z.infer<typeof brandDataSchema>;
