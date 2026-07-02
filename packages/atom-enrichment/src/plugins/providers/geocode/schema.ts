import { z } from 'zod/v4';

export const geocodeDataSchema = z.object({
	latitude: z.number(),
	longitude: z.number(),
	formattedAddress: z.string(),
	components: z
		.object({
			country: z.string().optional(),
			region: z.string().optional(),
			city: z.string().optional(),
			postalCode: z.string().optional(),
		})
		.optional(),
});

export type GeocodeData = z.infer<typeof geocodeDataSchema>;
