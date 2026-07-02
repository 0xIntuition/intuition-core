import { describe, expect, it } from 'bun:test';

import { createClassificationEngine } from '../../engine';
import { createTypeProfilesPlugin } from '../type-profiles';
import { createYouTubePlugin } from '../youtube';
import { createDefaultUrlPlugin } from './index';

describe('default-url plugin', () => {
	it('classifies and resolves a generic website URL to WebSite', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createDefaultUrlPlugin()],
		});

		const result = await engine.classify({
			input: 'https://intuition.systems',
			mode: 'progressive',
			classificationSessionId: 'default-url-generic',
		});

		expect(result.classification?.domain).toBe('web');
		expect(result.classification?.subtype).toBe('website');
		expect(result.resolved?.resolverId).toBe('default-url-resolver');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('WebSite');
		expect(result.resolved?.atoms[0]?.data).toMatchObject({
			'@context': 'https://schema.org/',
			'@type': 'WebSite',
			url: 'https://intuition.systems',
		});
	});

	it('normalizes a bare domain to an https website URL', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createDefaultUrlPlugin()],
		});

		const result = await engine.classify({
			input: 'example.com',
			mode: 'progressive',
			classificationSessionId: 'default-url-bare-domain',
		});

		expect(result.classification?.domain).toBe('web');
		expect(result.classification?.subtype).toBe('website');
		expect(result.resolved?.resolverId).toBe('default-url-resolver');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('WebSite');
		expect(result.resolved?.atoms[0]?.canonicalId).toBe('https://example.com');
		expect(result.resolved?.atoms[0]?.sameAs).toEqual(['https://example.com']);
		expect(result.resolved?.atoms[0]?.data).toMatchObject({
			'@context': 'https://schema.org/',
			'@type': 'WebSite',
			url: 'https://example.com',
		});
	});

	it('normalizes localhost and ipv4 hosts to https website URLs', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createDefaultUrlPlugin()],
		});

		const cases = [
			{ input: 'localhost:3000', expectedCanonicalUrl: 'https://localhost:3000' },
			{ input: '127.0.0.1:3000', expectedCanonicalUrl: 'https://127.0.0.1:3000' },
		] as const;

		for (const testCase of cases) {
			const result = await engine.classify({
				input: testCase.input,
				mode: 'progressive',
				classificationSessionId: `default-url-local-${testCase.input}`,
			});

			expect(result.classification?.domain).toBe('web');
			expect(result.classification?.subtype).toBe('website');
			expect(result.resolved?.atoms[0]?.schemaType).toBe('WebSite');
			expect(result.resolved?.atoms[0]?.canonicalId).toBe(testCase.expectedCanonicalUrl);
			expect(result.resolved?.atoms[0]?.sameAs).toEqual([testCase.expectedCanonicalUrl]);
		}
	});

	it('trims common trailing punctuation from pasted website inputs', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createDefaultUrlPlugin()],
		});

		const cases = [
			{ input: 'https://example.com/about).', expectedCanonicalUrl: 'https://example.com/about' },
			{ input: 'example.com,', expectedCanonicalUrl: 'https://example.com' },
		] as const;

		for (const testCase of cases) {
			const result = await engine.classify({
				input: testCase.input,
				mode: 'progressive',
				classificationSessionId: `default-url-trailing-${testCase.input}`,
			});

			expect(result.classification?.domain).toBe('web');
			expect(result.classification?.subtype).toBe('website');
			expect(result.resolved?.atoms[0]?.schemaType).toBe('WebSite');
			expect(result.resolved?.atoms[0]?.canonicalId).toBe(testCase.expectedCanonicalUrl);
		}
	});

	it('does not treat email-like input as a website URL', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createDefaultUrlPlugin()],
		});

		const result = await engine.classify({
			input: 'person@example.com',
			mode: 'progressive',
			classificationSessionId: 'default-url-email-like',
		});

		expect(result.classification?.domain).not.toBe('web');
		expect(result.classification?.subtype).not.toBe('website');
		expect(result.resolved?.atoms[0]?.schemaType).not.toBe('WebSite');
		expect(result.resolved?.atoms[0]?.canonicalId).toBeUndefined();
	});

	it('does not treat common file-like dotted identifiers as website URLs', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createDefaultUrlPlugin()],
		});

		const cases = ['config.json', 'my.component.tsx', 'package-lock.json', 'docker-compose.yml'];

		for (const input of cases) {
			const result = await engine.classify({
				input,
				mode: 'progressive',
				classificationSessionId: `default-url-file-like-${input}`,
			});

			expect(result.classification?.domain).not.toBe('web');
			expect(result.classification?.subtype).not.toBe('website');
			expect(result.resolved?.atoms[0]?.schemaType).not.toBe('WebSite');
			expect(result.resolved?.atoms[0]?.canonicalId).toBeUndefined();
		}
	});

	it('does not override more specific URL plugins', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createDefaultUrlPlugin(), createYouTubePlugin()],
		});

		const result = await engine.classify({
			input: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
			mode: 'progressive',
			classificationSessionId: 'default-url-youtube',
		});

		expect(result.classification?.domain).toBe('youtube');
		expect(result.resolved?.resolverId).toBe('youtube-resolver');
	});

	it('records default-url metadata using the actual plugin id', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createDefaultUrlPlugin()],
		});

		const result = await engine.classify({
			input: 'https://intuition.systems',
			mode: 'progressive',
			classificationSessionId: 'default-url-metadata',
		});

		expect(result.resolved?.atoms[0]?.metadata?.pluginId).toBe('default-url');
		expect(result.resolved?.atoms[0]?.metadata?.provider).toBe('default-url');
	});
});
