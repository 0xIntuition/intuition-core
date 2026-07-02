import { describe, expect, it } from 'bun:test';
import type { FetchLike } from '../../src/plugins/providers/__shared__/http';
import { createGitHubPlugin } from '../../src/plugins/providers/github';
import type { EnrichmentRequest } from '../../src/types';

function request(url: string): EnrichmentRequest {
	return {
		input: {
			atomType: 'software',
			jsonLd: { '@context': 'https://schema.org/', '@type': 'SoftwareSourceCode', url },
			source: { classificationEngine: 'url-first-manual', classifiedAt: '2026-06-12T00:00:00Z' },
			hints: { url },
		},
		runtime: 'server',
	};
}

const ctx = {
	now: () => '2026-06-12T00:00:00.000Z',
	signal: undefined,
	logger: { warn() {}, info() {}, error() {}, debug() {} },
} as never;

const REPO_PAYLOAD = {
	name: 'intuition-ts',
	full_name: '0xIntuition/intuition-ts',
	owner: { login: '0xIntuition' },
	html_url: 'https://github.com/0xIntuition/intuition-ts',
	description: 'Intuition Typescript monorepo.',
	stargazers_count: 33,
};

describe('createGitHubPlugin token fallback', () => {
	it('retries anonymously when the configured token is rejected', async () => {
		const attempts: Array<string | null> = [];
		const fetcher: FetchLike = (_url, init) => {
			const auth = new Headers(init?.headers).get('authorization');
			attempts.push(auth);
			if (auth) {
				return Promise.resolve(new Response('{"message":"Bad credentials"}', { status: 403 }));
			}
			return Promise.resolve(
				new Response(JSON.stringify(REPO_PAYLOAD), {
					headers: { 'content-type': 'application/json' },
				})
			);
		};

		const plugin = createGitHubPlugin({ token: 'expired-token', fetch: fetcher });
		const artifacts = await plugin.enrich(
			request('https://github.com/0xIntuition/intuition-ts'),
			ctx
		);

		expect(attempts).toHaveLength(2);
		expect(attempts[0]).toContain('expired-token');
		expect(attempts[1]).toBeNull();
		expect(artifacts).toHaveLength(1);
		expect((artifacts[0]?.data as Record<string, unknown>).name).toBe('intuition-ts');
	});

	it('does not retry on non-auth failures', async () => {
		let calls = 0;
		const fetcher: FetchLike = () => {
			calls += 1;
			return Promise.resolve(new Response('{}', { status: 500 }));
		};
		const plugin = createGitHubPlugin({ token: 'valid-token', fetch: fetcher });
		await expect(
			plugin.enrich(request('https://github.com/0xIntuition/intuition-ts'), ctx)
		).rejects.toThrow('HTTP 500');
		expect(calls).toBe(1);
	});

	it('does not retry when no token was configured', async () => {
		let calls = 0;
		const fetcher: FetchLike = () => {
			calls += 1;
			return Promise.resolve(new Response('{}', { status: 403 }));
		};
		const plugin = createGitHubPlugin({ fetch: fetcher });
		await expect(
			plugin.enrich(request('https://github.com/0xIntuition/intuition-ts'), ctx)
		).rejects.toThrow('HTTP 403');
		expect(calls).toBe(1);
	});
});
