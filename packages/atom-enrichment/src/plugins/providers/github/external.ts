import { z } from 'zod/v4';

export const gitHubRepoOwnerResponseSchema = z
	.object({
		login: z.string().optional(),
	})
	.passthrough();

export const gitHubLicenseResponseSchema = z
	.object({
		spdx_id: z.string().optional(),
		name: z.string().optional(),
	})
	.passthrough();

export const gitHubRepoResponseSchema = z
	.object({
		owner: gitHubRepoOwnerResponseSchema.optional(),
		name: z.string().optional(),
		full_name: z.string().optional(),
		description: z.string().optional().nullable(),
		language: z.string().optional().nullable(),
		stargazers_count: z.number().optional(),
		forks_count: z.number().optional(),
		open_issues_count: z.number().optional(),
		topics: z.array(z.string()).optional(),
		license: gitHubLicenseResponseSchema.optional().nullable(),
		created_at: z.string().optional(),
		updated_at: z.string().optional(),
		homepage: z.string().optional().nullable(),
		default_branch: z.string().optional(),
		html_url: z.string().optional(),
	})
	.passthrough();

export const gitHubUserResponseSchema = z
	.object({
		login: z.string().optional(),
		name: z.string().optional().nullable(),
		avatar_url: z.string().optional(),
		bio: z.string().optional().nullable(),
		company: z.string().optional().nullable(),
		location: z.string().optional().nullable(),
		blog: z.string().optional().nullable(),
		public_repos: z.number().optional(),
		followers: z.number().optional(),
		following: z.number().optional(),
		html_url: z.string().optional(),
	})
	.passthrough();

export type GitHubRepoResponse = z.infer<typeof gitHubRepoResponseSchema>;
export type GitHubUserResponse = z.infer<typeof gitHubUserResponseSchema>;
