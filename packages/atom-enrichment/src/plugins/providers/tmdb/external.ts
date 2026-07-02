import { z } from 'zod/v4';

export const tmdbGenreResponseSchema = z
	.object({
		name: z.string().optional(),
	})
	.passthrough();

export const tmdbDetailsResponseSchema = z
	.object({
		id: z.number().optional(),
		title: z.string().optional(),
		name: z.string().optional(),
		overview: z.string().nullable().optional(),
		poster_path: z.string().nullable().optional(),
		backdrop_path: z.string().nullable().optional(),
		release_date: z.string().nullable().optional(),
		first_air_date: z.string().nullable().optional(),
		vote_average: z.number().nullable().optional(),
		genres: z.array(tmdbGenreResponseSchema).optional(),
		runtime: z.number().nullable().optional(),
		episode_run_time: z.array(z.number()).optional(),
		imdb_id: z.string().nullable().optional(),
	})
	.passthrough();

export type TmdbDetailsResponse = z.infer<typeof tmdbDetailsResponseSchema>;
