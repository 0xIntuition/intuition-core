import { describe, expect, it } from 'bun:test';

import { toClassifiedAtomInput } from '../src/handoff';

describe('classification to enrichment handoff', () => {
	it('preserves podcast atoms from resolved atom output', () => {
		const input = toClassifiedAtomInput('https://open.spotify.com/episode/episode-id', {
			resolved: {
				atoms: [
					{
						category: 'podcast',
						schemaType: 'PodcastEpisode',
						title: 'AI Acceleration',
						sameAs: ['https://open.spotify.com/episode/episode-id'],
					},
				],
			},
		});

		expect(input?.atomType).toBe('podcast');
		expect(input?.jsonLd['@type']).toBe('PodcastEpisode');
	});

	it('maps canonical podcast envelopes to podcast atom type', () => {
		const input = toClassifiedAtomInput('https://open.spotify.com/show/show-id', {
			resolved: {
				publishable: [
					{
						type: 'PodcastSeries',
						data: {
							name: 'The AI Daily Brief',
							sameAs: ['https://open.spotify.com/show/show-id'],
						},
						meta: {
							sourceUrl: 'https://open.spotify.com/show/show-id',
						},
					},
				],
			},
		});

		expect(input?.atomType).toBe('podcast');
		expect(input?.jsonLd['@type']).toBe('PodcastSeries');
	});
});

for (const canonical of [false, true]) {
	it(`carries atom provenance with ${canonical ? 'publishable' : 'atom'} presentation`, () => {
		const input = toClassifiedAtomInput('https://www.imdb.com/title/tt1234567', {
			resolved: {
				atoms: [
					{
						category: 'thing',
						schemaType: 'Movie',
						title: 'IMDb Title tt1234567',
						...{ metadata: { provider: 'imdb', fallbackStage: 'generic' } },
					},
				],
				...(canonical
					? {
							publishable: [
								{
									type: 'Movie',
									data: { name: 'IMDb Title tt1234567' },
									meta: { sourceUrl: 'https://www.imdb.com/title/tt1234567' },
								},
							],
						}
					: {}),
			},
		});
		expect(input?.source).toMatchObject({ provider: 'imdb', fallbackStage: 'generic' });
	});
}
it('carries resolver provenance when atom metadata is absent', () => {
	const input = toClassifiedAtomInput('https://www.goodreads.com/book/show/123', {
		classification: {
			domain: 'goodreads',
			meta: { platformResolver: { domain: 'goodreads', fallbackStage: 'generic' } },
		},
		resolved: { atoms: [{ category: 'thing', schemaType: 'Book', title: 'Goodreads Book 123' }] },
	});
	expect(input?.source).toMatchObject({ provider: 'goodreads', fallbackStage: 'generic' });
});
