import { z } from 'zod/v4';

export const musicBrainzArtistCreditResponseSchema = z
	.object({
		name: z.string().optional(),
	})
	.passthrough();

export const musicBrainzTagResponseSchema = z
	.object({
		name: z.string().optional(),
	})
	.passthrough();

export const musicBrainzRecordingResponseSchema = z
	.object({
		id: z.string().optional(),
		title: z.string().optional(),
		disambiguation: z.string().optional(),
		isrcs: z.array(z.string()).optional(),
		'first-release-date': z.string().optional(),
		'artist-credit': z.array(musicBrainzArtistCreditResponseSchema).optional(),
		tags: z.array(musicBrainzTagResponseSchema).optional(),
	})
	.passthrough();

export const musicBrainzSearchResponseSchema = z
	.object({
		recordings: z.array(musicBrainzRecordingResponseSchema).optional(),
	})
	.passthrough();

export type MusicBrainzRecordingResponse = z.infer<typeof musicBrainzRecordingResponseSchema>;
export type MusicBrainzSearchResponse = z.infer<typeof musicBrainzSearchResponseSchema>;
