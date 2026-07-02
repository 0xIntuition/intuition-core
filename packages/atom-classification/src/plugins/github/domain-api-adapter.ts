import type { ResolverAtom } from '../../plugins';
import { toRecordMaybe, toStringMaybe } from '../shared/helpers';
import type { PlatformStageAdapter } from '../shared/platform';

type FetchLike = (
	input: string,
	init?: {
		headers?: Record<string, string>;
	}
) => Promise<{
	ok: boolean;
	status: number;
	json(): Promise<unknown>;
}>;

type GitHubRepoPayload = {
	full_name?: string;
	name?: string;
	html_url?: string;
	description?: string;
	language?: string;
	owner?: {
		login?: string;
	};
	license?: {
		spdx_id?: string;
	};
};

type GitHubUserPayload = {
	login?: string;
	name?: string;
	html_url?: string;
	avatar_url?: string;
	bio?: string;
	type?: string;
	blog?: string;
};

type GitHubIssuePayload = {
	number?: number;
	title?: string;
	html_url?: string;
	body?: string;
	user?: {
		login?: string;
	};
};

type GitHubPullPayload = GitHubIssuePayload;

type GitHubCommitPayload = {
	sha?: string;
	html_url?: string;
	commit?: {
		message?: string;
		author?: {
			name?: string;
		};
	};
	author?: {
		login?: string;
	};
};

export type GitHubDomainApiAdapterOptions = {
	token?: string;
	fetch?: FetchLike;
};

export type GitHubDomainApiAdapter = PlatformStageAdapter;

const GITHUB_API_BASE_URL = 'https://api.github.com';
const GITHUB_ACCEPT_HEADER = 'application/vnd.github+json';

export function createGitHubDomainApiAdapter(
	options: GitHubDomainApiAdapterOptions = {}
): GitHubDomainApiAdapter {
	const fetcher = options.fetch ?? resolveGlobalFetch();

	return async ({ domain, classification, credential }) => {
		if (domain !== 'github' || !fetcher) {
			return null;
		}

		const token =
			toStringMaybe(options.token) ??
			toStringMaybe(credential?.token) ??
			toStringMaybe(credential?.apiKey);
		const headers = buildGitHubHeaders(token);

		switch (classification.subtype) {
			case 'repo':
				return resolveGitHubRepo(fetcher, headers, classification.meta);
			case 'profile':
				return resolveGitHubProfile(fetcher, headers, classification.meta);
			case 'issue':
				return resolveGitHubIssue(fetcher, headers, classification.meta);
			case 'pull':
				return resolveGitHubPull(fetcher, headers, classification.meta);
			case 'commit':
				return resolveGitHubCommit(fetcher, headers, classification.meta);
			default:
				return null;
		}
	};
}

async function resolveGitHubRepo(
	fetcher: FetchLike,
	headers: Record<string, string>,
	meta: Record<string, unknown>
): Promise<ResolverAtom | null> {
	const owner = toStringMaybe(meta.owner);
	const repo = toStringMaybe(meta.repo);
	if (!owner || !repo) {
		return null;
	}

	const payload = await fetchGitHubJson<GitHubRepoPayload>(
		fetcher,
		`${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
		headers
	);
	if (!payload) {
		return null;
	}

	const canonicalUrl = toStringMaybe(payload.html_url) ?? `https://github.com/${owner}/${repo}`;
	const fullName = toStringMaybe(payload.full_name) ?? `${owner}/${repo}`;
	const description = toStringMaybe(payload.description);
	const language = toStringMaybe(payload.language);
	const license = toStringMaybe(payload.license?.spdx_id);
	const ownerLogin = toStringMaybe(payload.owner?.login) ?? owner;

	return {
		schemaType: 'SoftwareSourceCode',
		category: 'software',
		title: fullName,
		description,
		canonicalId: `github:repo:${owner.toLowerCase()}/${repo.toLowerCase()}`,
		sameAs: [canonicalUrl],
		data: {
			'@context': 'https://schema.org/',
			'@type': 'SoftwareSourceCode',
			name: fullName,
			url: canonicalUrl,
			sameAs: [canonicalUrl],
			codeRepository: canonicalUrl,
			...(description ? { description } : {}),
			...(language ? { programmingLanguage: language } : {}),
			...(license ? { license } : {}),
			author: ownerLogin,
		},
		metadata: {
			pluginId: 'github',
			provider: 'github-rest-api',
			sourceUrl: canonicalUrl,
		},
	};
}

async function resolveGitHubProfile(
	fetcher: FetchLike,
	headers: Record<string, string>,
	meta: Record<string, unknown>
): Promise<ResolverAtom | null> {
	const login = toStringMaybe(meta.login);
	if (!login) {
		return null;
	}

	const payload = await fetchGitHubJson<GitHubUserPayload>(
		fetcher,
		`${GITHUB_API_BASE_URL}/users/${encodeURIComponent(login)}`,
		headers
	);
	if (!payload) {
		return null;
	}

	const canonicalUrl = toStringMaybe(payload.html_url) ?? `https://github.com/${login}`;
	const resolvedLogin = toStringMaybe(payload.login) ?? login;
	const name = toStringMaybe(payload.name) ?? resolvedLogin;
	const description = toStringMaybe(payload.bio);
	const image = toStringMaybe(payload.avatar_url);
	const blog = toStringMaybe(payload.blog);
	const isOrganization = toStringMaybe(payload.type)?.toLowerCase() === 'organization';

	return {
		schemaType: isOrganization ? 'Organization' : 'Person',
		category: isOrganization ? 'company' : 'person',
		title: name,
		description,
		canonicalId: `${isOrganization ? 'github:org:' : 'github:user:'}${resolvedLogin.toLowerCase()}`,
		sameAs: [canonicalUrl],
		data: {
			'@context': 'https://schema.org/',
			'@type': isOrganization ? 'Organization' : 'Person',
			name,
			url: canonicalUrl,
			sameAs: [canonicalUrl],
			...(description ? { description } : {}),
			...(image ? { image } : {}),
			...(blog ? { sameAs: [canonicalUrl, blog] } : {}),
		},
		metadata: {
			pluginId: 'github',
			provider: 'github-rest-api',
			sourceUrl: canonicalUrl,
		},
	};
}

async function resolveGitHubIssue(
	fetcher: FetchLike,
	headers: Record<string, string>,
	meta: Record<string, unknown>
): Promise<ResolverAtom | null> {
	const owner = toStringMaybe(meta.owner);
	const repo = toStringMaybe(meta.repo);
	const issueNumber = toStringMaybe(meta.issueNumber);
	if (!owner || !repo || !issueNumber) {
		return null;
	}

	const payload = await fetchGitHubJson<GitHubIssuePayload>(
		fetcher,
		`${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/issues/${encodeURIComponent(issueNumber)}`,
		headers
	);
	if (!payload) {
		return null;
	}

	const canonicalUrl =
		toStringMaybe(payload.html_url) ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`;
	const title = buildWorkItemTitle(`${owner}/${repo}#${issueNumber}`, toStringMaybe(payload.title));
	const description = toStringMaybe(payload.body);
	const author = toStringMaybe(payload.user?.login);

	return buildGitHubWorkItemAtom({
		schemaType: 'Thing',
		title,
		description,
		canonicalId: `github:issue:${owner.toLowerCase()}/${repo.toLowerCase()}#${issueNumber}`,
		canonicalUrl,
		identifier: `${owner}/${repo}#${issueNumber}`,
		author,
	});
}

async function resolveGitHubPull(
	fetcher: FetchLike,
	headers: Record<string, string>,
	meta: Record<string, unknown>
): Promise<ResolverAtom | null> {
	const owner = toStringMaybe(meta.owner);
	const repo = toStringMaybe(meta.repo);
	const pullNumber = toStringMaybe(meta.pullNumber);
	if (!owner || !repo || !pullNumber) {
		return null;
	}

	const payload = await fetchGitHubJson<GitHubPullPayload>(
		fetcher,
		`${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/pulls/${encodeURIComponent(pullNumber)}`,
		headers
	);
	if (!payload) {
		return null;
	}

	const canonicalUrl =
		toStringMaybe(payload.html_url) ?? `https://github.com/${owner}/${repo}/pull/${pullNumber}`;
	const title = buildWorkItemTitle(`${owner}/${repo}#${pullNumber}`, toStringMaybe(payload.title));
	const description = toStringMaybe(payload.body);
	const author = toStringMaybe(payload.user?.login);

	return buildGitHubWorkItemAtom({
		schemaType: 'Thing',
		title,
		description,
		canonicalId: `github:pull:${owner.toLowerCase()}/${repo.toLowerCase()}#${pullNumber}`,
		canonicalUrl,
		identifier: `${owner}/${repo}#${pullNumber}`,
		author,
	});
}

async function resolveGitHubCommit(
	fetcher: FetchLike,
	headers: Record<string, string>,
	meta: Record<string, unknown>
): Promise<ResolverAtom | null> {
	const owner = toStringMaybe(meta.owner);
	const repo = toStringMaybe(meta.repo);
	const sha = toStringMaybe(meta.sha);
	if (!owner || !repo || !sha) {
		return null;
	}

	const payload = await fetchGitHubJson<GitHubCommitPayload>(
		fetcher,
		`${GITHUB_API_BASE_URL}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(sha)}`,
		headers
	);
	if (!payload) {
		return null;
	}

	const canonicalUrl =
		toStringMaybe(payload.html_url) ?? `https://github.com/${owner}/${repo}/commit/${sha}`;
	const commitMessage = toStringMaybe(payload.commit?.message) ?? sha;
	const title = commitMessage.split('\n')[0]?.trim() || sha;
	const author =
		toStringMaybe(payload.author?.login) ??
		toStringMaybe(payload.commit?.author?.name) ??
		undefined;

	return buildGitHubWorkItemAtom({
		schemaType: 'Thing',
		title,
		description: commitMessage,
		canonicalId: `github:commit:${owner.toLowerCase()}/${repo.toLowerCase()}:${sha.toLowerCase()}`,
		canonicalUrl,
		identifier: sha,
		author,
	});
}

function buildGitHubWorkItemAtom(input: {
	schemaType: 'Thing';
	title: string;
	description?: string;
	canonicalId: string;
	canonicalUrl: string;
	identifier: string;
	author?: string;
}): ResolverAtom {
	return {
		schemaType: input.schemaType,
		category: 'thing' as const,
		title: input.title,
		description: input.description,
		canonicalId: input.canonicalId,
		sameAs: [input.canonicalUrl],
		data: {
			'@context': 'https://schema.org/',
			'@type': input.schemaType,
			name: input.title,
			url: input.canonicalUrl,
			sameAs: [input.canonicalUrl],
			identifier: input.identifier,
			...(input.description ? { description: input.description } : {}),
			...(input.author ? { author: input.author } : {}),
		},
		metadata: {
			pluginId: 'github',
			provider: 'github-rest-api',
			sourceUrl: input.canonicalUrl,
		},
	};
}

async function fetchGitHubJson<TPayload>(
	fetcher: FetchLike,
	url: string,
	headers: Record<string, string>
): Promise<TPayload | undefined> {
	const response = await fetcher(url, { headers });
	if (!response.ok) {
		return undefined;
	}

	const payload = await response.json();
	return toRecordMaybe(payload) as TPayload | undefined;
}

function buildGitHubHeaders(token: string | undefined): Record<string, string> {
	return {
		accept: GITHUB_ACCEPT_HEADER,
		'user-agent': 'intuition-atom-classification',
		...(token ? { authorization: `Bearer ${token}` } : {}),
	};
}

function buildWorkItemTitle(prefix: string, title: string | undefined): string {
	const normalizedTitle = toStringMaybe(title);
	return normalizedTitle ? `${prefix} ${normalizedTitle}` : prefix;
}

function resolveGlobalFetch(): FetchLike | undefined {
	const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
	return typeof globalFetch === 'function' ? globalFetch : undefined;
}
