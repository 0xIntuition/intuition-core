import { describe, expect, it } from 'bun:test';

import { createClassificationEngine } from '../../engine';
import { createDefaultUrlPlugin } from '../default-url';
import { createTypeProfilesPlugin } from '../type-profiles';
import { createNpmPlugin } from './index';

describe('npm plugin', () => {
	it('classifies npm package URLs into software instead of generic websites', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createNpmPlugin(), createDefaultUrlPlugin()],
		});

		const result = await engine.classify({
			input: 'https://www.npmjs.com/package/hono',
			mode: 'progressive',
			classificationSessionId: 'npm-package-hono',
		});

		expect(result.classification?.domain).toBe('npm');
		expect(result.classification?.subtype).toBe('package');
		expect(result.resolved?.resolverId).toBe('npm-resolver');
		expect(result.resolved?.atoms[0]).toMatchObject({
			schemaType: 'SoftwareSourceCode',
			category: 'software',
			title: 'hono on npm',
			canonicalId: 'npm:package:hono',
		});
		expect(result.resolved?.publishable[0]?.data).toMatchObject({
			'@type': 'SoftwareSourceCode',
			name: 'hono on npm',
			identifier: 'hono',
			url: 'https://www.npmjs.com/package/hono',
		});
	});

	it('normalizes scoped npm package URLs', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createTypeProfilesPlugin(), createNpmPlugin()],
		});

		const result = await engine.classify({
			input: 'https://www.npmjs.com/package/%40tanstack/react-query?activeTab=readme',
			mode: 'progressive',
			classificationSessionId: 'npm-package-scoped',
		});

		expect(result.classification?.domain).toBe('npm');
		expect(result.resolved?.atoms[0]).toMatchObject({
			title: '@tanstack/react-query on npm',
			canonicalId: 'npm:package:@tanstack/react-query',
			sameAs: ['https://www.npmjs.com/package/@tanstack/react-query'],
		});
	});
});
