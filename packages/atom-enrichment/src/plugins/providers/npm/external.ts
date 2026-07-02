import { z } from 'zod/v4';

export const npmPersonResponseSchema = z
	.object({
		name: z.string().optional(),
	})
	.passthrough();

export const npmVersionInfoResponseSchema = z
	.object({
		description: z.string().optional(),
		keywords: z.array(z.string()).optional(),
		license: z.string().optional(),
		homepage: z.string().optional(),
		repository: z
			.union([z.string(), z.object({ url: z.string().optional() }).passthrough()])
			.optional(),
		author: z.union([z.string(), npmPersonResponseSchema]).optional(),
		maintainers: z.array(z.union([z.string(), npmPersonResponseSchema])).optional(),
	})
	.passthrough();

export const npmRegistryResponseSchema = z
	.object({
		name: z.string().optional(),
		'dist-tags': z
			.object({
				latest: z.string().optional(),
			})
			.passthrough()
			.optional(),
		versions: z.record(z.string(), npmVersionInfoResponseSchema).optional(),
	})
	.passthrough();

export const npmDownloadsResponseSchema = z
	.object({
		downloads: z.number().optional(),
	})
	.passthrough();

export type NpmVersionInfoResponse = z.infer<typeof npmVersionInfoResponseSchema>;
export type NpmRegistryResponse = z.infer<typeof npmRegistryResponseSchema>;
export type NpmDownloadsResponse = z.infer<typeof npmDownloadsResponseSchema>;
