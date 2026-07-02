import { z } from 'zod/v4';

export const redditPostDataSchema = z.object({
	postId: z.string(),
	title: z.string(),
	subreddit: z.string(),
	author: z.string().optional(),
	score: z.number().optional(),
	numComments: z.number().optional(),
	url: z.string().url().optional(),
	permalink: z.string().optional(),
	createdAt: z.string().optional(),
	isNsfw: z.boolean().optional(),
});

export type RedditPostData = z.infer<typeof redditPostDataSchema>;
