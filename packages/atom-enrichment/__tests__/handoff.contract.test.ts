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
