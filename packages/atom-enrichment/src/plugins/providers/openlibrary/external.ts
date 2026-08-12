import { z } from 'zod/v4';

const openLibraryNamedValueSchema = z.object({ name: z.string().optional() }).passthrough();
const openLibraryAuthorLinkSchema = z.object({ key: z.string().optional() }).passthrough();
const openLibraryWorkAuthorSchema = z
	.object({ author: openLibraryAuthorLinkSchema.optional() })
	.passthrough();
const openLibraryDescriptionSchema = z.union([
	z.string(),
	z.object({ value: z.string().optional() }).passthrough(),
]);

export const openLibraryBooksApiEntrySchema = z
	.object({
		key: z.string().optional(),
		title: z.string().optional(),
		authors: z.array(openLibraryNamedValueSchema).optional(),
		publishers: z.array(openLibraryNamedValueSchema).optional(),
		publish_date: z.string().optional(),
		number_of_pages: z.number().optional(),
		cover: z
			.object({
				small: z.string().optional(),
				medium: z.string().optional(),
				large: z.string().optional(),
			})
			.passthrough()
			.optional(),
		subjects: z.array(openLibraryNamedValueSchema).optional(),
		identifiers: z.record(z.string(), z.array(z.string())).optional(),
	})
	.passthrough();

export const openLibraryBooksApiResponseSchema = z
	.record(z.string(), openLibraryBooksApiEntrySchema)
	.default({});

export const openLibraryEntityResponseSchema = z
	.object({
		key: z.string().optional(),
		title: z.string().optional(),
		name: z.string().optional(),
		personal_name: z.string().optional(),
		description: openLibraryDescriptionSchema.optional(),
		bio: openLibraryDescriptionSchema.optional(),
		publish_date: z.string().optional(),
		publishers: z.array(z.string()).optional(),
		number_of_pages: z.number().optional(),
		covers: z.array(z.number()).optional(),
		photos: z.array(z.number()).optional(),
		subjects: z.array(z.string()).optional(),
		isbn_10: z.array(z.string()).optional(),
		isbn_13: z.array(z.string()).optional(),
		authors: z
			.array(z.union([openLibraryAuthorLinkSchema, openLibraryWorkAuthorSchema]))
			.optional(),
	})
	.passthrough();

export type OpenLibraryBooksApiEntry = z.infer<typeof openLibraryBooksApiEntrySchema>;
export type OpenLibraryEntityResponse = z.infer<typeof openLibraryEntityResponseSchema>;
