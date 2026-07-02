import { z } from 'zod/v4';

export const tmdbDataSchema = z.object({
	tmdbId: z.number(),
	mediaType: z.enum(['movie', 'tv']),
	title: z.string(),
	overview: z.string().optional(),
	posterUrl: z.string().url().optional(),
	backdropUrl: z.string().url().optional(),
	releaseDate: z.string().optional(),
	voteAverage: z.number().optional(),
	genres: z.array(z.string()).optional(),
	runtime: z.number().optional(),
	imdbId: z.string().optional(),
});

export type TmdbData = z.infer<typeof tmdbDataSchema>;
