import type { z } from 'zod/v4';
import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest, GitHubTarget } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import {
	getGitHubTarget,
	getIdentifier,
	getRequestName,
	getRequestUrl,
} from '../__shared__/request';
import { gitHubRepoResponseSchema, gitHubUserResponseSchema } from './external';
import { githubRepoDataSchema, githubUserDataSchema } from './schema';

type CreateGitHubPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	token?: string;
};

const reservedGitHubUserRoutes = new Set([
	'about',
	'collections',
	'contact',
	'events',
	'features',
	'issues',
	'marketplace',
	'notifications',
	'orgs',
	'pricing',
	'pulls',
	'search',
	'settings',
	'sponsors',
	'team',
	'topics',
	'trending',
]);

export function createGitHubPlugin(options: CreateGitHubPluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'github',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['github-repo', 'github-user'],
		priority: options.priority ?? 45,
		TTL: options.TTL ?? 300,

		supports(request: EnrichmentRequest) {
			return !!resolveGitHubTarget(request);
		},

		async enrich(request, ctx) {
			const target = resolveGitHubTarget(request);
			if (!target) {
				return [];
			}

			// An expired/revoked token turns every call into a 401/403 even though
			// anonymous access would succeed — retry once without credentials
			// rather than losing the artifact entirely.
			const fetchGitHub = async <TSchema extends z.ZodTypeAny>(
				endpoint: string,
				schema: TSchema
			): Promise<z.infer<TSchema>> => {
				const headers = {
					Accept: 'application/vnd.github+json',
					...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
				};
				try {
					return await fetchJsonWithSchema(fetcher, endpoint, schema, {
						signal: ctx.signal,
						headers,
					});
				} catch (error) {
					const rejectedToken =
						options.token && error instanceof Error && /^HTTP 40[13] /.test(error.message);
					if (!rejectedToken) {
						throw error;
					}
					ctx.logger?.warn(
						'github: configured token was rejected (expired or revoked?); retrying anonymously',
						{ endpoint }
					);
					return await fetchJsonWithSchema(fetcher, endpoint, schema, {
						signal: ctx.signal,
						headers: { Accept: 'application/vnd.github+json' },
					});
				}
			};

			if (target.kind === 'repo') {
				const payload = await fetchGitHub(
					`https://api.github.com/repos/${encodeURIComponent(target.owner)}/${encodeURIComponent(target.repo)}`,
					gitHubRepoResponseSchema
				);

				const owner = payload.owner?.login ?? target.owner;
				const name = payload.name ?? target.repo;
				const fullName = payload.full_name ?? `${owner}/${name}`;
				const sourceUrl = payload.html_url ?? `https://github.com/${owner}/${name}`;

				return [
					{
						artifact_type: 'github-repo',
						data: githubRepoDataSchema.parse({
							owner,
							name,
							fullName,
							description: toOptionalString(payload.description),
							language: toOptionalString(payload.language),
							stars: toOptionalNumber(payload.stargazers_count),
							forks: toOptionalNumber(payload.forks_count),
							openIssues: toOptionalNumber(payload.open_issues_count),
							topics: toOptionalStringArray(payload.topics),
							license: toOptionalString(payload.license?.spdx_id ?? payload.license?.name),
							createdAt: toOptionalString(payload.created_at),
							updatedAt: toOptionalString(payload.updated_at),
							homepage: toOptionalUrlString(payload.homepage),
							defaultBranch: toOptionalString(payload.default_branch),
						}),
						meta: {
							pluginId: 'github',
							provider: 'github',
							fetchedAt: ctx.now(),
							sourceUrl,
						},
					},
				];
			}

			const payload = await fetchGitHub(
				`https://api.github.com/users/${encodeURIComponent(target.login)}`,
				gitHubUserResponseSchema
			);

			const login = payload.login ?? target.login;
			const sourceUrl = payload.html_url ?? `https://github.com/${login}`;
			return [
				{
					artifact_type: 'github-user',
					data: githubUserDataSchema.parse({
						login,
						name: toOptionalString(payload.name),
						avatarUrl: toOptionalUrlString(payload.avatar_url),
						bio: toOptionalString(payload.bio),
						company: toOptionalString(payload.company),
						location: toOptionalString(payload.location),
						blog: toOptionalString(payload.blog),
						publicRepos: toOptionalNumber(payload.public_repos),
						followers: toOptionalNumber(payload.followers),
						following: toOptionalNumber(payload.following),
					}),
					meta: {
						pluginId: 'github',
						provider: 'github',
						fetchedAt: ctx.now(),
						sourceUrl,
					},
				},
			];
		},
	});
}

function toOptionalString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toOptionalUrlString(value: unknown): string | undefined {
	const normalized = toOptionalString(value);
	if (!normalized) {
		return undefined;
	}

	try {
		new URL(normalized);
		return normalized;
	} catch {
		return undefined;
	}
}

function toOptionalNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toOptionalStringArray(value: unknown): string[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const normalized = value.filter(
		(entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
	);
	return normalized.length > 0 ? normalized : undefined;
}

function resolveGitHubTarget(request: EnrichmentRequest): GitHubTarget | undefined {
	const explicitTarget = getGitHubTarget(request);
	if (explicitTarget) {
		return explicitTarget;
	}

	const repoIdentifier = getIdentifier(request, 'github-repo', 'githubRepo', 'repo');
	if (repoIdentifier) {
		const parsed = parseRepoRef(repoIdentifier);
		if (parsed) {
			return {
				kind: 'repo',
				owner: parsed.owner,
				repo: parsed.repo,
			};
		}
	}

	const userIdentifier = getIdentifier(request, 'github-user', 'githubUser', 'user', 'login');
	if (userIdentifier) {
		const login = sanitizeGitHubSegment(userIdentifier);
		if (login && !reservedGitHubUserRoutes.has(login.toLowerCase())) {
			return {
				kind: 'user',
				login,
			};
		}
	}

	const url = getRequestUrl(request);
	if (url) {
		const fromUrl = parseGitHubTargetFromUrl(url);
		if (fromUrl) {
			return fromUrl;
		}
	}

	const name = getRequestName(request);
	if (!name) {
		return undefined;
	}

	const fromName = parseRepoRef(name);
	if (fromName) {
		return {
			kind: 'repo',
			owner: fromName.owner,
			repo: fromName.repo,
		};
	}

	return undefined;
}

function parseGitHubTargetFromUrl(url: string): GitHubTarget | undefined {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== 'github.com' && parsed.hostname !== 'www.github.com') {
			return undefined;
		}

		const segments = parsed.pathname.split('/').filter(Boolean);
		if (segments.length === 0) {
			return undefined;
		}

		const ownerOrLoginSegment = segments[0];
		if (!ownerOrLoginSegment) {
			return undefined;
		}

		const ownerOrLogin = sanitizeGitHubSegment(ownerOrLoginSegment);
		if (!ownerOrLogin) {
			return undefined;
		}

		if (segments.length >= 2) {
			const thirdSegment = segments[2];
			if (thirdSegment && thirdSegment !== 'blob' && thirdSegment !== 'tree') {
				return undefined;
			}

			const repoSegment = segments[1];
			if (!repoSegment) {
				return undefined;
			}

			const repo = sanitizeGitHubSegment(repoSegment);
			if (repo) {
				return {
					kind: 'repo',
					owner: ownerOrLogin,
					repo,
				};
			}
		}

		if (!reservedGitHubUserRoutes.has(ownerOrLogin.toLowerCase())) {
			return {
				kind: 'user',
				login: ownerOrLogin,
			};
		}

		return undefined;
	} catch {
		return undefined;
	}
}

function parseRepoRef(value: string): { owner: string; repo: string } | undefined {
	const match = value.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/);
	if (!match?.[1] || !match[2]) {
		return undefined;
	}

	const owner = sanitizeGitHubSegment(match[1]);
	const repo = sanitizeGitHubSegment(match[2]);
	if (!owner || !repo) {
		return undefined;
	}

	return { owner, repo };
}

function sanitizeGitHubSegment(value: string): string | undefined {
	const trimmed = value.trim();
	if (trimmed.length === 0) {
		return undefined;
	}

	if (!/^[A-Za-z0-9_.-]+$/.test(trimmed)) {
		return undefined;
	}

	return trimmed;
}
