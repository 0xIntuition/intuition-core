import { describe, expect, it } from 'bun:test';
import { createBrandPlugin } from '../src/plugins/providers/brand';
import type { EnrichmentRequest } from '../src/types';

function request(input: {
	url?: string;
	name?: string;
	identifiers?: Record<string, string>;
}): EnrichmentRequest {
	return {
		input: {
			atomType: 'company',
			jsonLd: {
				'@context': 'https://schema.org/',
				'@type': 'Organization',
				...(input.url ? { url: input.url } : {}),
			},
			source: {
				classificationEngine: 'url-first-manual',
				classifiedAt: '2026-06-11T00:00:00.000Z',
			},
			hints: {
				...(input.url ? { url: input.url } : {}),
				...(input.name ? { name: input.name } : {}),
				...(input.identifiers ? { identifiers: input.identifiers } : {}),
			},
		},
		runtime: 'server',
	};
}

const plugin = createBrandPlugin();

describe('brand plugin platform-domain blocklist', () => {
	it('does not trigger on content-platform urls', () => {
		const blockedUrls = [
			'https://en.wikipedia.org/wiki/OpenAI',
			'https://open.spotify.com/track/3n3Ppam7vgaVa1iaRUc9Lp',
			'https://www.youtube.com/watch?v=abc12345678',
			'https://x.com/OpenAI',
			'https://github.com/openai/gpt-4',
			'https://www.amazon.com/dp/B0ABC12345',
			'https://www.amazon.co.uk/dp/B0ABC12345',
			'https://www.google.com/maps/place/Eiffel+Tower/@48.8583,2.2944,17z',
			'https://maps.app.goo.gl/abc123',
			'https://www.themoviedb.org/movie/27205',
		];
		for (const url of blockedUrls) {
			expect(plugin.supports(request({ url }))).toBe(false);
		}
	});

	it('still triggers on true company homepages', () => {
		expect(plugin.supports(request({ url: 'https://openai.com/' }))).toBe(true);
		expect(plugin.supports(request({ url: 'https://www.google.com/' }))).toBe(true);
		expect(plugin.supports(request({ url: 'https://stripe.com/pricing' }))).toBe(true);
	});

	it('lets explicit domain identifiers bypass the blocklist', () => {
		expect(
			plugin.supports(
				request({
					url: 'https://en.wikipedia.org/wiki/OpenAI',
					identifiers: { domain: 'openai.com' },
				})
			)
		).toBe(true);
	});

	it('rejects platform hosts arriving via the name hint', () => {
		expect(plugin.supports(request({ name: 'wikipedia.org' }))).toBe(false);
		expect(plugin.supports(request({ name: 'openai.com' }))).toBe(true);
	});
});
