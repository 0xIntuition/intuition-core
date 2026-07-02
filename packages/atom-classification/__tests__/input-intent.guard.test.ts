import { describe, expect, it } from 'bun:test';
import { createServerEngine } from '../src/server';
import { createDefaultTestPlugins } from './helpers/default-plugins';

describe('inputIntent guard', () => {
	it('returns a placeholder for random text in url-first mode', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});

		const result = await engine.classify({
			input: 'this is a random string',
			inputIntent: 'url-first',
			mode: 'progressive',
			classificationSessionId: 'url-first-random-string',
		});

		expect(result.status).toBe('placeholder');
		expect(result.classification).toBeUndefined();
		expect(result.resolved).toBeUndefined();
		expect(result.debug.inputIntent).toBe('url-first');
	});

	it('keeps plain-text fallback for generic text classification', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});

		const result = await engine.classify({
			input: 'semantic grounding',
			inputIntent: 'generic',
			mode: 'progressive',
			classificationSessionId: 'generic-random-string',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.domain).toBe('plain-text');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('Thing');
		expect(result.debug.inputIntent).toBe('generic');
	});
});
