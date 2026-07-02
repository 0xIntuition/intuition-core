import { describe, expect, it } from 'bun:test';

import { createClassificationEngine } from '../src/engine';
import {
	createAmazonDomainApiAdapter,
	createAmazonPlugin,
	createV0TypeProfilesPlugin,
} from '../src/index';
import { amazonProfile } from '../src/plugins/amazon';
import {
	extractAmazonAsinFromUrl,
	isAmazonShortLinkUrl,
	resolveAmazonMarketplace,
} from '../src/plugins/amazon/url';

describe('amazon url helpers', () => {
	it('extracts ASINs from the common product path shapes', () => {
		const expectations: Array<[string, string | undefined]> = [
			['https://www.amazon.com/dp/B0916J478T', 'B0916J478T'],
			['https://www.amazon.com/Carepod-Humidifier/dp/B0916J478T/ref=sr_1_1?th=1', 'B0916J478T'],
			['https://www.amazon.com/gp/product/B0916J478T?psc=1', 'B0916J478T'],
			['https://www.amazon.com/gp/aw/d/B0916J478T', 'B0916J478T'],
			['https://www.amazon.com/exec/obidos/ASIN/B0916J478T/ref=nosim', 'B0916J478T'],
			['https://www.amazon.de/-/en/dp/B0916J478T', 'B0916J478T'],
			// 11-character segment must not match.
			['https://www.amazon.com/dp/B0916J478TX', undefined],
			['https://www.amazon.com/stores/page/ABC', undefined],
		];

		for (const [url, asin] of expectations) {
			expect(extractAmazonAsinFromUrl(url)).toBe(asin as string);
		}
	});

	it('extracts ASINs from sponsored-result wrappers and asin query params', () => {
		const sponsored = `https://www.amazon.com/sspa/click?ie=UTF8&spc=x&url=${encodeURIComponent(
			'/Carepod-Humidifier/dp/B0916J478T/ref=sr_1_1_sspa?th=1'
		)}`;
		expect(extractAmazonAsinFromUrl(sponsored)).toBe('B0916J478T');
		expect(
			extractAmazonAsinFromUrl('https://www.amazon.com/gp/offer-listing?asin=B0916J478T')
		).toBe('B0916J478T');
		// Query params are only trusted on Amazon hosts.
		expect(extractAmazonAsinFromUrl('https://evil.example/?asin=B0916J478T')).toBeUndefined();
	});

	it('detects Amazon short links', () => {
		expect(isAmazonShortLinkUrl('https://a.co/d/4DUuJRf')).toBe(true);
		expect(isAmazonShortLinkUrl('https://amzn.to/3xYz12A')).toBe(true);
		expect(isAmazonShortLinkUrl('https://amzn.eu/d/abc')).toBe(true);
		expect(isAmazonShortLinkUrl('https://www.amazon.com/dp/B0916J478T')).toBe(false);
		expect(isAmazonShortLinkUrl('not a url')).toBe(false);
	});

	it('maps marketplace hosts to Canopy domains', () => {
		expect(resolveAmazonMarketplace('https://www.amazon.de/dp/B0916J478T')).toBe('DE');
		expect(resolveAmazonMarketplace('https://www.amazon.com.au/dp/B0916J478T')).toBe('AU');
		expect(resolveAmazonMarketplace('https://www.amazon.nl/dp/B0916J478T')).toBe('NL');
		expect(resolveAmazonMarketplace('https://www.amazon.com/dp/B0916J478T')).toBe('US');
	});
});

async function classifyUrl(input: string) {
	const request = {
		input,
		mode: 'progressive',
		classificationSessionId: 'amazon-url-test',
	} as Parameters<typeof amazonProfile.classifier.classify>[1];
	return await amazonProfile.classifier.classify(input, request);
}

describe('amazon classifier url coverage', () => {
	it('classifies mobile and legacy product paths', async () => {
		for (const url of [
			'https://www.amazon.com/gp/aw/d/B0916J478T',
			'https://www.amazon.com/exec/obidos/ASIN/B0916J478T/',
		]) {
			const classification = await classifyUrl(url);
			expect(classification?.subtype).toBe('product');
			expect(classification?.meta.asin).toBe('B0916J478T');
			expect(classification?.meta.canonicalUrl).toBe('https://www.amazon.com/dp/B0916J478T');
		}
	});

	it('classifies short links as products pending redirect resolution', async () => {
		const classification = await classifyUrl('https://a.co/d/4DUuJRf');
		expect(classification?.domain).toBe('amazon');
		expect(classification?.subtype).toBe('product');
		expect(classification?.meta.shortLink).toBe(true);
		expect(classification?.meta.canonicalUrl).toBe('https://a.co/d/4DUuJRf');
	});

	it('does not classify non-amazon hosts', async () => {
		expect(await classifyUrl('https://amazon.example.com/dp/B0916J478T')).toBeNull();
	});
});

describe('amazon domain-api adapter short links', () => {
	it('resolves the shortener redirect before calling Canopy', async () => {
		const fetchedUrls: string[] = [];
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
							fetch: async (input) => {
								fetchedUrls.push(input);
								if (input.startsWith('https://a.co/')) {
									return {
										ok: true,
										status: 200,
										url: 'https://www.amazon.com/Carepod-Humidifier/dp/B0916J478T/ref=share',
										json: async () => ({}),
										text: async () => '',
									};
								}
								return {
									ok: true,
									status: 200,
									json: async () => ({
										data: {
											amazonProduct: {
												title: 'Carepod One Stainless Steel Humidifier for Large Room',
												brand: 'Carepod',
												asin: 'B0916J478T',
												url: 'https://www.amazon.com/dp/B0916J478T',
											},
										},
									}),
									text: async () => '',
								};
							},
						}),
						domainHtml: () => {
							throw new Error('domain-html should not run when domain-api succeeds');
						},
					},
				}),
			],
		});

		const result = await engine.classify({
			input: 'https://a.co/d/4DUuJRf',
			mode: 'progressive',
			classificationSessionId: 'amazon-short-link',
		});

		expect(result.classification?.domain).toBe('amazon');
		expect(result.resolved?.atoms[0]?.title).toBe(
			'Carepod One Stainless Steel Humidifier for Large Room'
		);
		expect(fetchedUrls[0]).toBe('https://a.co/d/4DUuJRf');
		expect(fetchedUrls[1]).toContain('rest.canopyapi.co');
		expect(fetchedUrls[1]).toContain('asin=B0916J478T');
		expect(fetchedUrls[1]).toContain('domain=US');
	});
});
