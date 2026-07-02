import { describe, expect, test } from 'bun:test';
import {
	deriveClassificationPlan,
	resolveClassificationType,
	type WorkerClassificationResult,
} from './classification';

describe('KG classification core', () => {
	test('classifies recognized structured JSON-LD without invoking runtime', () => {
		const plan = deriveClassificationPlan({
			rawInput: null,
			parseResult: {
				kind: 'json',
				normalizedInput: '{}',
				structuredDocument: {
					source: 'inline_json',
					format: 'jsonld',
					topLevelType: 'object',
					schemaType: 'WebSite',
					data: {
						'@context': 'https://schema.org',
						'@type': 'WebSite',
						url: 'https://example.com',
					},
					urlCandidates: [{ field: 'url', url: 'https://example.com' }],
				},
			},
		});

		expect(plan.usesStructuredDocument).toBe(true);
		expect(plan.runtimeInput).toBeUndefined();
		expect(plan.classificationResult).toMatchObject({
			status: 'recognized',
			schemaType: 'WebSite',
			targetUrl: 'https://example.com',
			targetSource: 'structured_document',
		});
	});

	test('falls back to remote URL when structured JSON-LD has no URL candidate', () => {
		const plan = deriveClassificationPlan({
			rawInput: 'https://example.com/page',
			parseResult: {
				kind: 'url',
				normalizedInput: 'https://example.com/page',
				canonicalId: 'https://example.com/page',
				remote: {
					finalUrl: 'https://example.com/final',
					contentType: 'application/ld+json',
					subtype: 'json_document',
				},
				structuredDocument: {
					source: 'resolved_url',
					format: 'jsonld',
					topLevelType: 'object',
					schemaType: 'WebSite',
					data: { '@type': 'WebSite', name: 'Example' },
					urlCandidates: [],
				},
			},
		});

		expect(plan.classificationResult).toMatchObject({
			status: 'recognized',
			schemaType: 'WebSite',
			targetUrl: 'https://example.com/final',
			targetSource: 'remote_final_url',
		});
	});

	test('uses sameAs as structured target when URL candidates are unavailable', () => {
		const plan = deriveClassificationPlan({
			rawInput: null,
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

		expect(plan.classificationResult).toMatchObject({
			status: 'recognized',
			schemaType: 'MusicRecording',
			targetUrl: 'https://open.spotify.com/track/1qbmS6ep2hbBRaEZFpn7BX',
			targetSource: 'structured_document_same_as',
		});
	});

	test('promotes stable classification type with Unknown fallback', () => {
		expect(
			resolveClassificationType({ schemaType: 'MusicRecording' } as WorkerClassificationResult)
		).toBe('MusicRecording');
		expect(resolveClassificationType({ category: 'thing' } as WorkerClassificationResult)).toBe(
			'thing'
		);
		expect(resolveClassificationType({ status: 'not_applicable', source: 'raw_input' })).toBe(
			'Unknown'
		);
	});
});
