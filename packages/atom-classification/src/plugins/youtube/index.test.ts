import { afterEach, describe, expect, it } from 'bun:test';
import { createClassificationEngine } from '../../engine';
import { createTypeProfilesPlugin } from '../type-profiles';
import { createYouTubePlugin } from './index';

const globals = globalThis as typeof globalThis & { fetch?: typeof fetch };
const originalFetch = globals.fetch;
const mutableGlobals = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
	if (originalFetch) {
		globals.fetch = originalFetch;
		return;
	}

	Reflect.deleteProperty(mutableGlobals, 'fetch');
});

describe('youtube plugin', () => {
	it('uses the default oEmbed adapter to resolve video title and URL', async () => {
		let fetchCalls = 0;
		globals.fetch = (async (input: string) => {
			fetchCalls += 1;
			expect(input).toContain('https://www.youtube.com/oembed');
			expect(input).toContain('url=https%3A%2F%2Fwww.youtube.com%2Fwatch%3Fv%3DdQw4w9WgXcQ');

			return {
				ok: true,
				status: 200,
				json: async () => ({
					title: 'Never Gonna Give You Up',
					author_name: 'Rick Astley',
					thumbnail_url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
				}),
			};
		}) as typeof fetch;

		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createYouTubePlugin()],
		});
		const result = await engine.classify({
			input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			mode: 'progressive',
			classificationSessionId: 'youtube-default-oembed',
		});

		expect(fetchCalls).toBe(1);
		expect(result.classification?.domain).toBe('youtube');
		expect(result.resolved?.atoms[0]?.source).toBe('platform-v0:oembed');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('VideoObject');
		expect(result.resolved?.atoms[0]?.title).toBe('Never Gonna Give You Up');
		expect(result.resolved?.atoms[0]?.data).toMatchObject({
			'@context': 'https://schema.org/',
			'@type': 'VideoObject',
			name: 'Never Gonna Give You Up',
			url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			contentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			thumbnailUrl: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg',
		});
		expect(result.resolved?.publishable[0]?.data).toEqual({
			'@context': 'https://schema.org/',
			'@type': 'VideoObject',
			name: 'Never Gonna Give You Up',
			url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			contentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			sameAs: ['https://www.youtube.com/watch?v=dQw4w9WgXcQ'],
		});
	});

	it('can disable the default oEmbed adapter and resolve deterministically', async () => {
		let fetchCalls = 0;
		globals.fetch = ((input: RequestInfo | URL) => {
			fetchCalls += 1;
			throw new Error(`should not fetch ${String(input)}`);
		}) as unknown as typeof fetch;

		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createTypeProfilesPlugin(),
				createYouTubePlugin({ useDefaultOEmbedAdapter: false }),
			],
		});
		const result = await engine.classify({
			input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			mode: 'progressive',
			classificationSessionId: 'youtube-generic-fallback',
		});

		expect(fetchCalls).toBe(0);
		expect(result.classification?.domain).toBe('youtube');
		expect(result.resolved?.atoms[0]?.source).toBe('platform-v0:generic');
		expect(result.resolved?.atoms[0]?.title).toBe('YouTube Video dQw4w9WgXcQ');
		expect(result.resolved?.atoms[0]?.data).toMatchObject({
			'@context': 'https://schema.org/',
			'@type': 'VideoObject',
			name: 'YouTube Video dQw4w9WgXcQ',
			contentUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
		});
	});
});
