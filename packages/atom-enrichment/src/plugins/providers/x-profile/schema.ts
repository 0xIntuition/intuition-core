import { z } from 'zod/v4';

export const xProfileDataSchema = z.object({
	username: z.string(),
	name: z.string().optional(),
	bio: z.string().optional(),
	profileBannerUrl: z.string().url().optional(),
	profileImageUrl: z.string().url().optional(),
	followers: z.number().optional(),
	following: z.number().optional(),
	tweetCount: z.number().optional(),
	verified: z.boolean().optional(),
	joinedAt: z.string().optional(),
});

export type XProfileData = z.infer<typeof xProfileDataSchema>;
