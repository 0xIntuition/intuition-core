import { z } from 'zod/v4';

export const npmPackageDataSchema = z.object({
	name: z.string(),
	version: z.string(),
	description: z.string().optional(),
	keywords: z.array(z.string()).optional(),
	license: z.string().optional(),
	homepage: z.string().url().optional(),
	repository: z.string().optional(),
	weeklyDownloads: z.number().optional(),
	author: z.string().optional(),
	maintainers: z.array(z.string()).optional(),
});

export type NpmPackageData = z.infer<typeof npmPackageDataSchema>;
