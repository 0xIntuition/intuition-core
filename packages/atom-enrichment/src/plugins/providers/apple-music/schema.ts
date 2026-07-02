import { z } from 'zod/v4';

export const appleMusicDataSchema = z.object({
	name: z.string(),
	type: z.enum(['song', 'album', 'artist', 'podcast']),
	appleMusicId: z.string(),
	appleMusicUrl: z.string().url(),
	artworkUrl: z.string().url().optional(),
	previewUrl: z.string().url().optional(),
	artistName: z.string().optional(),
	albumName: z.string().optional(),
	releaseDate: z.string().optional(),
	durationMs: z.number().optional(),
	isrc: z.string().optional(),
	genres: z.array(z.string()).optional(),
	feedUrl: z.string().url().optional(),
});

export type AppleMusicData = z.infer<typeof appleMusicDataSchema>;
