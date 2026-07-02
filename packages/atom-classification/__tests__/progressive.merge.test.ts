import { describe, expect, it } from 'bun:test';
import { createClassificationEngine } from '../src/engine';
import type { AtomClassificationPlugin, ResolverAtom } from '../src/plugins';
import { createV0TypeProfilesPlugin } from '../src/plugins/type-profiles';

describe('progressive merge + dedupe contract', () => {
	it('merges client hints deterministically while preserving canonical server fields', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createV0TypeProfilesPlugin(), createExampleProductPlugin()],
		});

		const result = await engine.classify({
			input: 'https://example.com/products/sku-1',
			mode: 'progressive',
			classificationSessionId: 'progressive-merge-1',
			clientHints: {
				clientClassification: {
					type: 'url',
					domain: 'example',
					subtype: 'product',
					confidence: 0.4,
					meta: {
						resourceId: 'sku-1',
					},
				},
				clientResult: {
					schemaType: 'Product',
					resolvedBy: 'client-opengraph',
					data: {
						name: 'Client Preview Name',
						description: 'Client preview description',
						image: 'https://cdn.example.com/client-image.png',
						url: 'https://example.com/products/sku-1',
					},
				},
			},
		});

		expect(result.resolved?.resolverId).toBe('example-product-resolver');
		expect(result.resolved?.resolverChain).toContain('client-hint:client-opengraph');
		expect(result.resolved?.atoms[0]?.title).toBe('Server Canonical Name');
		expect(result.resolved?.atoms[0]?.description).toBe('Client preview description');
		expect(result.resolved?.atoms[0]?.canonicalId).toBe('example:product:sku-1');
		expect(result.resolved?.atoms[0]?.data.image).toBe('https://cdn.example.com/server-image.png');
		expect(result.resolved?.atoms[0]?.data.url).toBe('https://example.com/products/sku-1');
		expect(result.resolved?.atoms[0]?.source).toBe('merged');
		expect(result.provenance?.['/resolved/atoms/0/title']?.source).toBe('server');
		expect(result.provenance?.['/resolved/atoms/0/description']?.source).toBe('client');
		expect(result.provenance?.['/resolved/atoms/0/data/image']?.source).toBe('server');
		expect(result.provenance?.['/resolved/atoms/0/data/url']?.source).toBe('client');
		expect(result.provenance?.['/resolved/dedupeKey']?.source).toBe('merged');
	});

	it('lets user-edited fields override server values during progressive merge', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [createV0TypeProfilesPlugin(), createExampleProductPlugin()],
		});

		const result = await engine.classify({
			input: 'https://example.com/products/sku-1',
			mode: 'progressive',
			classificationSessionId: 'progressive-merge-2',
			clientHints: {
				clientClassification: {
					type: 'url',
					domain: 'example',
					subtype: 'product',
					confidence: 0.35,
					meta: {
						resourceId: 'sku-1',
					},
				},
				clientResult: {
					schemaType: 'Product',
					resolvedBy: 'client-opengraph',
					data: {
						name: 'User Edited Product Name',
						image: 'https://cdn.example.com/user-image.png',
					},
				},
				metadata: {
					userEditedFields: ['title', 'data.image'],
				},
			},
		});

		expect(result.resolved?.atoms[0]?.title).toBe('User Edited Product Name');
		expect(result.resolved?.atoms[0]?.data.image).toBe('https://cdn.example.com/user-image.png');
		expect(result.provenance?.['/resolved/atoms/0/title']?.source).toBe('user');
		expect(result.provenance?.['/resolved/atoms/0/data/image']?.source).toBe('user');
	});

	it('uses normalized content hash dedupe keys when no canonical identity is present', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createV0TypeProfilesPlugin(),
				createExampleProductPlugin({
					override: {
						canonicalId: undefined,
						sameAs: [],
					},
				}),
			],
		});

		const first = await engine.classify({
			input: 'https://example.com/products/sku-hash',
			mode: 'server-only',
			classificationSessionId: 'content-hash-a',
		});
		const second = await engine.classify({
			input: 'https://example.com/products/sku-hash',
			mode: 'server-only',
			classificationSessionId: 'content-hash-b',
		});

		expect(first.resolved?.dedupeKey.startsWith('content-hash:')).toBe(true);
		expect(first.resolved?.dedupeKey).toBe(second.resolved?.dedupeKey);
	});
});

function createExampleProductPlugin(
	options: { override?: Partial<ResolverAtom> } = {}
): AtomClassificationPlugin {
	return {
		manifest: {
			id: 'example-product-plugin',
			version: '1.0.0',
			engineRange: '^0.1.0',
			runtime: 'universal',
			capabilities: ['classify:url:example', 'resolve:url:example'],
			permissions: [],
			dependsOn: ['type-profiles'],
			provides: ['example:product'],
			priority: 5,
		},
		classifiers: [
			{
				id: 'example-url-classifier',
				priority: 5,
				classify: (input) => {
					const parsed = tryParseUrl(input);
					if (!parsed || parsed.hostname !== 'example.com') {
						return null;
					}

					const segments = parsed.pathname.split('/').filter(Boolean);
					if (segments[0] !== 'products' || !segments[1]) {
						return null;
					}

					return {
						type: 'url' as const,
						domain: 'example',
						subtype: 'product',
						confidence: 0.95,
						meta: {
							resourceId: segments[1],
						},
					};
				},
			},
		],
		resolvers: [
			{
				id: 'example-product-resolver',
				priority: 5,
				canResolve: (classification) =>
					classification.type === 'url' &&
					classification.domain === 'example' &&
					classification.subtype === 'product',
				resolve: ({ classification }) => {
					const resourceId =
						typeof classification.meta.resourceId === 'string'
							? classification.meta.resourceId
							: 'sku-1';

					return {
						atoms: [
							{
								schemaType: 'Product',
								category: 'product',
								title: 'Server Canonical Name',
								description: undefined,
								canonicalId: `example:product:${resourceId}`,
								sameAs: [`https://api.example.com/products/${resourceId}`],
								source: 'example-domain-api',
								data: {
									image: 'https://cdn.example.com/server-image.png',
									price: '19.99',
								},
								...options.override,
							},
						],
					};
				},
			},
		],
	};
}

function tryParseUrl(value: string): URL | null {
	try {
		return new URL(value.trim());
	} catch {
		return null;
	}
}
