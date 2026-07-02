import { z } from 'zod/v4';

export const companyProfileDataSchema = z.object({
	name: z.string(),
	description: z.string().optional(),
	domain: z.string().optional(),
	industry: z.string().optional(),
	employeeCount: z.string().optional(),
	foundedYear: z.number().optional(),
	headquarters: z.string().optional(),
	logoUrl: z.string().url().optional(),
	socialLinks: z.record(z.string(), z.string().url()).optional(),
});

export type CompanyProfileData = z.infer<typeof companyProfileDataSchema>;
