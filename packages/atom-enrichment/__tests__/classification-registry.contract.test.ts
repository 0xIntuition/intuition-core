import { beforeEach, describe, expect, it } from 'bun:test';

import {
	builtinClassificationDefinitions,
	type ClassificationRegistry,
	classificationCategorySchema,
	createClassificationRegistry,
	createDefaultClassificationRegistry,
	opengraphDataSchema,
	spotifyDataSchema,
} from '../src/classifications';

describe('classification registry contract', () => {
	let registry: ClassificationRegistry;

	beforeEach(() => {
		registry = createClassificationRegistry();
	});

	it('registers a valid classification', () => {
		registry.register({
			slug: 'opengraph',
			displayName: 'OpenGraph Metadata',
			category: 'web-metadata',
			dataSchema: opengraphDataSchema,
		});

		expect(registry.has('opengraph')).toBe(true);
	});

	it('rejects duplicate slugs without override', () => {
		registry.register({
			slug: 'opengraph',
			displayName: 'OpenGraph Metadata',
			category: 'web-metadata',
			dataSchema: opengraphDataSchema,
		});

		expect(() =>
			registry.register({
				slug: 'opengraph',
				displayName: 'OpenGraph v2',
				category: 'web-metadata',
				dataSchema: opengraphDataSchema,
			})
		).toThrow();
	});

	it('allows duplicate slugs with override', () => {
		registry.register({
			slug: 'opengraph',
			displayName: 'OpenGraph Metadata',
			category: 'web-metadata',
			dataSchema: opengraphDataSchema,
		});

		registry.register(
			{
				slug: 'opengraph',
				displayName: 'OpenGraph v2',
				category: 'web-metadata',
				dataSchema: opengraphDataSchema,
			},
			{ override: true }
		);

		expect(registry.get('opengraph')?.displayName).toBe('OpenGraph v2');
	});

	it('rejects invalid slug formats', () => {
		expect(() =>
			registry.register({
				slug: 'OpenGraph',
				displayName: 'OpenGraph Metadata',
				category: 'web-metadata',
				dataSchema: opengraphDataSchema,
			})
		).toThrow();
	});

	it('returns undefined for unknown slugs', () => {
		expect(registry.get('does-not-exist')).toBeUndefined();
	});

	it('lists registrations by category', () => {
		registry.register({
			slug: 'opengraph',
			displayName: 'OpenGraph Metadata',
			category: 'web-metadata',
			dataSchema: opengraphDataSchema,
		});
		registry.register({
			slug: 'spotify',
			displayName: 'Spotify Metadata',
			category: 'music',
			dataSchema: spotifyDataSchema,
		});

		const webMetadata = registry.listByCategory('web-metadata');
		expect(webMetadata).toHaveLength(1);
		expect(webMetadata[0]?.slug).toBe('opengraph');
	});

	it('validates artifact data against a registered schema', () => {
		registry.register({
			slug: 'opengraph',
			displayName: 'OpenGraph Metadata',
			category: 'web-metadata',
			dataSchema: opengraphDataSchema,
		});

		expect(
			registry.validate('opengraph', {
				title: 'Test',
				url: 'https://example.com',
			}).success
		).toBe(true);

		expect(
			registry.validate('opengraph', {
				url: 'not-a-url',
			}).success
		).toBe(false);
	});

	it('returns validation failure for unknown classifications', () => {
		const result = registry.validate('unknown-slug', { foo: 'bar' });
		expect(result.success).toBe(false);
	});

	it('ships all 36 built-in classifications', () => {
		expect(builtinClassificationDefinitions).toHaveLength(36);

		const defaultRegistry = createDefaultClassificationRegistry();
		expect(defaultRegistry.list()).toHaveLength(36);
		expect(defaultRegistry.has('opengraph')).toBe(true);
		expect(defaultRegistry.has('ai-entities')).toBe(true);
		expect(defaultRegistry.has('color-palette')).toBe(true);
	});

	it('covers every classification category in the default registry', () => {
		const defaultRegistry = createDefaultClassificationRegistry();
		const categories = classificationCategorySchema.options;

		for (const category of categories) {
			expect(defaultRegistry.listByCategory(category).length).toBeGreaterThan(0);
		}
	});
});
