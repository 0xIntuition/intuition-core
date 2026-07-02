import { describe, expect, it } from 'bun:test';

import { createClassificationEngine } from '../src/engine';
import {
	createAmazonDomainApiAdapter,
	createAmazonPlugin,
	createV0TypeProfilesPlugin,
} from '../src/index';

describe('amazon domain-api adapter', () => {
	it('uses Canopy product data before html fallback when credentials are configured', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createV0TypeProfilesPlugin(),
				createAmazonPlugin({
					credentials: {
						amazon: {
							apiKey: 'test-key',
						},
					},
					adapters: {
						domainApi: createAmazonDomainApiAdapter({
							apiKey: 'test-key',
							fetch: async () => ({
								ok: true,
								status: 200,
								json: async () => ({
									data: {
										amazonProduct: {
											title: 'Carepod One Stainless Steel Humidifier for Large Room',
											brand: 'Carepod',
											asin: 'B0916J478T',
											url: 'https://www.amazon.com/dp/B0916J478T',
											mainImageUrl:
												'https://m.media-amazon.com/images/I/61vPRPWGPaL._AC_SL1500_.jpg',
											featureBullets: ['Ultrasonic cool mist', 'Only 3 washable parts'],
										},
									},
								}),
								text: async () => '',
							}),
						}),
						domainHtml: () => {
							throw new Error('domain-html should not run when domain-api succeeds');
						},
					},
				}),
			],
		});

		const result = await engine.classify({
			input: 'https://www.amazon.com/dp/B0916J478T?th=1',
			mode: 'progressive',
			classificationSessionId: 'amazon-domain-api',
		});

		expect(result.status).toBe('complete');
		expect(result.classification?.domain).toBe('amazon');
		expect(result.resolved?.fallbackUsed).toBe(false);
		expect(result.resolved?.atoms[0]?.source).toBe('platform-v0:domain-api');
		expect(result.resolved?.atoms[0]?.title).toBe(
			'Carepod One Stainless Steel Humidifier for Large Room'
		);
		expect(result.resolved?.classifications[0]?.data).toMatchObject({
			image: 'https://m.media-amazon.com/images/I/61vPRPWGPaL._AC_SL1500_.jpg',
		});
		expect(result.resolved?.publishable[0]?.data).toEqual({
			'@context': 'https://schema.org/',
			'@type': 'Product',
			name: 'Carepod One Stainless Steel Humidifier for Large Room',
			url: 'https://www.amazon.com/dp/B0916J478T',
			sameAs: ['https://www.amazon.com/dp/B0916J478T'],
			sku: 'B0916J478T',
			brand: 'Carepod',
		});
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('image');
		expect(result.resolved?.atoms[0]?.description).toBe(
			'Ultrasonic cool mist Only 3 washable parts'
		);

		const metadata = engine.getLastMetadata();
		expect(metadata.platformResolver).toEqual({
			domain: 'amazon',
			fallbackStage: 'domain-api',
			attemptedStages: ['domain-api'],
			skippedStages: [],
			stageErrors: [],
		});
	});
});
