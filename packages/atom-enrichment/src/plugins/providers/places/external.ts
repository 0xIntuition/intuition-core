import { z } from 'zod/v4';

const placeResultSchema = z
	.object({
		id: z.string().optional(),
		displayName: z.object({ text: z.string().optional() }).passthrough().optional(),
		formattedAddress: z.string().optional(),
		location: z
			.object({
				latitude: z.number().optional(),
				longitude: z.number().optional(),
			})
			.passthrough()
			.optional(),
		types: z.array(z.string()).optional(),
		rating: z.number().optional(),
		userRatingCount: z.number().optional(),
		websiteUri: z.string().optional(),
		internationalPhoneNumber: z.string().optional(),
		nationalPhoneNumber: z.string().optional(),
		regularOpeningHours: z
			.object({
				weekdayDescriptions: z.array(z.string()).optional(),
			})
			.passthrough()
			.optional(),
		photos: z.array(z.object({ name: z.string() }).passthrough()).optional(),
	})
	.passthrough();

export const placePhotoMediaResponseSchema = z
	.object({
		name: z.string().optional(),
		photoUri: z.string().optional(),
	})
	.passthrough();

export const placesSearchTextResponseSchema = z
	.object({
		places: z.array(placeResultSchema).optional(),
	})
	.passthrough();

export type PlacesSearchTextResponse = z.infer<typeof placesSearchTextResponseSchema>;
export type PlaceResult = z.infer<typeof placeResultSchema>;
