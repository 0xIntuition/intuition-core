import { z } from 'zod/v4';

export const youTubeThumbnailResponseSchema = z
	.object({
		url: z.string().optional(),
	})
	.passthrough();

export const youTubeVideoItemResponseSchema = z
	.object({
		id: z.string().optional(),
		snippet: z
			.object({
				title: z.string().optional(),
				description: z.string().optional(),
				channelTitle: z.string().optional(),
				channelId: z.string().optional(),
				publishedAt: z.string().optional(),
				thumbnails: z
					.object({
						default: youTubeThumbnailResponseSchema.optional(),
						medium: youTubeThumbnailResponseSchema.optional(),
						high: youTubeThumbnailResponseSchema.optional(),
					})
					.passthrough()
					.optional(),
				tags: z.array(z.string()).optional(),
			})
			.passthrough()
			.optional(),
		contentDetails: z
			.object({
				duration: z.string().optional(),
			})
			.passthrough()
			.optional(),
		statistics: z
			.object({
				viewCount: z.string().optional(),
				likeCount: z.string().optional(),
			})
			.passthrough()
			.optional(),
		player: z
			.object({
				embedHtml: z.string().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

export const youTubeVideoResponseSchema = z
	.object({
		items: z.array(youTubeVideoItemResponseSchema).optional(),
	})
	.passthrough();

export type YouTubeVideoItemResponse = z.infer<typeof youTubeVideoItemResponseSchema>;
export type YouTubeVideoResponse = z.infer<typeof youTubeVideoResponseSchema>;
