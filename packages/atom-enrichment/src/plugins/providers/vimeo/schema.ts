import { z } from 'zod/v4';

export const vimeoDataSchema = z.object({
	videoId: z.string(),
	title: z.string(),
	description: z.string().optional(),
	channelName: z.string().optional(),
	channelUrl: z.string().url().optional(),
	publishedAt: z.string().optional(),
	thumbnailUrl: z.string().url().optional(),
	duration: z.number().optional(),
	viewCount: z.number().optional(),
	likeCount: z.number().optional(),
	embedHtml: z.string().optional(),
});

export type VimeoData = z.infer<typeof vimeoDataSchema>;
