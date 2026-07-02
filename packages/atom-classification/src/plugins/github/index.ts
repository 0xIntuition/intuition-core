import { slugify, toStringMaybe, tryParseUrl, withPlatformMetadata } from '../shared/helpers';
import {
	createPlatformPlugin,
	type PlatformV0PluginOptions,
	type PlatformV0Profile,
} from '../shared/platform';
import { createGitHubDomainApiAdapter } from './domain-api-adapter';

export type GitHubPluginOptions = PlatformV0PluginOptions & {
	useDefaultDomainApiAdapter?: boolean;
};

const RESERVED_PROFILE_SEGMENTS = new Set([
	'about',
	'collections',
	'contact',
	'events',
	'explore',
	'features',
	'issues',
	'login',
	'marketplace',
	'new',
	'notifications',
	'orgs',
	'pricing',
	'pulls',
	'search',
	'sessions',
	'settings',
	'signup',
	'site',
	'topics',
]);

export const githubProfile: PlatformV0Profile = {
	domain: 'github',
	supportsOEmbed: false,
	allowDomainApiWithoutCredentials: true,
	classifier: {
		id: 'github-url-classifier',
		priority: 10,
		classify(input: string) {
			const parsed = tryParseUrl(input);
			if (!parsed || parsed.hostname !== 'github.com') {
				return null;
			}

			const segments = parsed.pathname.split('/').filter(Boolean);
			const owner = segments[0];
			const repo = segments[1];
			const third = segments[2];
			const fourth = segments[3];

			if (!owner) {
				return null;
			}

			if (RESERVED_PROFILE_SEGMENTS.has(owner.toLowerCase())) {
				return null;
			}

			if (!repo) {
				return {
					type: 'url' as const,
					domain: 'github',
					subtype: 'profile',
					confidence: 0.92,
					meta: {
						login: owner,
						canonicalUrl: `https://github.com/${owner}`,
					},
				};
			}

			if (third === 'issues' && fourth && /^\d+$/.test(fourth)) {
				return {
					type: 'url' as const,
					domain: 'github',
					subtype: 'issue',
					confidence: 0.98,
					meta: {
						owner,
						repo,
						issueNumber: fourth,
						canonicalUrl: `https://github.com/${owner}/${repo}/issues/${fourth}`,
					},
				};
			}

			if (third === 'pull' && fourth && /^\d+$/.test(fourth)) {
				return {
					type: 'url' as const,
					domain: 'github',
					subtype: 'pull',
					confidence: 0.98,
					meta: {
						owner,
						repo,
						pullNumber: fourth,
						canonicalUrl: `https://github.com/${owner}/${repo}/pull/${fourth}`,
					},
				};
			}

			if (third === 'commit' && fourth) {
				return {
					type: 'url' as const,
					domain: 'github',
					subtype: 'commit',
					confidence: 0.98,
					meta: {
						owner,
						repo,
						sha: fourth,
						canonicalUrl: `https://github.com/${owner}/${repo}/commit/${fourth}`,
					},
				};
			}

			if (!third || third === 'blob' || third === 'tree') {
				return {
					type: 'url' as const,
					domain: 'github',
					subtype: 'repo',
					confidence: 0.97,
					meta: {
						owner,
						repo,
						canonicalUrl: `https://github.com/${owner}/${repo}`,
					},
				};
			}

			return null;
		},
	},
	resolveGeneric({ classification, canonicalUrl, now }) {
		if (classification.subtype === 'profile') {
			const login = toStringMaybe(classification.meta.login) ?? slugify(canonicalUrl);
			return withPlatformMetadata(
				{
					schemaType: 'SocialMediaAccount',
					category: 'person',
					title: `GitHub @${login}`,
					canonicalId: `github:user:${login.toLowerCase()}`,
					sameAs: [canonicalUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'SocialMediaAccount',
						username: login,
						platform: 'github',
						url: canonicalUrl,
						sameAs: [canonicalUrl],
					},
				},
				'github',
				classification.subtype,
				{
					pluginId: 'github',
					provider: 'github',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
				}
			);
		}

		if (classification.subtype === 'repo') {
			const owner = toStringMaybe(classification.meta.owner) ?? 'unknown';
			const repo = toStringMaybe(classification.meta.repo) ?? slugify(canonicalUrl);
			const fullName = `${owner}/${repo}`;
			return withPlatformMetadata(
				{
					schemaType: 'SoftwareSourceCode',
					category: 'software',
					title: fullName,
					canonicalId: `github:repo:${owner.toLowerCase()}/${repo.toLowerCase()}`,
					sameAs: [canonicalUrl],
					data: {
						'@context': 'https://schema.org/',
						'@type': 'SoftwareSourceCode',
						name: fullName,
						url: canonicalUrl,
						sameAs: [canonicalUrl],
						codeRepository: canonicalUrl,
					},
				},
				'github',
				classification.subtype,
				{
					pluginId: 'github',
					provider: 'github',
					fetchedAt: now,
					sourceUrl: canonicalUrl,
					confidence: classification.confidence,
				}
			);
		}

		if (classification.subtype === 'issue') {
			const owner = toStringMaybe(classification.meta.owner) ?? 'unknown';
			const repo = toStringMaybe(classification.meta.repo) ?? 'repo';
			const issueNumber = toStringMaybe(classification.meta.issueNumber) ?? slugify(canonicalUrl);
			return buildGenericWorkItemAtom({
				pluginId: 'github',
				provider: 'github',
				now,
				confidence: classification.confidence,
				canonicalUrl,
				title: `${owner}/${repo}#${issueNumber}`,
				canonicalId: `github:issue:${owner.toLowerCase()}/${repo.toLowerCase()}#${issueNumber}`,
			});
		}

		if (classification.subtype === 'pull') {
			const owner = toStringMaybe(classification.meta.owner) ?? 'unknown';
			const repo = toStringMaybe(classification.meta.repo) ?? 'repo';
			const pullNumber = toStringMaybe(classification.meta.pullNumber) ?? slugify(canonicalUrl);
			return buildGenericWorkItemAtom({
				pluginId: 'github',
				provider: 'github',
				now,
				confidence: classification.confidence,
				canonicalUrl,
				title: `${owner}/${repo}#${pullNumber}`,
				canonicalId: `github:pull:${owner.toLowerCase()}/${repo.toLowerCase()}#${pullNumber}`,
			});
		}

		const owner = toStringMaybe(classification.meta.owner) ?? 'unknown';
		const repo = toStringMaybe(classification.meta.repo) ?? 'repo';
		const sha = toStringMaybe(classification.meta.sha) ?? slugify(canonicalUrl);
		return buildGenericWorkItemAtom({
			pluginId: 'github',
			provider: 'github',
			now,
			confidence: classification.confidence,
			canonicalUrl,
			title: `Commit ${sha.slice(0, 12)} in ${owner}/${repo}`,
			canonicalId: `github:commit:${owner.toLowerCase()}/${repo.toLowerCase()}:${sha.toLowerCase()}`,
		});
	},
};

export function createGitHubPlugin(options: GitHubPluginOptions = {}) {
	const { useDefaultDomainApiAdapter = true, ...platformOptions } = options;
	const domainApiAdapter =
		platformOptions.adapters?.domainApi ??
		(useDefaultDomainApiAdapter ? createGitHubDomainApiAdapter() : undefined);

	return createPlatformPlugin({
		pluginId: 'github',
		resolverId: 'github-resolver',
		profile: githubProfile,
		options: {
			...platformOptions,
			adapters: {
				...platformOptions.adapters,
				domainApi: domainApiAdapter,
			},
		},
	});
}

function buildGenericWorkItemAtom(input: {
	pluginId: string;
	provider: string;
	now: string;
	confidence: number;
	canonicalUrl: string;
	title: string;
	canonicalId: string;
}) {
	return withPlatformMetadata(
		{
			schemaType: 'Thing',
			category: 'thing',
			title: input.title,
			canonicalId: input.canonicalId,
			sameAs: [input.canonicalUrl],
			data: {
				'@context': 'https://schema.org/',
				'@type': 'Thing',
				name: input.title,
				url: input.canonicalUrl,
				sameAs: [input.canonicalUrl],
			},
		},
		'github',
		'work-item',
		{
			pluginId: input.pluginId,
			provider: input.provider,
			fetchedAt: input.now,
			sourceUrl: input.canonicalUrl,
			confidence: input.confidence,
		}
	);
}

export type { GitHubDomainApiAdapter, GitHubDomainApiAdapterOptions } from './domain-api-adapter';
export { createGitHubDomainApiAdapter } from './domain-api-adapter';
