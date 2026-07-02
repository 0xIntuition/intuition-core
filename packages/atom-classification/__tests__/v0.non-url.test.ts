import { describe, expect, it } from 'bun:test';
import { createLexicalPlugin } from '../src/plugins/index';
import { createServerEngine } from '../src/server';
import { createDefaultTestPlugins } from './helpers/default-plugins';

describe('v0 non-url coverage', () => {
	it('resolves ethereum addresses deterministically', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const result = await engine.classify({
			input: '0x1111111111111111111111111111111111111111',
			mode: 'progressive',
			classificationSessionId: 'eth-session',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.domain).toBe('ethereum');
		expect(result.classification?.subtype).toBe('account');
		expect(result.resolved?.resolverId).toBe('etherscan-resolver');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('EthereumAccount');
		expect(result.resolved?.atoms[0]?.canonicalId).toBe(
			'eip155:1:0x1111111111111111111111111111111111111111'
		);
		expect(result.resolved?.dedupeKey).toContain('canonical:eip155:1:');
	});

	it('resolves isbn identifiers deterministically', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const result = await engine.classify({
			input: 'ISBN 9780306406157',
			mode: 'progressive',
			classificationSessionId: 'isbn-session',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.domain).toBe('isbn');
		expect(result.classification?.subtype).toBe('isbn-13');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('Book');
		expect(result.resolved?.atoms[0]?.canonicalId).toBe('isbn:9780306406157');
		expect(result.resolved?.atoms[0]?.category).toBe('thing');
	});

	it('resolves offline-verified single words to generic things by default', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const result = await engine.classify({
			input: 'semantic',
			mode: 'progressive',
			classificationSessionId: 'lexical-session',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.domain).toBe('plain-text');
		expect(result.classification?.subtype).toBe('word');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('Thing');
		expect(result.resolved?.atoms[0]?.canonicalId).toBeUndefined();
	});

	it('resolves unverified single words to generic things deterministically', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const result = await engine.classify({
			input: 'blorple',
			mode: 'progressive',
			classificationSessionId: 'plain-text-word-session',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.domain).toBe('plain-text');
		expect(result.classification?.subtype).toBe('word');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('Thing');
		expect(result.resolved?.atoms[0]?.canonicalId).toBeUndefined();
	});

	it('resolves multi-word phrases to generic things deterministically', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const result = await engine.classify({
			input: 'semantic grounding',
			mode: 'progressive',
			classificationSessionId: 'plain-text-phrase-session',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.domain).toBe('plain-text');
		expect(result.classification?.subtype).toBe('phrase');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('Thing');
		expect(result.resolved?.atoms[0]?.canonicalId).toBeUndefined();
	});

	it('returns a placeholder when lexical is explicitly requested for an unverified word', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const result = await engine.classify({
			input: 'blorple',
			mode: 'progressive',
			pluginIds: ['lexical'],
			classificationSessionId: 'lexical-explicit-unverified-word',
		});

		expect(result.status).toBe('placeholder');
		expect(result.classification).toBeUndefined();
		expect(result.resolved).toBeUndefined();
	});

	it('keeps lexical available as an explicit opt-in plugin for verified words', async () => {
		const engine = createServerEngine({
			plugins: [...createDefaultTestPlugins(), createLexicalPlugin()],
		});
		const result = await engine.classify({
			input: 'semantic',
			mode: 'progressive',
			pluginIds: ['lexical'],
			classificationSessionId: 'lexical-explicit-verified-word',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.domain).toBe('lexical');
		expect(result.classification?.subtype).toBe('word');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('DefinedTerm');
		expect(result.resolved?.atoms[0]?.canonicalId).toBe('term:semantic');
	});

	it('returns a placeholder for json-like text instead of fabricating a lexical fallback', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const result = await engine.classify({
			input: '{semantic}',
			mode: 'progressive',
			classificationSessionId: 'json-like-placeholder',
		});

		expect(result.status).toBe('placeholder');
		expect(result.classification).toBeUndefined();
		expect(result.resolved).toBeUndefined();
	});

	it('keeps common file-like dotted identifiers on the plain-text path', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const cases = ['config.json', 'my.component.tsx', 'package-lock.json', 'docker-compose.yml'];

		for (const input of cases) {
			const result = await engine.classify({
				input,
				mode: 'progressive',
				classificationSessionId: `file-like-dotted-${input}`,
			});

			expect(result.status).toBe('complete');
			expect(result.classification?.domain).toBe('plain-text');
			expect(result.classification?.subtype).toBe('word');
			expect(result.resolved?.atoms[0]?.schemaType).toBe('Thing');
			expect(result.resolved?.atoms[0]?.canonicalId).toBeUndefined();
		}
	});

	it('returns stable dedupe keys for identical non-url inputs', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});
		const first = await engine.classify({
			input: 'ISBN 9780306406157',
			mode: 'progressive',
			classificationSessionId: 'isbn-session-a',
		});
		const second = await engine.classify({
			input: 'ISBN 9780306406157',
			mode: 'progressive',
			classificationSessionId: 'isbn-session-b',
		});

		expect(first.resolved?.dedupeKey).toBe(second.resolved?.dedupeKey);
	});
});
