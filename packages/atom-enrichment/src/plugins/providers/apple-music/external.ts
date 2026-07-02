import { z } from 'zod/v4';

export const itunesLookupResponseSchema = z
	.object({
		resultCount: z.number().optional(),
		results: z
			.array(
				z
					.object({
						wrapperType: z.string().optional(),
						kind: z.string().optional(),
						trackId: z.number().optional(),
						collectionId: z.number().optional(),
						artistId: z.number().optional(),
						trackName: z.string().optional(),
						collectionName: z.string().optional(),
						artistName: z.string().optional(),
						trackViewUrl: z.string().optional(),
						collectionViewUrl: z.string().optional(),
						artistLinkUrl: z.string().optional(),
						artworkUrl100: z.string().optional(),
						previewUrl: z.string().optional(),
						releaseDate: z.string().optional(),
						trackTimeMillis: z.number().optional(),
						primaryGenreName: z.string().optional(),
						feedUrl: z.string().optional(),
					})
					.passthrough()
			)
			.optional(),
	})
	.passthrough();

export type ItunesLookupResponse = z.infer<typeof itunesLookupResponseSchema>;
