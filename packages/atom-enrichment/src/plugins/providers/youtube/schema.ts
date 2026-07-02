import { z } from 'zod/v4';

export const youtubeDataSchema = z.object({
	videoId: z.string(),
	title: z.string(),
	description: z.string().optional(),
	channelTitle: z.string().optional(),
	channelId: z.string().optional(),
	publishedAt: z.string().optional(),
	thumbnailUrl: z.string().url().optional(),
	duration: z.string().optional(),
	viewCount: z.number().optional(),
	likeCount: z.number().optional(),
	tags: z.array(z.string()).optional(),
	embedHtml: z.string().optional(),
});

export type YouTubeData = z.infer<typeof youtubeDataSchema>;
