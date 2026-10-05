import { z } from 'zod/v4';

// Malformed optional IDs must not discard otherwise usable provider metadata.
// Preserve valid strings exactly, including their leading zeroes.
export const spotifyExternalIdentifierSchema = z.preprocess(
	(value) => (typeof value === 'string' && value.trim().length > 0 ? value : undefined),
	z.string().optional()
);

export const spotifyDataSchema = z.object({
	name: z.string(),
	type: z.enum(['track', 'album', 'artist', 'playlist', 'show', 'episode']),
	spotifyId: z.string(),
	spotifyUrl: z.string().url(),
	spotifyApiPayload: z.record(z.string(), z.unknown()).optional(),
	previewUrl: z.string().url().optional(),
	imageUrl: z.string().url().optional(),
	artists: z.array(z.object({ name: z.string(), spotifyId: z.string() })).optional(),
	albumName: z.string().optional(),
	showName: z.string().optional(),
	publisher: z.string().optional(),
	description: z.string().optional(),
	releaseDate: z.string().optional(),
	durationMs: z.number().optional(),
	popularity: z.number().optional(),
	isrc: spotifyExternalIdentifierSchema,
	upc: spotifyExternalIdentifierSchema,
	ean: spotifyExternalIdentifierSchema,
	genres: z.array(z.string()).optional(),
	totalEpisodes: z.number().optional(),
	languages: z.array(z.string()).optional(),
	showSpotifyId: z.string().optional(),
	showSpotifyUrl: z.string().url().optional(),
});

export type SpotifyData = z.infer<typeof spotifyDataSchema>;
