import { describe, expect, it } from 'bun:test';

import { createClassificationEngine } from '../src/engine';
import { createV0TypeProfilesPlugin } from '../src/index';
import type { AtomClassificationPlugin } from '../src/plugins';

describe('publishable projection', () => {
	it('keeps identity-focused fields and strips volatile commerce fields', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createV0TypeProfilesPlugin(), createExampleProductPlugin()],
		});

		const result = await engine.classify({
			input: 'https://example.com/products/test-widget',
			mode: 'progressive',
			classificationSessionId: 'publishable-product',
		});

		expect(result.status).toBe('complete');
		expect(result.resolved?.classifications[0]?.type).toBe('Product');
		expect(result.resolved?.classifications[0]?.data).toMatchObject({
			image: 'https://cdn.example.com/widget.jpg',
			thumbnailUrl: 'https://cdn.example.com/widget-thumb.jpg',
			logo: 'https://cdn.example.com/widget-logo.svg',
			brand: {
				logo: 'https://cdn.example.com/brand-logo.svg',
			},
		});
		expect(result.resolved?.publishable[0]).toEqual({
			type: 'Product',
			data: {
				'@context': 'https://schema.org/',
				'@type': 'Product',
				name: 'Example Test Widget',
				url: 'https://example.com/products/test-widget',
				sameAs: ['https://example.com/products/test-widget'],
				sku: 'widget-123',
				brand: {
					name: 'Example',
					url: 'https://example.com/brand/example',
				},
			},
			meta: {
				pluginId: 'example-product',
				provider: 'example-html',
				fetchedAt: '2026-04-02T00:00:00.000Z',
				sourceUrl: 'https://example.com/products/test-widget',
				confidence: 0.94,
			},
		});
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('offers');
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('aggregateRating');
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('reviewCount');
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('image');
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('thumbnailUrl');
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('logo');
		expect(result.resolved?.publishable[0]?.data.brand).not.toHaveProperty('logo');
	});

	it('keeps media fields out of publishable data even when policies mark them as identity', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createV0TypeProfilesPlugin(), createExampleProductPlugin()],
		});

		const result = await engine.classify({
			input: 'https://example.com/products/policy-widget',
			mode: 'progressive',
			classificationSessionId: 'publishable-policy-product',
		});

		expect(result.status).toBe('complete');
		expect(result.resolved?.classifications[0]?.data).toMatchObject({
			image: 'https://cdn.example.com/widget.jpg',
			thumbnailUrl: 'https://cdn.example.com/widget-thumb.jpg',
			logo: 'https://cdn.example.com/widget-logo.svg',
			media: ['https://cdn.example.com/widget-media.jpg'],
		});
		expect(result.resolved?.publishable[0]?.data).toMatchObject({
			name: 'Example Test Widget',
			url: 'https://example.com/products/policy-widget',
			sku: 'widget-123',
		});
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('image');
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('thumbnailUrl');
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('logo');
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('media');
	});
});

function createExampleProductPlugin(): AtomClassificationPlugin {
	return {
		manifest: {
			id: 'example-product',
			version: '0.1.0',
			engineRange: '^0.1.0',
			runtime: 'universal',
			capabilities: ['classify:url:example', 'resolve:url:example'],
			permissions: [],
			dependsOn: ['type-profiles'],
			provides: ['example:product'],
			priority: 10,
		},
		classifiers: [
			{
				id: 'example-product-classifier',
				classify: (input) => {
					if (
						input !== 'https://example.com/products/test-widget' &&
						input !== 'https://example.com/products/policy-widget'
					) {
						return null;
					}

					return {
						type: 'url',
						domain: 'example',
						subtype: 'product',
						confidence: 0.94,
						meta: {
							canonicalUrl: input,
						},
					};
				},
			},
		],
		resolvers: [
			{
				id: 'example-product-resolver',
				executionMode: 'deterministic',
				canResolve: (classification) =>
					classification.type === 'url' &&
					classification.domain === 'example' &&
					classification.subtype === 'product',
				resolve: ({ request }) => ({
					classifications: [
						{
							type: 'Product',
							data: {
								'@context': 'https://schema.org/',
								'@type': 'Product',
								name: 'Example Test Widget',
								url: request.input,
								sameAs: [request.input],
								sku: 'widget-123',
								brand: {
									name: 'Example',
									url: 'https://example.com/brand/example',
									logo: 'https://cdn.example.com/brand-logo.svg',
								},
								image: 'https://cdn.example.com/widget.jpg',
								thumbnailUrl: 'https://cdn.example.com/widget-thumb.jpg',
								logo: 'https://cdn.example.com/widget-logo.svg',
								media: ['https://cdn.example.com/widget-media.jpg'],
								offers: {
									price: '19.99',
									priceCurrency: 'USD',
								},
								aggregateRating: {
									ratingValue: 4.8,
								},
								reviewCount: 124,
							},
							meta: {
								pluginId: 'example-product',
								provider: 'example-html',
								fetchedAt: '2026-04-02T00:00:00.000Z',
								sourceUrl: request.input,
								confidence: 0.94,
								...(request.input.includes('policy-widget')
									? {
											fieldPolicies: {
												image: { promotionTier: 'identity' },
												thumbnailUrl: { promotionTier: 'identity' },
												logo: { promotionTier: 'identity' },
												media: { promotionTier: 'identity' },
											},
										}
									: {}),
							},
						},
					],
					fallbackUsed: false,
				}),
			},
		],
	};
}
