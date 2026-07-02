import { z } from 'zod/v4';

export const placesDataSchema = z.object({
	name: z.string(),
	formattedAddress: z.string().optional(),
	latitude: z.number().optional(),
	longitude: z.number().optional(),
	placeId: z.string().optional(),
	types: z.array(z.string()).optional(),
	rating: z.number().optional(),
	userRatingsTotal: z.number().optional(),
	photoUrl: z.string().url().optional(),
	website: z.string().url().optional(),
	phoneNumber: z.string().optional(),
	openingHours: z.array(z.string()).optional(),
});

export type PlacesData = z.infer<typeof placesDataSchema>;
