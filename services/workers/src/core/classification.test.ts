import { describe, expect, test } from 'bun:test';
import {
	deriveClassificationPlan,
	deriveClassificationResultFromRuntime,
	deriveIidClassificationResult,
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

const ladderProjection = {
	primary: { rung: 'handle', iid: 'int:spotify:album:fixture' },
	rungs: [],
	provenance: { producer: 'fake-ladder', version: '1.2.3' },
};
const ladder = {
	projectIdentityRungs: (_input: unknown) => ladderProjection,
	isPlainWdPrimaryAllowed: () => false,
};

test('attaches rung projection to IID classification when semantic context exists', () => {
	const result = deriveIidClassificationResult({
		identity: {
			raw: 'isbn',
			canonical: 'int:isbn:9780684832722',
			scheme: 'isbn',
			value: '9780684832722',
			anchorEligible: true,
			provenance: ladderProjection.provenance,
		},
		resolution: {
			identityDecision: {
				status: 'classified',
				schemaType: 'Book',
				provenance: ladderProjection.provenance,
			},
			providerPlan: { status: 'unsupported', targets: [], provenance: ladderProjection.provenance },
		},
		ladder,
	});
	expect(result.identityRungs).toEqual(ladderProjection);
});

test('passes plugin canonical identity and semantic context at the runtime conversion boundary', () => {
	let received: unknown;
	const result = deriveClassificationResultFromRuntime({
		classification: {
			resolved: {
				atoms: [
					{
						schemaType: 'MusicAlbum',
						category: 'thing',
						canonicalId: 'spotify:album:fixture',
						hints: { identifiers: { gtin: '123' } },
					},
				],
			},
		} as unknown as Parameters<typeof deriveClassificationResultFromRuntime>[0]['classification'],
		targetUrl: 'https://open.spotify.com/album/fixture',
		targetSource: 'raw_input',
		ladder: {
			...ladder,
			projectIdentityRungs: (input) => {
				received = input;
				return ladderProjection;
			},
		},
	});
	expect(received).toMatchObject({
		schemaType: 'MusicAlbum',
		category: 'thing',
		providerCanonicalId: 'spotify:album:fixture',
		identifiers: { gtin: '123' },
	});
	expect(result.identityRungs).toEqual(ladderProjection);
});
