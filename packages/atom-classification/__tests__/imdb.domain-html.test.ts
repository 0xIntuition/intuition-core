import { describe, expect, it, spyOn } from 'bun:test';
import { createClassificationEngine } from '../src/engine';
import {
	createImdbDomainHtmlAdapter,
	createImdbPlugin,
	createV0TypeProfilesPlugin,
} from '../src/index';
import type { DomainHtmlFetchLike } from '../src/plugins/shared/domain-html/fetch';
import type { PlatformStageInput } from '../src/plugins/shared/platform';
import { defaultClassificationPreset } from '../src/presets/default';

const input = 'https://www.imdb.com/title/tt0133093/';
const key = 'fixture-key';
const movie = { id: 603, title: 'The Matrix', release_date: '1999-03-30' };
const tv = { id: 1396, name: 'Breaking Bad', first_air_date: '2008-01-20' };

function stageInput(): PlatformStageInput {
	return {
		runtime: 'server',
		domain: 'imdb',
		canonicalUrl: input,
		requestInput: input,
		classification: {
			type: 'url',
			domain: 'imdb',
			subtype: 'title',
			confidence: 0.98,
			meta: { titleId: 'tt0133093', canonicalUrl: input },
		},
	};
}

function fixturePlugin(payload: unknown, status = 200, apiKey: string | undefined = key) {
	const calls: string[] = [];
	const options = {
		apiKey,
		fetch: async (url: string) => {
			calls.push(url);
			return { ok: status === 200, status, text: async () => JSON.stringify(payload) };
		},
	};
	const adapter = createImdbDomainHtmlAdapter(options);
	const plugin = createImdbPlugin({
		credentials: apiKey ? { tmdb: { apiKey } } : {},
		fetch: options.fetch,
	});
	const engine = createClassificationEngine({
		runtime: 'server',
		plugins: [createV0TypeProfilesPlugin(), plugin],
	});
	return { adapter, plugin, engine, calls };
}

describe('imdb TMDB find adapter in the historical domain-html slot', () => {
	for (const enabled of [true, false]) {
		for (const subtype of ['title', 'person'] as const) {
			it(`refuses legacy HTML overrides for ${subtype} with default adapter ${enabled}`, async () => {
				const calls: string[] = [];
				const url = subtype === 'title' ? input : 'https://www.imdb.com/name/nm0000206/';
				const legacyFetch = async (endpoint: string) => {
					calls.push(endpoint);
				};
				const plugin = createImdbPlugin({
					useDefaultDomainHtmlAdapter: enabled,
					credentials: subtype === 'title' ? { tmdb: { apiKey: key } } : {},
					adapters: {
						domainHtml: async ({ canonicalUrl }) => {
							await legacyFetch(canonicalUrl);
							return {
								schemaType: 'Movie',
								category: 'thing',
								title: 'IMDb Title tt0133093',
								canonicalId: 'imdb:title:tt0133093',
							};
						},
					},
				});
				const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
					endpoint: Parameters<typeof fetch>[0]
				) => {
					calls.push(String(endpoint));
					return new Response(JSON.stringify({ movie_results: [movie], tv_results: [] }));
				}) as unknown as typeof fetch);
				try {
					const result = await createClassificationEngine({
						runtime: 'server',
						plugins: [createV0TypeProfilesPlugin(), plugin],
					}).classify({
						input: url,
						mode: 'server-only',
						classificationSessionId: `imdb-legacy-${subtype}-${enabled}`,
					});
					expect(calls).toEqual([]);
					expect(result.resolved?.atoms.some((atom) => atom.title.startsWith('IMDb Title'))).toBe(
						false
					);
				} finally {
					fetchSpy.mockRestore();
				}
			});
		}
	}
	it('refuses URL-bearing legacy adapter errors without recording their message', async () => {
		let overrideCalls = 0;
		const sentinel = 'SENTINEL_TEST_KEY';
		const plugin = createImdbPlugin({
			credentials: { tmdb: { apiKey: key } },
			adapters: {
				domainHtml: () => {
					overrideCalls++;
					throw new Error(`https://api.themoviedb.org/3/find/tt0133093?api_key=${sentinel}`);
				},
			},
		});
		const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async () => {
			throw new Error('unexpected fetch');
		}) as unknown as typeof fetch);
		try {
			const result = await createClassificationEngine({
				runtime: 'server',
				plugins: [createV0TypeProfilesPlugin(), plugin],
			}).classify({ input, mode: 'server-only', classificationSessionId: 'imdb-legacy-error' });
			expect(JSON.stringify(result.resolverErrors ?? []).includes(sentinel)).toBe(false);
			expect(overrideCalls).toBe(0);
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});
	for (const failure of ['request', 'response'] as const) {
		it(`sanitizes ${failure} errors on the accepted catalog fetch path`, async () => {
			const sentinel = 'SENTINEL_TEST_KEY';
			const calls: string[] = [];
			const fetcher: DomainHtmlFetchLike = async (endpoint) => {
				calls.push(endpoint);
				const error = new Error(`TMDB find upstream https://example.test/?api_key=${sentinel}`);
				if (failure === 'request') throw error;
				return {
					get ok(): boolean {
						throw error;
					},
					status: 200,
					text: async () => '{}',
				};
			};
			const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation(
				fetcher as unknown as typeof fetch
			);
			try {
				const result = await createClassificationEngine({
					runtime: 'server',
					plugins: [
						createV0TypeProfilesPlugin(),
						createImdbPlugin({
							credentials: { tmdb: { apiKey: key } },
						}),
					],
				}).classify({
					input,
					mode: 'server-only',
					classificationSessionId: `imdb-${failure}-error`,
				});
				expect(calls).toHaveLength(1);
				expect(result.resolverErrors?.[0]?.message).toBeDefined();
				expect(result.resolverErrors?.[0]?.message.includes(sentinel)).toBe(false);
				expect(result.resolverErrors?.[0]?.message.includes('https://')).toBe(false);
				expect(result.resolverErrors?.[0]?.message).toBe('TMDB find upstream request failed');
			} finally {
				fetchSpy.mockRestore();
			}
		});
	}
	for (const [record, mediaType, schemaType, title, year] of [
		[movie, 'movie', 'Movie', 'The Matrix', 1999],
		[tv, 'tv', 'TVSeries', 'Breaking Bad', 2008],
	] as const) {
		it(`maps a single ${mediaType} find hit without requesting IMDb HTML`, async () => {
			const f = fixturePlugin({
				movie_results: mediaType === 'movie' ? [record] : [],
				tv_results: mediaType === 'tv' ? [record] : [],
			});
			const result = await f.engine.classify({
				input,
				mode: 'server-only',
				classificationSessionId: `imdb-${mediaType}`,
			});
			expect(f.calls).toHaveLength(1);
			const endpoint = new URL(f.calls[0]!);
			expect(endpoint.origin + endpoint.pathname).toBe(
				'https://api.themoviedb.org/3/find/tt0133093'
			);
			expect(endpoint.searchParams.get('external_source')).toBe('imdb_id');
			expect(endpoint.searchParams.has('api_key')).toBe(true);
			expect(result.resolved?.fallbackUsed).toBe(false);
			expect(result.resolved?.atoms[0]).toMatchObject({
				category: 'thing',
				schemaType,
				title,
				canonicalId: 'imdb:title:tt0133093',
			});
			expect(result.resolved?.classifications[0]?.data).toMatchObject({
				tmdbId: String(record.id),
				imdbId: 'tt0133093',
				year,
			});
			expect(result.resolved?.atoms[0]?.sameAs).toContain(
				`https://www.themoviedb.org/${mediaType}/${record.id}`
			);
		});
	}
	it('returns unavailable/null without a key and makes zero fetch calls', async () => {
		const f = fixturePlugin({ movie_results: [movie], tv_results: [] }, 200, '');
		const stage = stageInput();
		expect(await f.adapter(stage)).toBeNull();
		expect(stage.classification.meta.imdbBridge).toMatchObject({ status: 'unavailable' });
		const resolver = f.plugin.resolvers![0]!;
		expect(
			await resolver.resolve({
				runtime: 'server',
				classification: stage.classification,
				request: {
					input,
					mode: 'server-only',
					inputIntent: 'generic',
					classificationSessionId: 'imdb-no-key',
				},
				now: '2026-10-04T00:00:00.000Z',
			})
		).toBeNull();
		const result = await f.engine.classify({
			input,
			mode: 'server-only',
			classificationSessionId: 'imdb-no-key-engine',
		});
		expect(result.resolved?.resolverId).toBe('deterministic-fallback');
		expect(result.resolved?.atoms.some((atom) => atom.title.startsWith('IMDb Title'))).toBe(false);
		expect(f.calls).toEqual([]);
	});
	for (const host of ['imdb.com.evil.example', 'evil-imdb.com']) {
		it(`rejects ${host} with zero fetch calls`, async () => {
			const f = fixturePlugin({ movie_results: [movie], tv_results: [] });
			const result = await f.engine.classify({
				input: `https://${host}/title/tt0133093/`,
				mode: 'server-only',
				classificationSessionId: `imdb-host-${host}`,
			});
			expect(result.classification?.domain).not.toBe('imdb');
			expect(f.calls).toEqual([]);
		});
	}
	for (const payload of [
		{ movie_results: [], tv_results: [] },
		{ movie_results: [movie], tv_results: [tv] },
		{ movie_results: [{ id: -1, title: 'Bad' }], tv_results: [] },
		{ movie_results: [{ id: 603 }], tv_results: [] },
		{},
	]) {
		it('fails closed for missing, ambiguous or malformed find hits', async () => {
			const f = fixturePlugin(payload);
			const result = await f.engine.classify({
				input,
				mode: 'server-only',
				classificationSessionId: 'imdb-invalid',
			});
			expect(result.resolved?.resolverId).toBe('deterministic-fallback');
			expect(result.resolved?.atoms.some((atom) => atom.title.startsWith('IMDb Title'))).toBe(
				false
			);
			expect(f.calls).toHaveLength(1);
			expect(new URL(f.calls[0]!).hostname).toBe('api.themoviedb.org');
		});
	}
	for (const [status, message] of [
		[429, 'rate limit'],
		[503, 'upstream'],
		[401, 'auth'],
		[403, 'auth'],
	] as const) {
		it(`preserves the ${status} failure diagnosis in engine resolver errors`, async () => {
			const f = fixturePlugin({}, status);
			const result = await f.engine.classify({
				input,
				mode: 'server-only',
				classificationSessionId: `imdb-error-${status}`,
			});
			expect(result.resolverErrors?.[0]?.message).toContain(message);
			expect(result.resolved?.resolverId).toBe('deterministic-fallback');
			expect(f.calls).toHaveLength(1);
		});
	}
	it('threads shared preset TMDB credentials to the default adapter', async () => {
		const calls: string[] = [];
		const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
			url: Parameters<typeof fetch>[0]
		) => {
			calls.push(String(url));
			return new Response(JSON.stringify({ movie_results: [movie], tv_results: [] }));
		}) as unknown as typeof fetch);
		try {
			const plugins = defaultClassificationPreset({
				platformV0PluginOptions: { credentials: { tmdb: { apiKey: key } } },
			}).filter((p) => p.manifest.id === 'imdb' || p.manifest.id === 'type-profiles');
			const result = await createClassificationEngine({ runtime: 'server', plugins }).classify({
				input,
				mode: 'server-only',
				classificationSessionId: 'imdb-preset-key',
			});
			expect(result.resolved?.atoms[0]?.title).toBe('The Matrix');
			expect(calls).toHaveLength(1);
			expect(new URL(calls[0]!).pathname).toBe('/3/find/tt0133093');
		} finally {
			fetchSpy.mockRestore();
		}
	});
	it('keeps client title resolution and disabled credentials offline', async () => {
		const fetchSpy = spyOn(globalThis, 'fetch').mockImplementation((async (
			_url: Parameters<typeof fetch>[0]
		) => {
			throw new Error('unexpected fetch');
		}) as unknown as typeof fetch);
		try {
			for (const runtime of ['client', 'server'] as const) {
				const plugin = createImdbPlugin({ credentials: { tmdb: { apiKey: key, enabled: false } } });
				const stage = stageInput();
				expect(
					await plugin.resolvers![0]!.resolve({
						runtime,
						classification: stage.classification,
						request: {
							input,
							mode: 'progressive',
							inputIntent: 'generic',
							classificationSessionId: `imdb-disabled-${runtime}`,
						},
						now: '2026-10-04T00:00:00.000Z',
					})
				).toBeNull();
			}
			expect(fetchSpy).not.toHaveBeenCalled();
		} finally {
			fetchSpy.mockRestore();
		}
	});
});
