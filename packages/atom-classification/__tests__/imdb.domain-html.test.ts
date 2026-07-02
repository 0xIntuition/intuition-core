import { describe, expect, it } from 'bun:test';

import { createClassificationEngine } from '../src/engine';
import {
	createImdbDomainHtmlAdapter,
	createImdbPlugin,
	createV0TypeProfilesPlugin,
} from '../src/index';

describe('imdb domain-html adapter', () => {
	it('extracts deterministic title identity from imdb title html', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createV0TypeProfilesPlugin(),
				createImdbPlugin({
					adapters: {
						domainHtml: createImdbDomainHtmlAdapter({
							fetch: async () => ({
								ok: true,
								status: 200,
								text: async () => IMDB_TITLE_HTML,
							}),
						}),
					},
				}),
			],
		});

		const result = await engine.classify({
			input: 'https://www.imdb.com/title/tt0133093/',
			mode: 'progressive',
			classificationSessionId: 'imdb-title-domain-html',
		});

		expect(result.status).toBe('complete');
		expect(result.resolved?.fallbackUsed).toBe(false);
		expect(result.resolved?.atoms[0]?.schemaType).toBe('Movie');
		expect(result.resolved?.atoms[0]?.title).toBe('The Matrix');
		expect(result.resolved?.atoms[0]?.description).toBe(
			'A computer hacker learns about the true nature of reality.'
		);
		expect(result.resolved?.atoms[0]?.canonicalId).toBe('imdb:title:tt0133093');
		expect(result.resolved?.classifications[0]?.data).toMatchObject({
			image: 'https://m.media-amazon.com/images/M/MV5BM.jpg',
		});
		expect(result.resolved?.publishable[0]?.data).toEqual({
			'@context': 'https://schema.org/',
			'@type': 'Movie',
			name: 'The Matrix',
			url: 'https://www.imdb.com/title/tt0133093/',
			sameAs: ['https://www.imdb.com/title/tt0133093/'],
		});
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('image');
	});

	it('extracts deterministic person identity from imdb person html', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createV0TypeProfilesPlugin(),
				createImdbPlugin({
					adapters: {
						domainHtml: createImdbDomainHtmlAdapter({
							fetch: async () => ({
								ok: true,
								status: 200,
								text: async () => IMDB_PERSON_HTML,
							}),
						}),
					},
				}),
			],
		});

		const result = await engine.classify({
			input: 'https://www.imdb.com/name/nm0000206/',
			mode: 'progressive',
			classificationSessionId: 'imdb-person-domain-html',
		});

		expect(result.status).toBe('complete');
		expect(result.resolved?.atoms[0]?.schemaType).toBe('Person');
		expect(result.resolved?.atoms[0]?.title).toBe('Keanu Reeves');
		expect(result.resolved?.atoms[0]?.description).toBe('Canadian actor known for The Matrix.');
		expect(result.resolved?.atoms[0]?.canonicalId).toBe('imdb:name:nm0000206');
		expect(result.resolved?.classifications[0]?.data).toMatchObject({
			image: 'https://m.media-amazon.com/images/M/MV5BKeanu.jpg',
		});
		expect(result.resolved?.publishable[0]?.data).toEqual({
			'@context': 'https://schema.org/',
			'@type': 'Person',
			name: 'Keanu Reeves',
			url: 'https://www.imdb.com/name/nm0000206/',
			sameAs: ['https://www.imdb.com/name/nm0000206/'],
		});
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('image');
	});

	it('falls back to imdb suggestion data when imdb html returns a waf challenge page', async () => {
		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createV0TypeProfilesPlugin(),
				createImdbPlugin({
					adapters: {
						domainHtml: createImdbDomainHtmlAdapter({
							fetch: async (input) => ({
								ok: true,
								status: 200,
								text: async () =>
									input.includes('suggestion/t/tt0133093.json')
										? IMDB_TITLE_SUGGESTION_JSON
										: IMDB_WAF_HTML,
							}),
						}),
					},
				}),
			],
		});

		const result = await engine.classify({
			input: 'https://www.imdb.com/title/tt0133093/',
			mode: 'progressive',
			classificationSessionId: 'imdb-title-suggestion-fallback',
		});

		expect(result.status).toBe('complete');
		expect(result.resolved?.fallbackUsed).toBe(false);
		expect(result.resolved?.atoms[0]?.title).toBe('The Matrix');
		expect(result.resolved?.atoms[0]?.metadata.provider).toBe('imdb-suggestion');
		expect(result.resolved?.classifications[0]?.data).toMatchObject({
			image:
				'https://m.media-amazon.com/images/M/MV5BN2NmN2VhMTQtMDNiOS00NDlhLTliMjgtODE2ZTY0ODQyNDRhXkEyXkFqcGc@._V1_.jpg',
		});
		expect(result.resolved?.publishable[0]?.data).toEqual({
			'@context': 'https://schema.org/',
			'@type': 'Movie',
			name: 'The Matrix',
			url: 'https://www.imdb.com/title/tt0133093/',
			sameAs: ['https://www.imdb.com/title/tt0133093/'],
		});
		expect(result.resolved?.publishable[0]?.data).not.toHaveProperty('image');
	});
});

const IMDB_TITLE_HTML = `
<!doctype html>
<html>
<head>
  <link rel="canonical" href="https://www.imdb.com/title/tt0133093/" />
  <title>The Matrix (1999) - IMDb</title>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Movie",
      "name": "The Matrix",
      "description": "A computer hacker learns about the true nature of reality.",
      "url": "https://www.imdb.com/title/tt0133093/",
      "image": "https://m.media-amazon.com/images/M/MV5BM.jpg"
    }
  </script>
</head>
<body></body>
</html>
`;

const IMDB_PERSON_HTML = `
<!doctype html>
<html>
<head>
  <link rel="canonical" href="https://www.imdb.com/name/nm0000206/" />
  <title>Keanu Reeves - IMDb</title>
  <script type="application/ld+json">
    {
      "@context": "https://schema.org",
      "@type": "Person",
      "name": "Keanu Reeves",
      "description": "Canadian actor known for The Matrix.",
      "url": "https://www.imdb.com/name/nm0000206/",
      "image": "https://m.media-amazon.com/images/M/MV5BKeanu.jpg"
    }
  </script>
</head>
<body></body>
</html>
`;

const IMDB_WAF_HTML = `
<!doctype html>
<html>
<head>
  <title></title>
  <script>window.gokuProps = {"key":"challenge"};</script>
</head>
<body>
  <div id="challenge-container"></div>
</body>
</html>
`;

const IMDB_TITLE_SUGGESTION_JSON = `{"d":[{"i":{"height":3156,"imageUrl":"https://m.media-amazon.com/images/M/MV5BN2NmN2VhMTQtMDNiOS00NDlhLTliMjgtODE2ZTY0ODQyNDRhXkEyXkFqcGc@._V1_.jpg","width":2100},"id":"tt0133093","l":"The Matrix","q":"feature","qid":"movie","rank":391,"s":"Keanu Reeves, Laurence Fishburne","y":1999}],"q":"tt0133093","v":1}`;
