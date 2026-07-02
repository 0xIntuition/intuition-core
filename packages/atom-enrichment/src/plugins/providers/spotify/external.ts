import { z } from 'zod/v4';

const nullableStringSchema = z.union([z.string(), z.null()]);

export const spotifyTokenResponseSchema = z
	.object({
		access_token: z.string().optional(),
		token_type: z.string().optional(),
		expires_in: z.number().optional(),
	})
	.passthrough();

export const spotifyImageResponseSchema = z
	.object({
		url: z.string().optional(),
	})
	.passthrough();

export const spotifyArtistResponseSchema = z
	.object({
		id: z.string().optional(),
		name: z.string().optional(),
		popularity: z.number().optional(),
		external_urls: z
			.object({
				spotify: z.string().optional(),
			})
			.passthrough()
			.optional(),
		images: z.array(spotifyImageResponseSchema).optional(),
		genres: z.array(z.string()).optional(),
	})
	.passthrough();

export const spotifyTrackAlbumResponseSchema = z
	.object({
		name: z.string().optional(),
		release_date: z.string().optional(),
		images: z.array(spotifyImageResponseSchema).optional(),
	})
	.passthrough();

export const spotifyTrackResponseSchema = z
	.object({
		id: z.string().optional(),
		name: z.string().optional(),
		preview_url: nullableStringSchema.optional(),
		duration_ms: z.number().optional(),
		popularity: z.number().optional(),
		external_urls: z
			.object({
				spotify: z.string().optional(),
			})
			.passthrough()
			.optional(),
		external_ids: z
			.object({
				isrc: z.string().optional(),
			})
			.passthrough()
			.optional(),
		artists: z.array(spotifyArtistResponseSchema).optional(),
		album: spotifyTrackAlbumResponseSchema.optional(),
	})
	.passthrough();

export const spotifyAlbumResponseSchema = z
	.object({
		id: z.string().optional(),
		name: z.string().optional(),
		popularity: z.number().optional(),
		release_date: z.string().optional(),
		external_urls: z
			.object({
				spotify: z.string().optional(),
			})
			.passthrough()
			.optional(),
		artists: z.array(spotifyArtistResponseSchema).optional(),
		images: z.array(spotifyImageResponseSchema).optional(),
		genres: z.array(z.string()).optional(),
	})
	.passthrough();

export const spotifyPlaylistResponseSchema = z
	.object({
		id: z.string().optional(),
		name: z.string().optional(),
		external_urls: z
			.object({
				spotify: z.string().optional(),
			})
			.passthrough()
			.optional(),
		images: z.array(spotifyImageResponseSchema).optional(),
	})
	.passthrough();

export const spotifyShowResponseSchema = z
	.object({
		id: z.string().optional(),
		name: z.string().optional(),
		description: z.string().optional(),
		html_description: z.string().optional(),
		external_urls: z
			.object({
				spotify: z.string().optional(),
			})
			.passthrough()
			.optional(),
		images: z.array(spotifyImageResponseSchema).optional(),
		publisher: z.string().optional(),
		total_episodes: z.number().optional(),
		languages: z.array(z.string()).optional(),
	})
	.passthrough();

export const spotifyEpisodeShowResponseSchema = z
	.object({
		id: z.string().optional(),
		name: z.string().optional(),
		external_urls: z
			.object({
				spotify: z.string().optional(),
			})
			.passthrough()
			.optional(),
	})
	.passthrough();

export const spotifyEpisodeResponseSchema = z
	.object({
		id: z.string().optional(),
		name: z.string().optional(),
		description: z.string().optional(),
		html_description: z.string().optional(),
		audio_preview_url: nullableStringSchema.optional(),
		duration_ms: z.number().optional(),
		release_date: z.string().optional(),
		external_urls: z
			.object({
				spotify: z.string().optional(),
			})
			.passthrough()
			.optional(),
		images: z.array(spotifyImageResponseSchema).optional(),
		show: spotifyEpisodeShowResponseSchema.optional(),
	})
	.passthrough();

export type SpotifyTokenResponse = z.infer<typeof spotifyTokenResponseSchema>;
export type SpotifyTrackResponse = z.infer<typeof spotifyTrackResponseSchema>;
export type SpotifyAlbumResponse = z.infer<typeof spotifyAlbumResponseSchema>;
export type SpotifyArtistResponse = z.infer<typeof spotifyArtistResponseSchema>;
export type SpotifyPlaylistResponse = z.infer<typeof spotifyPlaylistResponseSchema>;
export const spotifyOEmbedResponseSchema = z
	.object({
		title: z.string().optional(),
		thumbnail_url: z.string().optional(),
	})
	.passthrough();

export type SpotifyShowResponse = z.infer<typeof spotifyShowResponseSchema>;
export type SpotifyEpisodeResponse = z.infer<typeof spotifyEpisodeResponseSchema>;
