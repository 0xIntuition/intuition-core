import { describe, expect, it } from 'bun:test';

import { createClassificationEngine } from '../src/engine';
import {
	createGitHubDomainApiAdapter,
	createGitHubPlugin,
	createV0TypeProfilesPlugin,
} from '../src/index';

describe('github domain-api adapter', () => {
	it('resolves repository identity via the github rest api without credentials', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createV0TypeProfilesPlugin(),
				createGitHubPlugin({
					adapters: {
						domainApi: createGitHubDomainApiAdapter({
							fetch: async () => ({
								ok: true,
								status: 200,
								json: async () => GITHUB_REPO_PAYLOAD,
							}),
						}),
					},
				}),
			],
		});

		const result = await engine.classify({
			input: 'https://github.com/openai/openai-node',
			mode: 'progressive',
			classificationSessionId: 'github-repo-domain-api',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.domain).toBe('github');
		expect(result.classification?.subtype).toBe('repo');
		expect(result.resolved?.fallbackUsed).toBe(false);
		expect(result.resolved?.atoms[0]?.schemaType).toBe('SoftwareSourceCode');
		expect(result.resolved?.atoms[0]?.title).toBe('openai/openai-node');
		expect(result.resolved?.atoms[0]?.canonicalId).toBe('github:repo:openai/openai-node');
		expect(result.resolved?.atoms[0]?.data).toMatchObject({
			description: 'Official JavaScript/TypeScript SDK for the OpenAI API.',
			programmingLanguage: 'TypeScript',
			license: 'MIT',
			author: 'openai',
			codeRepository: 'https://github.com/openai/openai-node',
		});
		expect(result.resolved?.publishable[0]?.data).toEqual({
			'@context': 'https://schema.org/',
			'@type': 'SoftwareSourceCode',
			name: 'openai/openai-node',
			url: 'https://github.com/openai/openai-node',
			sameAs: ['https://github.com/openai/openai-node'],
		});

		expect(engine.getLastMetadata().platformResolver).toEqual({
			domain: 'github',
			fallbackStage: 'domain-api',
			attemptedStages: ['domain-api'],
			skippedStages: [],
			stageErrors: [],
		});
	});

	it('resolves profile urls into Person identity when github returns a user', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createV0TypeProfilesPlugin(),
				createGitHubPlugin({
					adapters: {
						domainApi: createGitHubDomainApiAdapter({
							fetch: async () => ({
								ok: true,
								status: 200,
								json: async () => GITHUB_USER_PAYLOAD,
							}),
						}),
					},
				}),
			],
		});

		const result = await engine.classify({
			input: 'https://github.com/gaearon',
			mode: 'progressive',
			classificationSessionId: 'github-user-domain-api',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.subtype).toBe('profile');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('Person');
		expect(result.resolved?.atoms[0]?.title).toBe('Dan Abramov');
		expect(result.resolved?.atoms[0]?.canonicalId).toBe('github:user:gaearon');
		expect(result.resolved?.classifications[0]?.data).toMatchObject({
			image: 'https://avatars.githubusercontent.com/u/810438?v=4',
		});
		expect(result.resolved?.publishable[0]?.data).toEqual({
			'@context': 'https://schema.org/',
			'@type': 'Person',
			name: 'Dan Abramov',
			url: 'https://github.com/gaearon',
			sameAs: ['https://github.com/gaearon'],
		});
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('image');
	});

	it('resolves issue urls into identity-safe Thing output', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createV0TypeProfilesPlugin(),
				createGitHubPlugin({
					adapters: {
						domainApi: createGitHubDomainApiAdapter({
							fetch: async () => ({
								ok: true,
								status: 200,
								json: async () => GITHUB_ISSUE_PAYLOAD,
							}),
						}),
					},
				}),
			],
		});

		const result = await engine.classify({
			input: 'https://github.com/openai/openai-node/issues/123',
			mode: 'progressive',
			classificationSessionId: 'github-issue-domain-api',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.subtype).toBe('issue');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('Thing');
		expect(result.resolved?.atoms[0]?.title).toBe(
			'openai/openai-node#123 Add Responses API helper'
		);
		expect(result.resolved?.atoms[0]?.canonicalId).toBe('github:issue:openai/openai-node#123');
		expect(result.resolved?.atoms[0]?.data).toMatchObject({
			identifier: 'openai/openai-node#123',
			author: 'sashabaranov',
		});
		expect(result.resolved?.publishable[0]?.data).toEqual({
			'@context': 'https://schema.org/',
			'@type': 'Thing',
			name: 'openai/openai-node#123 Add Responses API helper',
			url: 'https://github.com/openai/openai-node/issues/123',
			sameAs: ['https://github.com/openai/openai-node/issues/123'],
			identifier: 'openai/openai-node#123',
		});
	});
});

const GITHUB_REPO_PAYLOAD = {
	full_name: 'openai/openai-node',
	name: 'openai-node',
	html_url: 'https://github.com/openai/openai-node',
	description: 'Official JavaScript/TypeScript SDK for the OpenAI API.',
	language: 'TypeScript',
	owner: {
		login: 'openai',
	},
	license: {
		spdx_id: 'MIT',
	},
};

const GITHUB_USER_PAYLOAD = {
	login: 'gaearon',
	name: 'Dan Abramov',
	html_url: 'https://github.com/gaearon',
	avatar_url: 'https://avatars.githubusercontent.com/u/810438?v=4',
	bio: 'Working on React.',
	type: 'User',
};

const GITHUB_ISSUE_PAYLOAD = {
	number: 123,
	title: 'Add Responses API helper',
	html_url: 'https://github.com/openai/openai-node/issues/123',
	body: 'We should expose a helper for the Responses API.',
	user: {
		login: 'sashabaranov',
	},
};
