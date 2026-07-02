import { describe, expect, it } from 'bun:test';

import { createNonUrlV0Profiles, createPlatformV0Profiles } from '../src/plugins/index';
import type { ClassificationClientClassificationHint, ClassificationRequest } from '../src/types';

describe('builtin profile modularity', () => {
	it('keeps non-url classifier and resolver outputs colocated by profile', async () => {
		const profiles = createNonUrlV0Profiles();
		expect(profiles.map((profile) => profile.id)).toEqual([
			'ethereum',
			'isbn',
			'lexical',
			'plain-text',
		]);

		const fixtures: Array<{
			profileId: string;
			request: ClassificationRequest;
			classification: ClassificationClientClassificationHint;
			expectedSchemaType: string;
		}> = [
			{
				profileId: 'ethereum',
				request: {
					input: '0x1111111111111111111111111111111111111111',
					mode: 'progressive',
					inputIntent: 'generic',
					classificationSessionId: 'profile-ethereum',
				},
				classification: {
					type: 'address',
					domain: 'ethereum',
					subtype: 'account',
					confidence: 0.99,
					meta: {
						address: '0x1111111111111111111111111111111111111111',
					},
				},
				expectedSchemaType: 'EthereumAccount',
			},
			{
				profileId: 'isbn',
				request: {
					input: 'ISBN 9780306406157',
					mode: 'progressive',
					inputIntent: 'generic',
					classificationSessionId: 'profile-isbn',
				},
				classification: {
					type: 'identifier',
					domain: 'isbn',
					subtype: 'isbn-13',
					confidence: 0.98,
					meta: {
						normalizedIsbn: '9780306406157',
					},
				},
				expectedSchemaType: 'Book',
			},
			{
				profileId: 'lexical',
				request: {
					input: 'semantic',
					mode: 'progressive',
					inputIntent: 'generic',
					classificationSessionId: 'profile-lexical',
				},
				classification: {
					type: 'text',
					domain: 'lexical',
					subtype: 'word',
					confidence: 0.71,
					meta: {
						tokenCount: 1,
						normalizedTerm: 'semantic',
					},
				},
				expectedSchemaType: 'DefinedTerm',
			},
			{
				profileId: 'plain-text',
				request: {
					input: 'semantic grounding',
					mode: 'progressive',
					inputIntent: 'generic',
					classificationSessionId: 'profile-plain-text',
				},
				classification: {
					type: 'text',
					domain: 'plain-text',
					subtype: 'phrase',
					confidence: 0.61,
					meta: {
						tokenCount: 2,
					},
				},
				expectedSchemaType: 'Thing',
			},
		];

		for (const fixture of fixtures) {
			const profile = profiles.find((entry) => entry.id === fixture.profileId);
			expect(profile).toBeDefined();
			if (!profile) {
				continue;
			}

			expect(profile.canResolve(fixture.classification, fixture.request)).toBe(true);
			const resolution = await Promise.resolve(
				profile.resolve({
					runtime: 'server',
					request: fixture.request,
					classification: fixture.classification,
					now: new Date().toISOString(),
				})
			);
			expect(resolution?.classifications?.[0]?.type ?? resolution?.atoms?.[0]?.schemaType).toBe(
				fixture.expectedSchemaType
			);
		}
	});

	it('defines per-domain generic output contracts for platform profiles', () => {
		const profiles = createPlatformV0Profiles();
		expect(profiles.map((profile) => profile.domain)).toEqual([
			'spotify',
			'amazon',
			'github',
			'npm',
			'x',
			'instagram',
			'tiktok',
			'youtube',
			'wikipedia',
			'imdb',
			'tmdb',
		]);

		const fixtures: Array<{
			domain: (typeof profiles)[number]['domain'];
			classification: ClassificationClientClassificationHint;
			expectedSchemaType: string;
		}> = [
			{
				domain: 'spotify',
				classification: {
					type: 'url',
					domain: 'spotify',
					subtype: 'track',
					confidence: 0.99,
					meta: {
						resourceId: '4iV5W9uYEdYUVa79Axb7Rh',
					},
				},
				expectedSchemaType: 'MusicRecording',
			},
			{
				domain: 'amazon',
				classification: {
					type: 'url',
					domain: 'amazon',
					subtype: 'product',
					confidence: 0.96,
					meta: {
						asin: 'B08N5WRWNW',
					},
				},
				expectedSchemaType: 'Product',
			},
			{
				domain: 'github',
				classification: {
					type: 'url',
					domain: 'github',
					subtype: 'repo',
					confidence: 0.99,
					meta: {
						owner: '0xIntuition',
						repo: 'intuition-v2',
					},
				},
				expectedSchemaType: 'SoftwareSourceCode',
			},
			{
				domain: 'npm',
				classification: {
					type: 'url',
					domain: 'npm',
					subtype: 'package',
					confidence: 0.99,
					meta: {
						packageName: 'hono',
						canonicalUrl: 'https://www.npmjs.com/package/hono',
					},
				},
				expectedSchemaType: 'SoftwareSourceCode',
			},
			{
				domain: 'x',
				classification: {
					type: 'url',
					domain: 'x',
					subtype: 'post',
					confidence: 0.98,
					meta: {
						handle: 'intuition',
						postId: '123',
					},
				},
				expectedSchemaType: 'SocialMediaPosting',
			},
			{
				domain: 'instagram',
				classification: {
					type: 'url',
					domain: 'instagram',
					subtype: 'video',
					confidence: 0.97,
					meta: {
						shortcode: 'C4f6h1M0abc',
					},
				},
				expectedSchemaType: 'VideoObject',
			},
			{
				domain: 'tiktok',
				classification: {
					type: 'url',
					domain: 'tiktok',
					subtype: 'video',
					confidence: 0.98,
					meta: {
						videoId: '7345678901234567890',
					},
				},
				expectedSchemaType: 'VideoObject',
			},
			{
				domain: 'youtube',
				classification: {
					type: 'url',
					domain: 'youtube',
					subtype: 'video',
					confidence: 0.99,
					meta: {
						videoId: 'dQw4w9WgXcQ',
					},
				},
				expectedSchemaType: 'VideoObject',
			},
			{
				domain: 'wikipedia',
				classification: {
					type: 'url',
					domain: 'wikipedia',
					subtype: 'article',
					confidence: 0.95,
					meta: {
						articleTitle: 'Notion (software)',
						inferredSchemaType: 'SoftwareApplication',
						inferredCategory: 'software',
					},
				},
				expectedSchemaType: 'SoftwareApplication',
			},
			{
				domain: 'imdb',
				classification: {
					type: 'url',
					domain: 'imdb',
					subtype: 'title',
					confidence: 0.98,
					meta: {
						titleId: 'tt0133093',
					},
				},
				expectedSchemaType: 'Movie',
			},
			{
				domain: 'tmdb',
				classification: {
					type: 'url',
					domain: 'tmdb',
					subtype: 'tv',
					confidence: 0.99,
					meta: {
						mediaType: 'tv',
						tmdbId: '1396',
						canonicalUrl: 'https://www.themoviedb.org/tv/1396',
					},
				},
				expectedSchemaType: 'TVSeries',
			},
		];

		for (const fixture of fixtures) {
			const profile = profiles.find((entry) => entry.domain === fixture.domain);
			expect(profile).toBeDefined();
			if (!profile) {
				continue;
			}

			const atom = profile.resolveGeneric({
				classification: fixture.classification,
				requestInput: `https://${fixture.domain}.com/resource`,
				canonicalUrl: `https://${fixture.domain}.com/resource`,
				now: new Date().toISOString(),
			});

			expect(atom?.schemaType).toBe(fixture.expectedSchemaType);
			expect(atom?.metadata?.platform).toBe(fixture.domain);
		}
	});
});
