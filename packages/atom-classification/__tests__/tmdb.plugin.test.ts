import { describe, expect, it } from 'bun:test';

import { createServerEngine } from '../src/server';
import { createDefaultTestPlugins } from './helpers/default-plugins';

describe('tmdb platform plugin', () => {
	const fixtures = [
		{
			input: 'https://www.themoviedb.org/movie/550-fight-club',
			classificationSessionId: 'tmdb-movie-url',
			subtype: 'movie',
			schemaType: 'Movie',
			title: 'TMDB Movie 550',
			canonicalId: 'tmdb:movie:550',
			canonicalUrl: 'https://www.themoviedb.org/movie/550',
		},
		{
			input: 'https://www.themoviedb.org/tv/1396-breaking-bad',
			classificationSessionId: 'tmdb-tv-url',
			subtype: 'tv',
			schemaType: 'TVSeries',
			title: 'TMDB TV Series 1396',
			canonicalId: 'tmdb:tv:1396',
			canonicalUrl: 'https://www.themoviedb.org/tv/1396',
		},
	] as const;

	for (const fixture of fixtures) {
		it(`classifies ${fixture.subtype} URLs as first-class TMDB identity inputs`, async () => {
			const engine = createServerEngine({
				plugins: createDefaultTestPlugins(),
			});

			const result = await engine.classify({
				input: fixture.input,
				mode: 'progressive',
				classificationSessionId: fixture.classificationSessionId,
			});

			const atom = result.resolved?.atoms[0];
			const classification = result.resolved?.classifications[0];

			expect(result.status).toBe('complete');
			expect(result.classification).toMatchObject({
				domain: 'tmdb',
				subtype: fixture.subtype,
				meta: {
					mediaType: fixture.subtype,
					tmdbId: fixture.canonicalId.split(':').at(-1),
					canonicalUrl: fixture.canonicalUrl,
				},
			});
			expect(result.resolved?.resolverId).toBe('tmdb-resolver');
			expect(atom).toMatchObject({
				schemaType: fixture.schemaType,
				category: 'thing',
				title: fixture.title,
				canonicalId: fixture.canonicalId,
				sameAs: [fixture.canonicalUrl],
			});
			expect(atom?.data).toMatchObject({
				'@type': fixture.schemaType,
				identifier: fixture.canonicalId,
				sameAs: [fixture.canonicalUrl],
			});
			expect(classification).toMatchObject({
				type: fixture.schemaType,
				meta: {
					pluginId: 'tmdb',
					provider: 'tmdb',
					sourceUrl: fixture.canonicalUrl,
				},
			});
		});
	}

	it('does not classify unsupported TMDB paths', async () => {
		const engine = createServerEngine({
			plugins: createDefaultTestPlugins(),
		});

		const result = await engine.classify({
			input: 'https://www.themoviedb.org/person/287-brad-pitt',
			mode: 'progressive',
			classificationSessionId: 'tmdb-unsupported-path',
			pluginIds: ['tmdb'],
		});

		expect(result.classification).toBeUndefined();
		expect(result.resolved).toBeUndefined();
	});
});
