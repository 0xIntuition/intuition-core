import { describe, expect, it } from 'bun:test';
import { extractClassificationFields } from '../src/extraction/extract';
import {
	readEntityIdClaimValues,
	readTimeClaimValue,
	resolveWikidataEntityLabels,
} from '../src/extraction/wikidata-claims';
import type { FetchLike } from '../src/plugins/providers/__shared__/http';
import type { EnrichmentArtifact } from '../src/types';

const WIKIPEDIA_URL = 'https://en.wikipedia.org/wiki/Vitalik_Buterin';

function artifact(
	artifactType: string,
	data: Record<string, unknown>,
	sourceUrl?: string
): EnrichmentArtifact {
	return {
		artifact_type: artifactType,
		data,
		meta: {
			pluginId: artifactType,
			provider: artifactType,
			fetchedAt: '2026-06-10T00:00:00.000Z',
			...(sourceUrl ? { sourceUrl } : {}),
		},
	};
}

// Mirrors the live Wikidata shape verified for Q16197959: entity-valued
// claims for P735/P734 and a labels endpoint where the family-name entity
// only carries a `mul` label.
const VITALIK_CLAIMS = {
	P735: [
		{
			mainsnak: {
				datavalue: { value: { 'entity-type': 'item', 'numeric-id': 653298, id: 'Q653298' } },
			},
			rank: 'normal',
		},
	],
	P734: [
		{
			mainsnak: {
				datavalue: {
					value: { 'entity-type': 'item', 'numeric-id': 106248757, id: 'Q106248757' },
				},
			},
			rank: 'normal',
		},
	],
	P569: [
		{
			mainsnak: {
				datavalue: {
					value: { time: '+1994-01-31T00:00:00Z', precision: 11 },
				},
			},
			rank: 'normal',
		},
	],
};

const WIKIDATA_ARTIFACT = artifact(
	'wikidata',
	{
		entityId: 'Q16197959',
		label: 'Vitalik Buterin',
		description: 'Russian-Canadian programmer (born 1994)',
		claims: VITALIK_CLAIMS,
		sitelinks: { enwiki: WIKIPEDIA_URL },
		instanceOf: ['Q5'],
	},
	WIKIPEDIA_URL
);

const WIKIPEDIA_ARTIFACT = artifact(
	'wikipedia',
	{
		title: 'Vitalik Buterin',
		extract:
			'Vitaly Dmitrievich Buterin, better known as Vitalik Buterin, is a Russian-Canadian computer programmer best known for co-founding Ethereum.',
		pageUrl: WIKIPEDIA_URL,
		language: 'en',
		wikibaseItem: 'Q16197959',
	},
	WIKIPEDIA_URL
);

const OPENGRAPH_ARTIFACT = artifact(
	'opengraph',
	{
		title: 'Vitalik Buterin - Wikipedia',
		description: 'Open graph description.',
		url: WIKIPEDIA_URL,
	},
	WIKIPEDIA_URL
);

function labelsFetcher(labelsByEntity: Record<string, Record<string, string>>): FetchLike {
	return (input) => {
		if (!input.includes('wbgetentities')) {
			throw new Error(`Unexpected fetch: ${input}`);
		}
		const requestedIds = new URL(input).searchParams.get('ids')?.split('|') ?? [];
		const entities = Object.fromEntries(
			requestedIds.map((id) => [
				id,
				{
					labels: Object.fromEntries(
						Object.entries(labelsByEntity[id] ?? {}).map(([language, value]) => [
							language,
							{ value },
						])
					),
				},
			])
		);
		return Promise.resolve(
			new Response(JSON.stringify({ entities }), {
				headers: { 'content-type': 'application/json' },
			})
		);
	};
}

const VITALIK_LABELS = {
	Q653298: { en: 'Vitaly' },
	Q106248757: { mul: 'Buterin' },
};

describe('wikidata claim readers', () => {
	it('reads entity-id claim values in order and skips deprecated ranks', () => {
		const claims = {
			P735: [
				{ mainsnak: { datavalue: { value: { id: 'Q1' } } }, rank: 'deprecated' },
				{ mainsnak: { datavalue: { value: { id: 'Q2' } } }, rank: 'normal' },
				{ mainsnak: { datavalue: { value: { id: 'Q3' } } }, rank: 'normal' },
			],
		};
		expect(readEntityIdClaimValues(claims, 'P735')).toEqual(['Q2', 'Q3']);
	});

	it('prefers preferred-rank statements when present', () => {
		const claims = {
			P735: [
				{ mainsnak: { datavalue: { value: { id: 'Q2' } } }, rank: 'normal' },
				{ mainsnak: { datavalue: { value: { id: 'Q9' } } }, rank: 'preferred' },
			],
		};
		expect(readEntityIdClaimValues(claims, 'P735')).toEqual(['Q9']);
	});

	it('reads day-precision time claims as ISO dates and rejects coarser precision', () => {
		expect(readTimeClaimValue(VITALIK_CLAIMS, 'P569')).toBe('1994-01-31');
		const yearOnly = {
			P569: [
				{ mainsnak: { datavalue: { value: { time: '+1994-00-00T00:00:00Z', precision: 9 } } } },
			],
		};
		expect(readTimeClaimValue(yearOnly, 'P569')).toBeUndefined();
	});

	it('resolves labels with en -> mul fallback', async () => {
		const labels = await resolveWikidataEntityLabels(
			labelsFetcher(VITALIK_LABELS),
			['Q653298', 'Q106248757'],
			{ language: 'en' }
		);
		expect(labels.get('Q653298')).toBe('Vitaly');
		expect(labels.get('Q106248757')).toBe('Buterin');
	});
});

describe('extractClassificationFields', () => {
	it('deterministically builds Person fields from wikidata P735/P734', async () => {
		const result = await extractClassificationFields({
			classification: 'person',
			url: WIKIPEDIA_URL,
			artifacts: [WIKIPEDIA_ARTIFACT, WIKIDATA_ARTIFACT, OPENGRAPH_ARTIFACT],
			fetcher: labelsFetcher(VITALIK_LABELS),
		});

		expect(result.values.givenName).toBe('Vitaly');
		expect(result.values.familyName).toBe('Buterin');
		expect(result.missingRequired).toEqual([]);
		expect(result.fields.givenName?.source).toBe('wikidata');
		expect(result.fields.givenName?.confidence).toBeGreaterThanOrEqual(0.9);
		expect(result.fields.givenName?.evidenceUrl).toBe('https://www.wikidata.org/wiki/Q16197959');
	});

	it('reports missing required fields instead of fabricating values', async () => {
		const result = await extractClassificationFields({
			classification: 'person',
			url: WIKIPEDIA_URL,
			artifacts: [WIKIPEDIA_ARTIFACT, OPENGRAPH_ARTIFACT],
			fetcher: labelsFetcher({}),
		});

		expect(result.values.givenName).toBeUndefined();
		expect(result.values.familyName).toBeUndefined();
		expect(result.missingRequired).toEqual(['givenName', 'familyName']);
	});

	it('fills generic name/description/url/sameAs for specs like thing', async () => {
		const result = await extractClassificationFields({
			classification: 'thing',
			url: WIKIPEDIA_URL,
			artifacts: [WIKIPEDIA_ARTIFACT, WIKIDATA_ARTIFACT, OPENGRAPH_ARTIFACT],
			fetcher: labelsFetcher(VITALIK_LABELS),
		});

		expect(result.values.name).toBe('Vitalik Buterin');
		expect(result.fields.name?.source).toBe('wikidata');
		expect(result.values.description).toBe('Russian-Canadian programmer (born 1994)');
		expect(result.missingRequired).toEqual([]);
	});

	it('prefers wikipedia title over opengraph title when wikidata is absent', async () => {
		const result = await extractClassificationFields({
			classification: 'thing',
			url: WIKIPEDIA_URL,
			artifacts: [OPENGRAPH_ARTIFACT, WIKIPEDIA_ARTIFACT],
			fetcher: labelsFetcher({}),
		});

		expect(result.values.name).toBe('Vitalik Buterin');
		expect(result.fields.name?.source).toBe('wikipedia');
	});

	it('includes url and sameAs from the input url for specs that define them', async () => {
		const result = await extractClassificationFields({
			classification: 'company',
			url: 'https://example.com/',
			artifacts: [
				artifact(
					'opengraph',
					{ title: 'Example', description: 'An example site.', url: 'https://example.com/' },
					'https://example.com/'
				),
			],
			fetcher: labelsFetcher({}),
		});

		expect(result.values.url).toBe('https://example.com/');
		expect(result.values.sameAs).toEqual(['https://example.com/']);
		expect(result.fields.url?.source).toBe('input-url');
	});

	it('drops values that fail spec validation instead of returning them', async () => {
		const result = await extractClassificationFields({
			classification: 'web-site',
			url: 'not-a-url',
			artifacts: [],
			fetcher: labelsFetcher({}),
		});

		expect(result.values.url).toBeUndefined();
		expect(result.droppedFields.some((dropped) => dropped.key === 'url')).toBe(true);
	});

	it('throws for an unknown classification slug', async () => {
		await expect(
			extractClassificationFields({
				classification: 'not-a-spec',
				url: WIKIPEDIA_URL,
				artifacts: [],
				fetcher: labelsFetcher({}),
			})
		).rejects.toThrow('Unknown classification');
	});
});

// ── Wave 1 entity mappers (live-shape fixtures: OpenAI Q21708200, Inception
// Q25188, Breaking Bad Q1079, Eiffel Tower Q243 — see classification-parity-spec.md) ──

function entityClaim(id: string) {
	return [{ mainsnak: { datavalue: { value: { 'entity-type': 'item', id } } }, rank: 'normal' }];
}

function stringClaim(value: string) {
	return [{ mainsnak: { datavalue: { value } }, rank: 'normal' }];
}

function timeClaim(time: string, precision = 11) {
	return [{ mainsnak: { datavalue: { value: { time, precision } } }, rank: 'normal' }];
}

const OPENAI_WIKIDATA = artifact(
	'wikidata',
	{
		entityId: 'Q21708200',
		label: 'OpenAI',
		description: 'American artificial intelligence company',
		claims: {
			P856: stringClaim('https://openai.com/'),
			P571: timeClaim('+2015-12-11T00:00:00Z'),
			P2002: stringClaim('OpenAI'),
			P4264: stringClaim('openai'),
		},
		instanceOf: ['Q6881511'],
	},
	'https://en.wikipedia.org/wiki/OpenAI'
);

const OPENAI_URL = 'https://en.wikipedia.org/wiki/OpenAI';

describe('wave 1 entity mappers', () => {
	it('company: fills name/url/sameAs deterministically from wikidata (OpenAI exit test)', async () => {
		const result = await extractClassificationFields({
			classification: 'company',
			url: OPENAI_URL,
			artifacts: [
				artifact(
					'wikipedia',
					{
						title: 'OpenAI',
						extract: 'OpenAI is an AI company.',
						pageUrl: OPENAI_URL,
						language: 'en',
						wikibaseItem: 'Q21708200',
					},
					OPENAI_URL
				),
				OPENAI_WIKIDATA,
			],
			fetcher: labelsFetcher({}),
		});

		expect(result.values.name).toBe('OpenAI');
		expect(result.values.url).toBe('https://openai.com/');
		expect(result.values.sameAs).toEqual([
			OPENAI_URL,
			'https://www.wikidata.org/wiki/Q21708200',
			'https://x.com/OpenAI',
			'https://www.linkedin.com/company/openai',
		]);
		expect(result.missingRequired).toEqual([]);
		expect(result.fields.url?.source).toBe('wikidata');
	});

	it('movie: datePublished from P577 and provider urls in sameAs', async () => {
		const result = await extractClassificationFields({
			classification: 'movie',
			url: 'https://en.wikipedia.org/wiki/Inception',
			artifacts: [
				artifact(
					'wikidata',
					{
						entityId: 'Q25188',
						label: 'Inception',
						claims: {
							P577: timeClaim('+2010-07-08T00:00:00Z'),
							P345: stringClaim('tt1375666'),
							P4947: stringClaim('27205'),
						},
					},
					'https://en.wikipedia.org/wiki/Inception'
				),
			],
			fetcher: labelsFetcher({}),
		});

		expect(result.values.name).toBe('Inception');
		expect(result.values.datePublished).toBe('2010-07-08');
		expect(result.values.sameAs).toContain('https://www.imdb.com/title/tt1375666/');
		expect(result.values.sameAs).toContain('https://www.themoviedb.org/movie/27205');
		expect(result.missingRequired).toEqual([]);
	});

	it('tv-series: start and end dates from P580/P582', async () => {
		const result = await extractClassificationFields({
			classification: 'tv-series',
			url: 'https://en.wikipedia.org/wiki/Breaking_Bad',
			artifacts: [
				artifact(
					'wikidata',
					{
						entityId: 'Q1079',
						label: 'Breaking Bad',
						claims: {
							P580: timeClaim('+2008-01-20T00:00:00Z'),
							P582: timeClaim('+2013-09-29T00:00:00Z'),
						},
					},
					'https://en.wikipedia.org/wiki/Breaking_Bad'
				),
			],
			fetcher: labelsFetcher({}),
		});

		expect(result.values.startDate).toBe('2008-01-20');
		expect(result.values.endDate).toBe('2013-09-29');
	});

	it('book: author resolved from P50 entity label', async () => {
		const result = await extractClassificationFields({
			classification: 'book',
			url: 'https://en.wikipedia.org/wiki/The_Great_Gatsby',
			artifacts: [
				artifact(
					'wikidata',
					{
						entityId: 'Q214371',
						label: 'The Great Gatsby',
						claims: { P50: entityClaim('Q40908') },
					},
					'https://en.wikipedia.org/wiki/The_Great_Gatsby'
				),
			],
			fetcher: labelsFetcher({ Q40908: { en: 'F. Scott Fitzgerald' } }),
		});

		expect(result.values.name).toBe('The Great Gatsby');
		expect(result.values.author).toBe('F. Scott Fitzgerald');
	});

	it('event: startDate and location label from P580/P276', async () => {
		const result = await extractClassificationFields({
			classification: 'event',
			url: 'https://en.wikipedia.org/wiki/Woodstock',
			artifacts: [
				artifact(
					'wikidata',
					{
						entityId: 'Q164815',
						label: 'Woodstock',
						claims: {
							P580: timeClaim('+1969-08-15T00:00:00Z'),
							P276: entityClaim('Q748044'),
						},
					},
					'https://en.wikipedia.org/wiki/Woodstock'
				),
			],
			fetcher: labelsFetcher({ Q748044: { en: 'Bethel' } }),
		});

		expect(result.values.startDate).toBe('1969-08-15');
		expect(result.values.location).toBe('Bethel');
	});

	it('location: address composed from admin area and country labels', async () => {
		const result = await extractClassificationFields({
			classification: 'location',
			url: 'https://en.wikipedia.org/wiki/Eiffel_Tower',
			artifacts: [
				artifact(
					'wikidata',
					{
						entityId: 'Q243',
						label: 'Eiffel Tower',
						claims: {
							P131: entityClaim('Q90'),
							P17: entityClaim('Q142'),
						},
					},
					'https://en.wikipedia.org/wiki/Eiffel_Tower'
				),
			],
			fetcher: labelsFetcher({ Q90: { en: 'Paris' }, Q142: { en: 'France' } }),
		});

		expect(result.values.name).toBe('Eiffel Tower');
		expect(result.values.address).toBe('Paris, France');
		expect(result.fields.address?.confidence).toBeLessThan(0.9);
	});

	it('drops year-precision dates instead of fabricating a day', async () => {
		const result = await extractClassificationFields({
			classification: 'movie',
			url: 'https://en.wikipedia.org/wiki/Some_Film',
			artifacts: [
				artifact(
					'wikidata',
					{
						entityId: 'Q999',
						label: 'Some Film',
						claims: { P577: timeClaim('+1994-00-00T00:00:00Z', 9) },
					},
					'https://en.wikipedia.org/wiki/Some_Film'
				),
			],
			fetcher: labelsFetcher({}),
		});

		expect(result.values.datePublished).toBeUndefined();
		expect(result.values.name).toBe('Some Film');
	});
});
