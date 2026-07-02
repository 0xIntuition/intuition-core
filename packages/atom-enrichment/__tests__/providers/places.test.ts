import { describe, expect, it } from 'bun:test';
import type { FetchLike } from '../../src/plugins/providers/__shared__/http';
import { createPlacesPlugin, parseMapsUrl } from '../../src/plugins/providers/places';
import type { EnrichmentRequest } from '../../src/types';

const EIFFEL_URL =
	'https://www.google.com/maps/place/Eiffel+Tower/@48.8583701,2.2922926,17z/data=!3m1!4b1';

function request(url: string): EnrichmentRequest {
	return {
		input: {
			atomType: 'place',
			jsonLd: { '@context': 'https://schema.org/', '@type': 'Place', url },
			source: { classificationEngine: 'url-first-manual', classifiedAt: '2026-06-11T00:00:00Z' },
			hints: { url },
		},
		runtime: 'server',
	};
}

const ctx = { now: () => '2026-06-11T00:00:00.000Z', signal: undefined, logger: console } as never;

function searchFetcher(input: {
	displayName: string;
	formattedAddress?: string;
	assertBody?: (body: Record<string, unknown>) => void;
}): FetchLike {
	return (url, init) => {
		if (!url.includes('places:searchText')) {
			throw new Error(`unexpected fetch ${url}`);
		}
		const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
		input.assertBody?.(body);
		return Promise.resolve(
			new Response(
				JSON.stringify({
					places: [
						{
							id: 'ChIJLU7jZClu5kcR4PcOOO6p3I0',
							displayName: { text: input.displayName },
							formattedAddress: input.formattedAddress ?? 'Av. Gustave Eiffel, 75007 Paris, France',
							location: { latitude: 48.85837, longitude: 2.294481 },
							types: ['tourist_attraction'],
							rating: 4.7,
							userRatingCount: 412000,
							websiteUri: 'https://www.toureiffel.paris/',
							internationalPhoneNumber: '+33 892 70 12 39',
							regularOpeningHours: { weekdayDescriptions: ['Monday: 9:30 AM – 11:00 PM'] },
						},
					],
				}),
				{ headers: { 'content-type': 'application/json' } }
			)
		);
	};
}

describe('parseMapsUrl', () => {
	it('parses name and coordinates from long place urls', () => {
		expect(parseMapsUrl(EIFFEL_URL)).toEqual({
			name: 'Eiffel Tower',
			latitude: 48.8583701,
			longitude: 2.2922926,
		});
	});

	it('parses q= search urls', () => {
		expect(parseMapsUrl('https://www.google.com/maps?q=Blue+Bottle+Coffee')).toEqual({
			name: 'Blue Bottle Coffee',
		});
	});

	it('parses coordinate-only urls', () => {
		const target = parseMapsUrl('https://www.google.com/maps/@40.7484405,-73.9856644,15z');
		expect(target?.latitude).toBe(40.7484405);
		expect(target?.name).toBeUndefined();
	});

	it('rejects non-maps urls', () => {
		expect(parseMapsUrl('https://www.google.com/search?q=eiffel')).toBeUndefined();
		expect(parseMapsUrl('https://en.wikipedia.org/wiki/Eiffel_Tower')).toBeUndefined();
	});
});

describe('places plugin', () => {
	it('supports maps urls and short links, not generic urls', () => {
		const plugin = createPlacesPlugin();
		expect(plugin.supports(request(EIFFEL_URL))).toBe(true);
		expect(plugin.supports(request('https://maps.app.goo.gl/abc123'))).toBe(true);
		expect(plugin.supports(request('https://example.com/'))).toBe(false);
	});

	it('emits a keyless artifact from url-derived name and coordinates', async () => {
		const plugin = createPlacesPlugin();
		const artifacts = await plugin.enrich(request(EIFFEL_URL), ctx);
		expect(artifacts).toHaveLength(1);
		expect(artifacts[0]?.data).toMatchObject({
			name: 'Eiffel Tower',
			latitude: 48.8583701,
			longitude: 2.2922926,
		});
		expect(artifacts[0]?.data.formattedAddress).toBeUndefined();
	});

	it('confirms the place via text search with location bias when keyed', async () => {
		const plugin = createPlacesPlugin({
			apiKey: 'test-key',
			fetch: searchFetcher({
				displayName: 'Eiffel Tower',
				assertBody: (body) => {
					expect(body.textQuery).toBe('Eiffel Tower');
					expect(body.locationBias).toMatchObject({
						circle: { center: { latitude: 48.8583701, longitude: 2.2922926 } },
					});
				},
			}),
		});
		const artifacts = await plugin.enrich(request(EIFFEL_URL), ctx);
		expect(artifacts[0]?.data).toMatchObject({
			name: 'Eiffel Tower',
			formattedAddress: 'Av. Gustave Eiffel, 75007 Paris, France',
			phoneNumber: '+33 892 70 12 39',
			website: 'https://www.toureiffel.paris/',
			rating: 4.7,
		});
	});

	it('falls back to url-derived data when the top result name does not match', async () => {
		const plugin = createPlacesPlugin({
			apiKey: 'test-key',
			fetch: searchFetcher({ displayName: 'Completely Different Restaurant' }),
		});
		const artifacts = await plugin.enrich(request(EIFFEL_URL), ctx);
		expect(artifacts[0]?.data.name).toBe('Eiffel Tower');
		expect(artifacts[0]?.data.formattedAddress).toBeUndefined();
	});

	it('returns nothing for coordinate-only urls without an api key', async () => {
		const plugin = createPlacesPlugin();
		const artifacts = await plugin.enrich(
			request('https://www.google.com/maps/@40.7484405,-73.9856644,15z'),
			ctx
		);
		expect(artifacts).toHaveLength(0);
	});
});

describe('places photo resolution', () => {
	function photoFetcher(input: { photoUri?: string; displayName: string }): FetchLike {
		return (url, init) => {
			if (url.includes('places:searchText')) {
				const body = JSON.parse(String(init?.body ?? '{}')) as { textQuery?: string };
				if (!body.textQuery) throw new Error('missing textQuery');
				return Promise.resolve(
					new Response(
						JSON.stringify({
							places: [
								{
									id: 'place-1',
									displayName: { text: input.displayName },
									formattedAddress: 'Av. Gustave Eiffel, 75007 Paris, France',
									photos: [{ name: 'places/place-1/photos/photo-1' }],
								},
							],
						}),
						{ headers: { 'content-type': 'application/json' } }
					)
				);
			}
			if (url.includes('/photos/photo-1/media')) {
				if (!url.includes('skipHttpRedirect=true')) throw new Error('must skip redirect');
				return Promise.resolve(
					new Response(
						JSON.stringify({
							name: 'places/place-1/photos/photo-1',
							...(input.photoUri ? { photoUri: input.photoUri } : {}),
						}),
						{ headers: { 'content-type': 'application/json' } }
					)
				);
			}
			throw new Error(`unexpected fetch ${url}`);
		};
	}

	it('stores the key-free photoUri as photoUrl', async () => {
		const plugin = createPlacesPlugin({
			apiKey: 'test-key',
			fetch: photoFetcher({
				displayName: 'Eiffel Tower',
				photoUri: 'https://lh3.googleusercontent.com/places/photo-abc=s1600',
			}),
		});
		const artifacts = await plugin.enrich(request(EIFFEL_URL), ctx);
		expect(artifacts[0]?.data.photoUrl).toBe(
			'https://lh3.googleusercontent.com/places/photo-abc=s1600'
		);
	});

	it('refuses photo uris that embed the api key', async () => {
		const plugin = createPlacesPlugin({
			apiKey: 'test-key',
			fetch: photoFetcher({
				displayName: 'Eiffel Tower',
				photoUri: 'https://example.com/photo?key=test-key',
			}),
		});
		const artifacts = await plugin.enrich(request(EIFFEL_URL), ctx);
		expect(artifacts[0]?.data.photoUrl).toBeUndefined();
	});

	it('degrades cleanly when the media lookup returns no uri', async () => {
		const plugin = createPlacesPlugin({
			apiKey: 'test-key',
			fetch: photoFetcher({ displayName: 'Eiffel Tower' }),
		});
		const artifacts = await plugin.enrich(request(EIFFEL_URL), ctx);
		expect(artifacts[0]?.data.name).toBe('Eiffel Tower');
		expect(artifacts[0]?.data.photoUrl).toBeUndefined();
	});
});

describe('places identifier-chained targets', () => {
	function identifierRequest(identifiers: Record<string, string>): EnrichmentRequest {
		const url = 'https://en.wikipedia.org/wiki/Eiffel_Tower';
		return {
			input: {
				atomType: 'place',
				jsonLd: { '@context': 'https://schema.org/', '@type': 'Place', url },
				source: { classificationEngine: 'url-first-manual', classifiedAt: '2026-06-11T00:00:00Z' },
				hints: { url, identifiers },
			},
			runtime: 'server',
		};
	}

	it('supports chained placeQuery identifiers without a maps url', () => {
		const plugin = createPlacesPlugin();
		expect(
			plugin.supports(
				identifierRequest({
					placeQuery: 'Eiffel Tower',
					placeLatitude: '48.8583701',
					placeLongitude: '2.2944813',
				})
			)
		).toBe(true);
	});

	it('searches with the chained label and coordinates when keyed', async () => {
		const plugin = createPlacesPlugin({
			apiKey: 'test-key',
			fetch: searchFetcher({
				displayName: 'Eiffel Tower',
				assertBody: (body) => {
					expect(body.textQuery).toBe('Eiffel Tower');
					expect(body.locationBias).toMatchObject({
						circle: { center: { latitude: 48.8583701, longitude: 2.2944813 } },
					});
				},
			}),
		});
		const artifacts = await plugin.enrich(
			identifierRequest({
				placeQuery: 'Eiffel Tower',
				placeLatitude: '48.8583701',
				placeLongitude: '2.2944813',
			}),
			ctx
		);
		expect(artifacts[0]?.data.formattedAddress).toBe('Av. Gustave Eiffel, 75007 Paris, France');
		expect(artifacts[0]?.meta.sourceUrl).toContain('google.com/maps/search');
	});
});
