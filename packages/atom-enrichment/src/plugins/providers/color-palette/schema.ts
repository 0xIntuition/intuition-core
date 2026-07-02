import { z } from 'zod/v4';

export const colorPaletteDataSchema = z.object({
	dominantColor: z.string(),
	palette: z.array(z.string()),
	swatches: z.array(z.object({ hex: z.string(), percent: z.number() })).optional(),
	sourceImageUrl: z.string().url().optional(),
});

export type ColorPaletteData = z.infer<typeof colorPaletteDataSchema>;
