import { describe, expect, test } from 'bun:test';
import {
	buildClassifiedInputFromPlan,
	deriveEnrichmentPlan,
	getArtifactTypeAllowListForEnrichmentPlan,
} from './enrichment';

describe('KG enrichment core', () => {
	test('prefers classification target URL over parse fallbacks', () => {
		const plan = deriveEnrichmentPlan({
			rawInput: 'https://raw.example',
			classificationResult: {
				status: 'recognized',
				source: 'inline_json',
				schemaType: 'WebSite',
				category: 'thing',
				targetUrl: 'https://classified.example',
				targetSource: 'structured_document',
			},
			parseResult: {
				kind: 'url',
				normalizedInput: 'https://raw.example',
				canonicalId: 'https://raw.example',
				remote: {
					finalUrl: 'https://remote.example',
					contentType: 'text/html',
					subtype: 'webpage',
				},
			},
		});

		expect(plan.targetUrl).toBe('https://classified.example');
		expect(getArtifactTypeAllowListForEnrichmentPlan(plan)).toEqual([
			'opengraph',
			'favicon',
			'brand',
		]);
	});

	test('builds classified input from structured document data', () => {
		const plan = deriveEnrichmentPlan({
			rawInput: null,
			classificationResult: {
				status: 'recognized',
				source: 'inline_json',
				schemaType: 'MusicRecording',
				category: 'song',
				targetUrl: 'https://open.spotify.com/track/123',
				targetSource: 'structured_document',
			},
			parseResult: {
				kind: 'json',
				normalizedInput: '{}',
				structuredDocument: {
					source: 'inline_json',
					format: 'jsonld',
					topLevelType: 'object',
					schemaType: 'MusicRecording',
					data: {
						'@context': 'https://schema.org',
						'@type': 'MusicRecording',
						name: 'Fixture Track',
						description: 'Track description',
						url: 'https://stale.example/track',
					},
					urlCandidates: [],
				},
			},
		});

		const input = buildClassifiedInputFromPlan(plan);
		expect(input).toMatchObject({
			atomType: 'song',
			hints: {
				name: 'Fixture Track',
				description: 'Track description',
				url: 'https://open.spotify.com/track/123',
			},
			jsonLd: {
				'@type': 'MusicRecording',
				name: 'Fixture Track',
				url: 'https://open.spotify.com/track/123',
			},
		});
	});

	test('normalizes classification category when building enrichment input', () => {
		const input = buildClassifiedInputFromPlan({
			targetUrl: 'https://example.com',
			structuredDocument: undefined,
			classificationResult: {
				status: 'recognized',
				source: 'runtime',
				category: 'Software',
			},
		});

		expect(input?.atomType).toBe('software');
	});

	test('uses sameAs as enrichment target when structured data has no url field', () => {
		const plan = deriveEnrichmentPlan({
			rawInput: null,
			classificationResult: {
				status: 'recognized',
				source: 'inline_json',
				schemaType: 'MusicRecording',
				category: 'song',
			},
			parseResult: {
				kind: 'json',
				normalizedInput: '{}',
				structuredDocument: {
					source: 'inline_json',
					format: 'jsonld',
					topLevelType: 'object',
					schemaType: 'MusicRecording',
					data: {
						'@context': 'https://schema.org/',
						'@type': 'MusicRecording',
						byArtist: 'Olivia Dean',
						name: 'Man I Need',
						sameAs: ['https://open.spotify.com/track/1qbmS6ep2hbBRaEZFpn7BX'],
					},
					urlCandidates: [],
				},
			},
		});

		const input = buildClassifiedInputFromPlan(plan);
		expect(plan.targetUrl).toBe('https://open.spotify.com/track/1qbmS6ep2hbBRaEZFpn7BX');
		expect(input).toMatchObject({
			atomType: 'song',
			hints: {
				name: 'Man I Need',
				url: 'https://open.spotify.com/track/1qbmS6ep2hbBRaEZFpn7BX',
			},
			jsonLd: {
				'@type': 'MusicRecording',
				name: 'Man I Need',
				url: 'https://open.spotify.com/track/1qbmS6ep2hbBRaEZFpn7BX',
				sameAs: ['https://open.spotify.com/track/1qbmS6ep2hbBRaEZFpn7BX'],
			},
		});
		expect(getArtifactTypeAllowListForEnrichmentPlan(plan)).toEqual([
			'opengraph',
			'favicon',
			'brand',
			'spotify',
			'wikipedia',
			'wikidata',
		]);
	});

	test('returns null when there is no object document or URL target', () => {
		const input = buildClassifiedInputFromPlan({
			targetUrl: undefined,
			structuredDocument: undefined,
			classificationResult: {
				status: 'not_applicable',
				source: 'raw_input',
			},
		});

		expect(input).toBeNull();
	});
});
