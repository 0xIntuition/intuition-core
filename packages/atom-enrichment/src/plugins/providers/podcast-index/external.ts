import { z } from 'zod/v4';

const podcastIndexFeedSchema = z
	.object({
		id: z.number(),
		podcastGuid: z.string().optional(),
		title: z.string().optional(),
		url: z.string().optional(),
		link: z.string().optional(),
		description: z.string().optional(),
		author: z.string().optional(),
		ownerName: z.string().optional(),
		image: z.string().optional(),
		artwork: z.string().optional(),
		itunesId: z.number().nullable().optional(),
		language: z.string().optional(),
		episodeCount: z.number().optional(),
		// Categories arrive as an id → name map, e.g. { "55": "News" }.
		categories: z.record(z.string(), z.string()).nullable().optional(),
	})
	.passthrough();

export const podcastIndexFeedResponseSchema = z
	.object({
		status: z.union([z.string(), z.boolean()]).optional(),
		feed: z.union([podcastIndexFeedSchema, z.array(z.unknown())]).optional(),
	})
	.passthrough();

export type PodcastIndexFeed = z.infer<typeof podcastIndexFeedSchema>;
export type PodcastIndexFeedResponse = z.infer<typeof podcastIndexFeedResponseSchema>;
