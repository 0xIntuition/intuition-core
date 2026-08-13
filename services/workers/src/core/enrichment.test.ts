import { describe, expect, test } from 'bun:test';
import {
	buildClassifiedInputFromPlan,
	buildEnrichmentCompletionPromotedFields,
	buildIidProviderExecutionPlan,
	deriveEnrichmentPlan,
	evaluateEnrichmentCompletion,
	evaluateEnrichmentProcessingScope,
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
		expect(buildEnrichmentCompletionPromotedFields(plan)).toMatchObject({
			dataResolved: {
				'@type': 'MusicRecording',
				name: 'Fixture Track',
				description: 'Track description',
			},
			searchText: 'Fixture Track Track description',
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

	test('normalizes podcast classification category when building enrichment input', () => {
		const input = buildClassifiedInputFromPlan({
			targetUrl: 'https://open.spotify.com/show/123',
			structuredDocument: undefined,
			classificationResult: {
				status: 'recognized',
				source: 'runtime',
				schemaType: 'PodcastSeries',
				category: 'podcast',
			},
		});

		expect(input?.atomType).toBe('podcast');
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

	test('turns persisted identity handoffs into an explicit identifier enrichment request', () => {
		const identity = {
			raw: 'opaque raw identity',
			canonical: 'opaque canonical identity',
			scheme: 'fixture-scheme',
			value: 'fixture-value',
			profile: 'p0' as const,
			anchorEligible: true,
			provenance: { producer: 'adapter', version: 'test' },
		};
		const providerPlan = {
			status: 'planned' as const,
			targets: [
				{
					provider: 'openlibrary',
					capabilities: ['metadata'],
					identifierHints: [{ kind: 'isbn', value: '9780684832722' }],
				},
			],
			provenance: { producer: 'registry-adapter', version: 'test' },
		};
		const plan = deriveEnrichmentPlan({
			rawInput: null,
			parseResult: { kind: 'iid', normalizedInput: identity.raw, identity },
			classificationResult: {
				status: 'recognized',
				source: 'future-adapter',
				identity,
				providerPlan,
			},
		});

		expect(plan.identity).toEqual(identity);
		expect(plan.providerPlan).toEqual(providerPlan);
		expect(buildClassifiedInputFromPlan(plan)).toMatchObject({
			hints: { identifiers: { isbn: '9780684832722' } },
		});
		expect(buildIidProviderExecutionPlan({ plan, registeredPluginIds: ['openlibrary'] })).toEqual({
			status: 'ready',
			plugins: ['openlibrary'],
			identifiers: { isbn: '9780684832722' },
		});
		expect(buildEnrichmentCompletionPromotedFields(plan)).toBeUndefined();
		expect(
			buildEnrichmentCompletionPromotedFields(plan, [
				{
					artifact_type: 'openlibrary',
					data: {
						title: 'The Sovereign Individual',
						authors: ['James Dale Davidson', 'William Rees-Mogg'],
						coverUrl: 'https://covers.example/gatsby.jpg',
					},
					meta: {
						pluginId: 'openlibrary',
						provider: 'openlibrary',
						fetchedAt: '2026-08-12T00:00:00.000Z',
						sourceUrl: 'https://openlibrary.org/books/OL7721520M',
					},
				},
			])
		).toMatchObject({
			dataResolved: {
				name: 'The Sovereign Individual',
				image: 'https://covers.example/gatsby.jpg',
				resolution: { provider: 'openlibrary', identity: identity.canonical },
			},
			searchText: 'The Sovereign Individual James Dale Davidson William Rees-Mogg',
		});
	});

	test('distinguishes retryable plugin drift from terminal unknown provider drift', () => {
		const basePlan = {
			targetUrl: undefined,
			structuredDocument: undefined,
			identity: {
				raw: 'int:isbn:9780684832722',
				canonical: 'int:isbn:9780684832722',
				scheme: 'isbn',
				value: '9780684832722',
				anchorEligible: true,
				provenance: { producer: 'adapter', version: 'test' },
			},
			classificationResult: { status: 'recognized' as const, source: 'iid-registry' },
		};
		const target = {
			capabilities: ['metadata'],
			identifierHints: [{ kind: 'isbn', value: '9780684832722' }],
		};

		expect(
			buildIidProviderExecutionPlan({
				plan: {
					...basePlan,
					providerPlan: {
						status: 'planned',
						targets: [{ ...target, provider: 'openlibrary' }],
						provenance: { producer: 'registry', version: 'test' },
					},
				},
				registeredPluginIds: [],
			})
		).toMatchObject({ status: 'blocked', retriable: true });
		expect(
			buildIidProviderExecutionPlan({
				plan: {
					...basePlan,
					providerPlan: {
						status: 'planned',
						targets: [{ ...target, provider: 'not-a-provider' }],
						provenance: { producer: 'registry', version: 'test' },
					},
				},
				registeredPluginIds: [],
			})
		).toMatchObject({ status: 'blocked', retriable: false });
	});

	test('classifies zero-artifact outcomes without reporting terminal misses as resolved', () => {
		const retryableError = {
			pluginId: 'fixture-provider',
			code: 'rate_limited' as const,
			message: 'retry later',
			retriable: true,
		};
		const skipped = [{ pluginId: 'not-applicable-provider', reason: 'not applicable' }];

		expect(
			evaluateEnrichmentCompletion({ artifacts: [], errors: [retryableError], skipped })
		).toMatchObject({
			kind: 'retryable_failure',
			diagnostics: { errors: [retryableError], skipped },
		});
		expect(
			evaluateEnrichmentCompletion({
				artifacts: [],
				errors: [{ ...retryableError, retriable: false }],
				skipped,
			})
		).toMatchObject({
			kind: 'terminal_unresolved',
			diagnostics: { errors: [{ ...retryableError, retriable: false }], skipped },
		});
		expect(evaluateEnrichmentCompletion({ artifacts: [], errors: [], skipped })).toMatchObject({
			kind: 'terminal_unresolved',
			diagnostics: { errors: [], skipped },
		});
	});

	test('bounds retained diagnostics for zero-artifact outcomes', () => {
		const result = evaluateEnrichmentCompletion({
			artifacts: [],
			errors: Array.from({ length: 30 }, (_, index) => ({
				pluginId: `provider-${index}`,
				code: 'validation_error' as const,
				message: 'x'.repeat(1_500),
				retriable: false,
			})),
			skipped: Array.from({ length: 30 }, (_, index) => ({
				pluginId: `skipped-${index}`,
				reason: 'y'.repeat(500),
			})),
		});

		expect(result.kind).toBe('terminal_unresolved');
		if (result.kind !== 'terminal_unresolved') {
			throw new Error('expected terminal unresolved result');
		}
		expect(result.diagnostics.errors).toHaveLength(25);
		expect(result.diagnostics.skipped).toHaveLength(25);
		expect(result.diagnostics.errors[0]?.message).toHaveLength(1_000);
		expect(result.diagnostics.skipped[0]?.reason).toHaveLength(256);
		expect(result.diagnostics).toMatchObject({
			totalErrors: 30,
			totalSkipped: 30,
			errorsTruncated: true,
			skippedTruncated: true,
		});
	});

	test('completes partial enrichment while retaining explicit errors and skips', () => {
		const result = {
			artifacts: [
				{
					artifact_type: 'opengraph',
					data: { title: 'Partial result' },
					meta: {
						pluginId: 'opengraph',
						provider: 'fixture',
						fetchedAt: '2026-08-10T00:00:00.000Z',
					},
				},
			],
			errors: [
				{
					pluginId: 'fixture-provider',
					code: 'upstream_error' as const,
					message: 'retry later',
					retriable: true,
				},
			],
			skipped: [{ pluginId: 'another-provider', reason: 'not applicable' }],
		};

		expect(evaluateEnrichmentCompletion(result)).toEqual({ kind: 'complete' });
		expect(result.errors).toHaveLength(1);
		expect(result.skipped).toHaveLength(1);
	});

	test('keeps full processing scope behavior unchanged', () => {
		const plan = deriveEnrichmentPlan({
			rawInput: 'https://example.com',
			classificationResult: {
				status: 'recognized',
				source: 'runtime',
				schemaType: 'WebSite',
				category: 'thing',
				targetUrl: 'https://example.com',
			},
			parseResult: null,
		});

		expect(evaluateEnrichmentProcessingScope({ plan, scope: 'full' })).toEqual({
			shouldEnrich: true,
			artifactTypes: ['opengraph', 'favicon', 'brand'],
			matchedDomains: [],
		});
	});

	test('allows music scope rows and narrows artifacts to music providers', () => {
		const plan = deriveEnrichmentPlan({
			rawInput: null,
			classificationResult: {
				status: 'recognized',
				source: 'inline_json',
				schemaType: 'MusicRecording',
				category: 'song',
				targetUrl: 'https://open.spotify.com/track/123',
			},
			parseResult: null,
		});

		expect(evaluateEnrichmentProcessingScope({ plan, scope: 'music' })).toEqual({
			shouldEnrich: true,
			artifactTypes: [
				'opengraph',
				'spotify',
				'musicbrainz',
				'apple-music',
				'wikipedia',
				'wikidata',
			],
			matchedDomains: ['music'],
		});
	});

	test('allows podcast scope rows and narrows artifacts to podcast providers', () => {
		const plan = deriveEnrichmentPlan({
			rawInput: null,
			classificationResult: {
				status: 'recognized',
				source: 'runtime',
				schemaType: 'WebPage',
				category: 'thing',
				targetUrl: 'https://podcasts.apple.com/us/podcast/example/id123',
			},
			parseResult: null,
		});

		expect(evaluateEnrichmentProcessingScope({ plan, scope: 'podcasts' })).toEqual({
			shouldEnrich: true,
			artifactTypes: [
				'opengraph',
				'spotify',
				'apple-music',
				'podcast-index',
				'wikipedia',
				'wikidata',
			],
			matchedDomains: ['podcast'],
		});
	});

	test('allows generic Apple Music URLs in music scope', () => {
		const plan = deriveEnrichmentPlan({
			rawInput: null,
			classificationResult: {
				status: 'recognized',
				source: 'runtime',
				schemaType: 'WebPage',
				category: 'thing',
				targetUrl: 'https://music.apple.com/us/album/example/123',
			},
			parseResult: null,
		});

		expect(evaluateEnrichmentProcessingScope({ plan, scope: 'music' })).toEqual({
			shouldEnrich: true,
			artifactTypes: [
				'opengraph',
				'spotify',
				'musicbrainz',
				'apple-music',
				'wikipedia',
				'wikidata',
			],
			matchedDomains: ['music'],
		});
	});

	test('allows www-prefixed podcast provider URLs in podcast scope', () => {
		const applePlan = deriveEnrichmentPlan({
			rawInput: null,
			classificationResult: {
				status: 'recognized',
				source: 'runtime',
				schemaType: 'WebPage',
				category: 'thing',
				targetUrl: 'https://www.podcasts.apple.com/us/podcast/example/id123',
			},
			parseResult: null,
		});
		const podcastIndexPlan = deriveEnrichmentPlan({
			rawInput: null,
			classificationResult: {
				status: 'recognized',
				source: 'runtime',
				schemaType: 'WebPage',
				category: 'thing',
				targetUrl: 'https://www.podcastindex.org/podcast/12345',
			},
			parseResult: null,
		});

		for (const plan of [applePlan, podcastIndexPlan]) {
			expect(evaluateEnrichmentProcessingScope({ plan, scope: 'podcasts' })).toEqual({
				shouldEnrich: true,
				artifactTypes: [
					'opengraph',
					'spotify',
					'apple-music',
					'podcast-index',
					'wikipedia',
					'wikidata',
				],
				matchedDomains: ['podcast'],
			});
		}
	});

	test('skips non-matching rows with an explainable processing scope reason', () => {
		const plan = deriveEnrichmentPlan({
			rawInput: 'https://github.com/0xIntuition/intuition-core',
			classificationResult: {
				status: 'recognized',
				source: 'runtime',
				schemaType: 'SoftwareSourceCode',
				category: 'software',
				targetUrl: 'https://github.com/0xIntuition/intuition-core',
			},
			parseResult: null,
		});

		expect(evaluateEnrichmentProcessingScope({ plan, scope: 'music-and-podcasts' })).toEqual({
			shouldEnrich: false,
			matchedDomains: [],
			reason:
				'Processing scope "music-and-podcasts" skipped enrichment for classification "SoftwareSourceCode" because it does not match music or podcast domains.',
		});
	});
});
