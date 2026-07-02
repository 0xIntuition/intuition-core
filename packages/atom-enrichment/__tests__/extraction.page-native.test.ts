import { describe, expect, it } from 'bun:test';
import { extractClassificationFields } from '../src/extraction/extract';
import { suggestClassifications } from '../src/extraction/suggest';
import { createMicrodataPlugin, parseJsonLdBlocks } from '../src/plugins/providers/microdata';
import type { EnrichmentArtifact, EnrichmentRequest } from '../src/types';

const noFetch = () => Promise.reject(new Error('network disabled in test'));

function microdataArtifact(jsonLd: Record<string, unknown>[], url: string): EnrichmentArtifact {
	return {
		artifact_type: 'microdata',
		data: { url, jsonLd },
		meta: {
			pluginId: 'microdata',
			provider: 'page-jsonld',
			fetchedAt: '2026-06-11T00:00:00.000Z',
			sourceUrl: url,
		},
	};
}

// Live-shape Eventbrite/Luma style Event JSON-LD.
const EVENT_NODE = {
	'@context': 'https://schema.org',
	'@type': 'MusicEvent',
	name: 'ETHDenver 2027 Kickoff Concert',
	startDate: '2027-02-18T19:00:00-07:00',
	endDate: '2027-02-18T23:00:00-07:00',
	location: {
		'@type': 'Place',
		name: 'Mission Ballroom',
		address: {
			'@type': 'PostalAddress',
			streetAddress: '4242 Wynkoop St',
			addressLocality: 'Denver',
			addressRegion: 'CO',
			postalCode: '80216',
		},
	},
	url: 'https://www.eventbrite.com/e/ethdenver-kickoff-123',
};

describe('parseJsonLdBlocks', () => {
	it('parses multiple blocks and flattens @graph containers', () => {
		const html = `
			<html><head>
			<script type="application/ld+json">${JSON.stringify(EVENT_NODE)}</script>
			<script type="application/ld+json">${JSON.stringify({
				'@context': 'https://schema.org',
				'@graph': [
					{ '@type': 'Organization', name: 'Eventbrite' },
					{ '@type': 'BreadcrumbList', itemListElement: [] },
				],
			})}</script>
			<script type="application/ld+json">not valid json {{{</script>
			</head><body></body></html>`;

		const nodes = parseJsonLdBlocks(html);
		expect(nodes).toHaveLength(3);
		expect(nodes[0]?.['@type']).toBe('MusicEvent');
		expect(nodes[1]?.['@type']).toBe('Organization');
	});
});

describe('microdata plugin', () => {
	function htmlFetcher(html: string) {
		return () => Promise.resolve(new Response(html, { headers: { 'content-type': 'text/html' } }));
	}

	function request(url: string): EnrichmentRequest {
		return {
			input: {
				atomType: 'thing',
				jsonLd: { '@context': 'https://schema.org/', url },
				source: { classificationEngine: 'url-first-manual', classifiedAt: '2026-06-11T00:00:00Z' },
				hints: { url },
			},
			runtime: 'server',
		};
	}

	const ctx = {
		now: () => '2026-06-11T00:00:00.000Z',
		signal: undefined,
		logger: console,
	} as never;

	it('emits a microdata artifact with the page json-ld', async () => {
		const plugin = createMicrodataPlugin({
			fetch: htmlFetcher(
				`<html><head><title>Kickoff</title><script type="application/ld+json">${JSON.stringify(EVENT_NODE)}</script></head></html>`
			),
		});
		const artifacts = await plugin.enrich(request('https://www.eventbrite.com/e/abc-123'), ctx);
		expect(artifacts).toHaveLength(1);
		const jsonLd = artifacts[0]?.data.jsonLd as Record<string, unknown>[];
		expect(jsonLd[0]?.name).toBe('ETHDenver 2027 Kickoff Concert');
	});

	it('emits nothing for pages without json-ld and skips maps urls', async () => {
		const plugin = createMicrodataPlugin({ fetch: htmlFetcher('<html><body>hi</body></html>') });
		expect(await plugin.enrich(request('https://example.com/'), ctx)).toHaveLength(0);
		expect(plugin.supports(request('https://maps.app.goo.gl/abc'))).toBe(false);
		expect(plugin.supports(request('https://www.eventbrite.com/e/abc'))).toBe(true);
	});
});

describe('page-native field extraction', () => {
	it('fills event from page Event json-ld including subtype + composed address', async () => {
		const url = 'https://www.eventbrite.com/e/ethdenver-kickoff-123';
		const result = await extractClassificationFields({
			classification: 'event',
			url,
			artifacts: [microdataArtifact([EVENT_NODE], url)],
			fetcher: noFetch,
		});

		expect(result.values.name).toBe('ETHDenver 2027 Kickoff Concert');
		expect(result.values.startDate).toBe('2027-02-18');
		expect(result.values.location).toBe('Mission Ballroom');
		expect(result.missingRequired).toEqual([]);
		expect(result.fields.name?.source).toBe('page');
	});

	it('fills news-article with headline and truncated datePublished', async () => {
		const url = 'https://news.example.com/story';
		const result = await extractClassificationFields({
			classification: 'news-article',
			url,
			artifacts: [
				microdataArtifact(
					[
						{
							'@type': 'NewsArticle',
							headline: 'Protocol Ships URL-First Creation',
							datePublished: '2026-06-11T08:30:00Z',
							author: { '@type': 'Person', name: 'A. Reporter' },
						},
					],
					url
				),
			],
			fetcher: noFetch,
		});

		expect(result.values.headline).toBe('Protocol Ships URL-First Creation');
		expect(result.values.datePublished).toBe('2026-06-11');
		expect(result.missingRequired).toEqual([]);
	});

	it('fills job-posting with hiring organization name from a nested entity', async () => {
		const url = 'https://boards.example.com/jobs/123';
		const result = await extractClassificationFields({
			classification: 'job-posting',
			url,
			artifacts: [
				microdataArtifact(
					[
						{
							'@type': 'JobPosting',
							title: 'Senior Protocol Engineer',
							hiringOrganization: { '@type': 'Organization', name: 'Intuition Systems' },
							jobLocation: {
								'@type': 'Place',
								address: {
									'@type': 'PostalAddress',
									addressLocality: 'Denver',
									addressRegion: 'CO',
								},
							},
							datePosted: '2026-06-01',
						},
					],
					url
				),
			],
			fetcher: noFetch,
		});

		expect(result.values.title).toBe('Senior Protocol Engineer');
		expect(result.values.hiringOrganization).toBe('Intuition Systems');
		expect(result.values.jobLocation).toBe('Denver, CO');
		expect(result.values.datePosted).toBe('2026-06-01');
		expect(result.missingRequired).toEqual([]);
	});

	it('fills product with brand name and gtin13 alias', async () => {
		const url = 'https://shop.example.com/p/widget';
		const result = await extractClassificationFields({
			classification: 'product',
			url,
			artifacts: [
				microdataArtifact(
					[
						{
							'@type': 'Product',
							name: 'Acme Widget Pro',
							brand: { '@type': 'Brand', name: 'Acme' },
							sku: 'WID-PRO-1',
							gtin13: '0123456789012',
						},
					],
					url
				),
			],
			fetcher: noFetch,
		});

		expect(result.values.name).toBe('Acme Widget Pro');
		expect(result.values.brand).toBe('Acme');
		expect(result.values.gtin).toBe('0123456789012');
		expect(result.missingRequired).toEqual([]);
	});

	it('provider extractors still outrank page-native values', async () => {
		const url = 'https://en.wikipedia.org/wiki/OpenAI';
		const result = await extractClassificationFields({
			classification: 'company',
			url,
			artifacts: [
				microdataArtifact([{ '@type': 'Organization', name: 'OpenAI (page)' }], url),
				{
					artifact_type: 'wikidata',
					data: { entityId: 'Q21708200', label: 'OpenAI', claims: {} },
					meta: {
						pluginId: 'wikidata',
						provider: 'wikidata',
						fetchedAt: '2026-06-11T00:00:00.000Z',
					},
				},
			],
			fetcher: noFetch,
		});

		expect(result.values.name).toBe('OpenAI');
		expect(result.fields.name?.source).toBe('wikidata');
	});

	it('suggests the classification from the page json-ld type', () => {
		const suggestions = suggestClassifications('https://www.eventbrite.com/e/abc-123', [
			microdataArtifact([EVENT_NODE], 'https://www.eventbrite.com/e/abc-123'),
		]);
		expect(suggestions).toEqual(['event']);
	});
});

describe('cdata-wrapped json-ld (letterboxd style)', () => {
	it('strips CDATA comment guards before parsing', () => {
		const html = `<script type="application/ld+json">
/* <![CDATA[ */
{"@type":"Movie","name":"Inception","aggregateRating":{"ratingValue":4.23}}
/* ]]> */
</script>`;
		const nodes = parseJsonLdBlocks(html);
		expect(nodes).toHaveLength(1);
		expect(nodes[0]?.name).toBe('Inception');
	});
});

describe('json-ld image extraction', () => {
	it('reads string, ImageObject, and array image forms', async () => {
		const eventWithImages = {
			...EVENT_NODE,
			image: [
				{ '@type': 'ImageObject', url: 'https://img.evbuc.com/banner-event.jpg' },
				'https://img.evbuc.com/banner-2.jpg',
			],
		};
		const plugin = createMicrodataPlugin({
			fetch: () =>
				Promise.resolve(
					new Response(
						`<html><head><script type="application/ld+json">${JSON.stringify(eventWithImages)}</script></head></html>`,
						{ headers: { 'content-type': 'text/html' } }
					)
				),
		});
		const artifacts = await plugin.enrich(
			{
				input: {
					atomType: 'thing',
					jsonLd: { '@context': 'https://schema.org/', url: 'https://www.eventbrite.com/e/abc' },
					source: { classificationEngine: 'probe', classifiedAt: '2026-06-11T00:00:00Z' },
					hints: { url: 'https://www.eventbrite.com/e/abc' },
				},
				runtime: 'server',
			},
			{ now: () => '2026-06-11T00:00:00.000Z', signal: undefined, logger: console } as never
		);
		expect(artifacts[0]?.data.imageUrl).toBe('https://img.evbuc.com/banner-event.jpg');
	});
});

describe('apple podcasts pages (CreativeWorkSeries)', () => {
	it('fills podcast-series from apple podcasts json-ld', async () => {
		const url = 'https://podcasts.apple.com/us/podcast/the-daily/id1200361736';
		const result = await extractClassificationFields({
			classification: 'podcast-series',
			url,
			artifacts: [
				microdataArtifact([{ '@type': 'CreativeWorkSeries', name: 'The Daily', url }], url),
			],
			fetcher: noFetch,
		});
		expect(result.values.name).toBe('The Daily');
		expect(result.missingRequired).toEqual([]);
	});
});
