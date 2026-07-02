import { describe, expect, it } from 'bun:test';

import { createOptionalAiFallbackPlugin } from '../src/ai';
import { createClassificationEngine } from '../src/engine';
import { createV0TypeProfilesPlugin } from '../src/plugins/index';

describe('optional ai fallback plugin', () => {
	it('is inert by default when no adapter is configured', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createV0TypeProfilesPlugin(), createOptionalAiFallbackPlugin()],
		});

		const result = await engine.classify({
			input: 'apple',
			mode: 'progressive',
			classificationSessionId: 'ai-disabled',
		});

		expect(result.resolved?.resolverId).toBe('deterministic-fallback');
	});

	it('resolves ambiguous inputs with adapter when enabled', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createV0TypeProfilesPlugin(),
				createOptionalAiFallbackPlugin({
					enabled: true,
					adapter: {
						classify: async ({ value }) => {
							return {
								schemaType: 'Thing',
								category: 'thing',
								title: `AI: ${value}`,
								canonicalId: 'wikidata:Q312',
								confidence: 0.91,
								rationale: 'Resolved ambiguous lexical input',
							};
						},
					},
				}),
			],
		});

		const result = await engine.classify({
			input: 'apple',
			mode: 'progressive',
			classificationSessionId: 'ai-enabled',
		});

		expect(result.resolved?.resolverId).toBe('ai-fallback-resolver');
		expect(result.resolved?.atoms[0]?.title).toBe('AI: apple');
		expect(result.resolved?.atoms[0]?.source).toBe('optional-ai-fallback');
		expect(result.resolved?.atoms[0]?.metadata.confidence).toBe(0.91);
	});

	it('does not run when confidence is above configured threshold', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createV0TypeProfilesPlugin(),
				{
					manifest: {
						id: 'high-confidence-classifier',
						version: '1.0.0',
						engineRange: '^0.1.0',
						runtime: 'server',
						capabilities: [],
						permissions: [],
						dependsOn: [],
						provides: [],
						priority: 5,
					},
					classifiers: [
						{
							id: 'high-confidence-classifier',
							priority: 5,
							classify: () => ({
								type: 'text',
								domain: 'lexical',
								subtype: 'word',
								confidence: 0.99,
								meta: {},
							}),
						},
					],
				},
				createOptionalAiFallbackPlugin({
					enabled: true,
					minConfidenceThreshold: 0.7,
					adapter: {
						classify: async () => ({
							schemaType: 'Thing',
							category: 'thing',
							title: 'AI should not run',
							confidence: 0.9,
						}),
					},
				}),
			],
		});

		const result = await engine.classify({
			input: 'anything',
			mode: 'progressive',
			classificationSessionId: 'ai-threshold',
		});

		expect(result.resolved?.resolverId).toBe('deterministic-fallback');
		expect(result.resolved?.atoms[0]?.title).not.toBe('AI should not run');
	});

	it('cannot be registered in client runtime', () => {
		const engine = createClassificationEngine({
			runtime: 'client',
			autoInit: false,
		});

		expect(() =>
			engine.registerPlugin(
				createOptionalAiFallbackPlugin({
					enabled: true,
					adapter: {
						classify: async () => ({
							schemaType: 'Thing',
							category: 'thing',
							title: 'blocked',
							confidence: 0.9,
						}),
					},
				})
			)
		).toThrow(/cannot run in "client"/i);
	});
});
