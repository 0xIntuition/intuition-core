import { describe, expect, it } from 'bun:test';
import type { FetchLike } from '../../src/plugins/providers';
import { createProductListingPlugin } from '../../src/plugins/providers';
import {
	extractAmazonAsinFromUrl,
	isAmazonShortLinkUrl,
	resolveAmazonMarketplace,
} from '../../src/plugins/providers/__shared__/amazon';
import { createMockAtomInput, createMockRequest } from '../../src/testing';

describe('shared amazon url helpers', () => {
	it('extracts ASINs from the common product path shapes', () => {
		const expectations: Array<[string, string | undefined]> = [
			['https://www.amazon.com/dp/B0916J478T', 'B0916J478T'],
			['https://www.amazon.com/Carepod-Humidifier/dp/B0916J478T/ref=sr_1_1?th=1', 'B0916J478T'],
			['https://www.amazon.com/gp/product/B0916J478T?psc=1', 'B0916J478T'],
			['https://www.amazon.com/gp/aw/d/B0916J478T', 'B0916J478T'],
			['https://www.amazon.com/exec/obidos/ASIN/B0916J478T/ref=nosim', 'B0916J478T'],
			['https://www.amazon.de/-/en/dp/B0916J478T', 'B0916J478T'],
			['https://www.amazon.com/dp/B0916J478TX', undefined],
			['https://www.amazon.com/stores/page/ABC', undefined],
		];

		for (const [url, asin] of expectations) {
			expect(extractAmazonAsinFromUrl(url)).toBe(asin as string);
		}
	});

	it('extracts ASINs from sponsored-result wrappers only on Amazon hosts', () => {
		const sponsored = `https://www.amazon.com/sspa/click?ie=UTF8&spc=x&url=${encodeURIComponent(
			'/Carepod-Humidifier/dp/B0916J478T/ref=sr_1_1_sspa?th=1'
		)}`;
		expect(extractAmazonAsinFromUrl(sponsored)).toBe('B0916J478T');
		expect(extractAmazonAsinFromUrl('https://evil.example/?asin=B0916J478T')).toBeUndefined();
	});

	it('detects Amazon short links', () => {
		expect(isAmazonShortLinkUrl('https://a.co/d/4DUuJRf')).toBe(true);
		expect(isAmazonShortLinkUrl('https://amzn.to/3xYz12A')).toBe(true);
		expect(isAmazonShortLinkUrl('https://www.amazon.com/dp/B0916J478T')).toBe(false);
		expect(isAmazonShortLinkUrl(undefined)).toBe(false);
	});

	it('maps marketplace hosts to Canopy domains, including newer marketplaces', () => {
		expect(resolveAmazonMarketplace('https://www.amazon.com.au/dp/B0916J478T')).toBe('AU');
		expect(resolveAmazonMarketplace('https://www.amazon.nl/dp/B0916J478T')).toBe('NL');
		expect(resolveAmazonMarketplace('https://www.amazon.com/dp/B0916J478T')).toBe('US');
	});
});

describe('product-listing short-link resolution', () => {
	function createShortLinkFetchMock(fetchedUrls: string[]): FetchLike {
		return async (input) => {
			fetchedUrls.push(input);
			if (input.startsWith('https://a.co/')) {
				const response = new Response('', { status: 200 });
				Object.defineProperty(response, 'url', {
					value: 'https://www.amazon.com/Carepod-Humidifier/dp/B0916J478T/ref=share',
				});
				return response;
			}
			return new Response(
				JSON.stringify({
					data: {
						amazonProduct: {
							title: 'Carepod One Stainless Steel Humidifier for Large Room',
							brand: 'Carepod',
							asin: 'B0916J478T',
							url: 'https://www.amazon.com/dp/B0916J478T',
						},
					},
				}),
				{ headers: { 'content-type': 'application/json' } }
			);
		};
	}

	it('supports Amazon short links without an explicit target', () => {
		const plugin = createProductListingPlugin({ apiKey: 'test-key' });
		const request = createMockRequest({
			input: createMockAtomInput({ hints: { url: 'https://a.co/d/4DUuJRf' } }),
		});
		expect(plugin.supports(request)).toBe(true);
	});

	it('resolves the shortener redirect, then fetches Canopy with the ASIN', async () => {
		const fetchedUrls: string[] = [];
		const plugin = createProductListingPlugin({
			apiKey: 'test-key',
			fetch: createShortLinkFetchMock(fetchedUrls),
		});

		const request = createMockRequest({
			input: createMockAtomInput({ hints: { url: 'https://a.co/d/4DUuJRf' } }),
		});
		const artifacts = await plugin.enrich(request, {
			now: () => '2026-01-01T00:00:00.000Z',
			signal: new AbortController().signal,
		});

		expect(fetchedUrls[0]).toBe('https://a.co/d/4DUuJRf');
		expect(fetchedUrls[1]).toContain('rest.canopyapi.co');
		expect(fetchedUrls[1]).toContain('asin=B0916J478T');
		expect(artifacts[0]?.artifact_type).toBe('product-listing');
		expect(artifacts[0]?.data).toMatchObject({
			name: 'Carepod One Stainless Steel Humidifier for Large Room',
			brand: 'Carepod',
			sku: 'B0916J478T',
		});
	});

	it('returns no artifacts when the short link does not land on Amazon', async () => {
		const plugin = createProductListingPlugin({
			apiKey: 'test-key',
			fetch: async () => {
				const response = new Response('', { status: 200 });
				Object.defineProperty(response, 'url', { value: 'https://evil.example/landing' });
				return response;
			},
		});

		const request = createMockRequest({
			input: createMockAtomInput({ hints: { url: 'https://a.co/d/4DUuJRf' } }),
		});
		const artifacts = await plugin.enrich(request, {
			now: () => '2026-01-01T00:00:00.000Z',
			signal: new AbortController().signal,
		});

		expect(artifacts).toEqual([]);
	});
});
