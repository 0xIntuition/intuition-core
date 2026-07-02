import { z } from 'zod/v4';

export const screenshotDataSchema = z.object({
	imageUrl: z.string().url(),
	width: z.number(),
	height: z.number(),
	capturedAt: z.string(),
	viewportSize: z.string().optional(),
});

export type ScreenshotData = z.infer<typeof screenshotDataSchema>;
