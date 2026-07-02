import { z } from 'zod/v4';

export const githubRepoDataSchema = z.object({
	owner: z.string(),
	name: z.string(),
	fullName: z.string(),
	description: z.string().optional(),
	language: z.string().optional(),
	stars: z.number().optional(),
	forks: z.number().optional(),
	openIssues: z.number().optional(),
	topics: z.array(z.string()).optional(),
	license: z.string().optional(),
	createdAt: z.string().optional(),
	updatedAt: z.string().optional(),
	homepage: z.string().url().optional(),
	defaultBranch: z.string().optional(),
});

export type GitHubRepoData = z.infer<typeof githubRepoDataSchema>;

export const githubUserDataSchema = z.object({
	login: z.string(),
	name: z.string().optional(),
	avatarUrl: z.string().url().optional(),
	bio: z.string().optional(),
	company: z.string().optional(),
	location: z.string().optional(),
	blog: z.string().optional(),
	publicRepos: z.number().optional(),
	followers: z.number().optional(),
	following: z.number().optional(),
});

export type GitHubUserData = z.infer<typeof githubUserDataSchema>;
