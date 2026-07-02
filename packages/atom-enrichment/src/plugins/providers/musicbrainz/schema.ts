import { z } from 'zod/v4';

export const musicbrainzDataSchema = z.object({
	mbid: z.string(),
	name: z.string(),
	type: z.string(),
	disambiguation: z.string().optional(),
	isrcs: z.array(z.string()).optional(),
	releaseDate: z.string().optional(),
	artistCredit: z.string().optional(),
	tags: z.array(z.string()).optional(),
});

export type MusicBrainzData = z.infer<typeof musicbrainzDataSchema>;
