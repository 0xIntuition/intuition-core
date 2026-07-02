import { z } from 'zod/v4';

export const podcastIndexDataSchema = z.object({
	podcastIndexId: z.number(),
	title: z.string(),
	feedUrl: z.string().url(),
	podcastGuid: z.string().optional(),
	link: z.string().url().optional(),
	description: z.string().optional(),
	author: z.string().optional(),
	ownerName: z.string().optional(),
	artworkUrl: z.string().url().optional(),
	itunesId: z.number().optional(),
	language: z.string().optional(),
	categories: z.array(z.string()).optional(),
	episodeCount: z.number().optional(),
});

export type PodcastIndexData = z.infer<typeof podcastIndexDataSchema>;
