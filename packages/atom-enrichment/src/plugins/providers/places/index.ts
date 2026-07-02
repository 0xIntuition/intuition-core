import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import type { FetchLike } from '../__shared__/http';
import { getIdentifier, getRequestUrl } from '../__shared__/request';
import {
	type PlaceResult,
	placePhotoMediaResponseSchema,
	placesSearchTextResponseSchema,
} from './external';
import { placesDataSchema } from './schema';

type CreatePlacesPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	apiKey?: string;
};

export type MapsUrlTarget = {
	name?: string;
	latitude?: number;
	longitude?: number;
};

const SEARCH_TEXT_ENDPOINT = 'https://places.googleapis.com/v1/places:searchText';
const SEARCH_FIELD_MASK = [
	'places.id',
	'places.displayName',
	'places.formattedAddress',
	'places.location',
	'places.types',
	'places.rating',
	'places.userRatingCount',
	'places.websiteUri',
	'places.internationalPhoneNumber',
	'places.nationalPhoneNumber',
	'places.regularOpeningHours.weekdayDescriptions',
	'places.photos',
].join(',');
const PHOTO_MAX_WIDTH_PX = 1200;
const LOCATION_BIAS_RADIUS_METERS = 500;
const SHORT_LINK_HOSTS = new Set(['maps.app.goo.gl', 'goo.gl']);

// Google Maps URLs resolved through the Places API (New). Two tiers:
//   • keyless — the long-URL path already carries the place name and
//     coordinates; those parse deterministically with zero network calls.
//   • keyed — Text Search with locationBias confirms the place and fills
//     address/phone/hours/ratings. The top result is only accepted when its
//     name matches the URL-derived name (blank beats wrong).
export function createPlacesPlugin(options: CreatePlacesPluginOptions = {}): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);

	return defineEnrichmentPlugin({
		id: 'places',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['places'],
		priority: options.priority ?? 33,
		TTL: options.TTL ?? 43_200,

		supports(request: EnrichmentRequest) {
			if (resolveIdentifierTarget(request)) {
				return true;
			}
			const url = getRequestUrl(request);
			if (!url) return false;
			return isMapsShortLink(url) || parseMapsUrl(url) !== undefined;
		},

		async enrich(request, ctx) {
			const inputUrl = getRequestUrl(request);
			// Chained identifier targets (for example a wikidata label + P625
			// coordinates) take precedence — the request URL is then the source
			// page (e.g. Wikipedia), not a Maps URL.
			const identifierTarget = resolveIdentifierTarget(request);
			let target = identifierTarget;
			let sourceUrl = inputUrl;
			if (target) {
				sourceUrl = buildMapsSearchUrl(target);
			} else {
				if (!inputUrl) {
					return [];
				}
				const resolvedUrl = isMapsShortLink(inputUrl)
					? await expandShortLink(fetcher, inputUrl, ctx.signal)
					: inputUrl;
				target = resolvedUrl ? parseMapsUrl(resolvedUrl) : undefined;
			}
			if (!target?.name && !options.apiKey) {
				return [];
			}

			const place = options.apiKey
				? await searchPlace(fetcher, options.apiKey, target, ctx.signal, ctx.logger)
				: undefined;

			const confirmed = place && namesMatch(target?.name, place.displayName?.text);
			const name = confirmed ? place.displayName?.text : target?.name;
			if (!name) {
				return [];
			}

			const photoUrl =
				confirmed && options.apiKey
					? await resolvePhotoUri(fetcher, options.apiKey, place, ctx.signal, ctx.logger)
					: undefined;

			return [
				{
					artifact_type: 'places',
					data: placesDataSchema.parse({
						name,
						photoUrl,
						formattedAddress: confirmed ? place.formattedAddress : undefined,
						latitude: confirmed ? place.location?.latitude : target?.latitude,
						longitude: confirmed ? place.location?.longitude : target?.longitude,
						placeId: confirmed ? place.id : undefined,
						types: confirmed ? place.types : undefined,
						rating: confirmed ? place.rating : undefined,
						userRatingsTotal: confirmed ? place.userRatingCount : undefined,
						website: confirmed ? sanitizeHttpUrl(place.websiteUri) : undefined,
						phoneNumber: confirmed
							? (place.internationalPhoneNumber ?? place.nationalPhoneNumber)
							: undefined,
						openingHours: confirmed ? place.regularOpeningHours?.weekdayDescriptions : undefined,
					}),
					meta: {
						pluginId: 'places',
						provider: 'google-places',
						fetchedAt: ctx.now(),
						...(sourceUrl ? { sourceUrl } : {}),
					},
				},
			];
		},
	});
}

async function searchPlace(
	fetcher: FetchLike,
	apiKey: string,
	target: MapsUrlTarget | undefined,
	signal: AbortSignal | undefined,
	logger?: { warn(message: string, meta?: Record<string, unknown>): void }
): Promise<PlaceResult | undefined> {
	if (!target?.name) {
		return undefined;
	}

	try {
		const response = await fetcher(SEARCH_TEXT_ENDPOINT, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'X-Goog-Api-Key': apiKey,
				'X-Goog-FieldMask': SEARCH_FIELD_MASK,
			},
			body: JSON.stringify({
				textQuery: target.name,
				...(target.latitude !== undefined && target.longitude !== undefined
					? {
							locationBias: {
								circle: {
									center: { latitude: target.latitude, longitude: target.longitude },
									radius: LOCATION_BIAS_RADIUS_METERS,
								},
							},
						}
					: {}),
			}),
			...(signal ? { signal } : {}),
		});
		if (!response.ok) {
			// Surface API-level failures (disabled API, key restrictions, quota)
			// instead of degrading invisibly. Never log the key or full body.
			logger?.warn('places: text search failed; degrading to URL-derived data', {
				status: response.status,
				message: await readErrorMessage(response),
			});
			return undefined;
		}
		const payload = placesSearchTextResponseSchema.parse(await response.json());
		return payload.places?.[0];
	} catch (error) {
		logger?.warn('places: text search errored; degrading to URL-derived data', {
			message: error instanceof Error ? error.message : 'unknown error',
		});
		return undefined;
	}
}

// Resolves a place photo to its public CDN url. The media endpoint is called
// with `skipHttpRedirect=true` so it returns `photoUri` — a key-free
// googleusercontent link that is safe to persist in artifacts and render on
// the client (the naive media URL would embed the API key).
async function resolvePhotoUri(
	fetcher: FetchLike,
	apiKey: string,
	place: PlaceResult,
	signal: AbortSignal | undefined,
	logger?: { warn(message: string, meta?: Record<string, unknown>): void }
): Promise<string | undefined> {
	const photoName = place.photos?.[0]?.name;
	if (!photoName) {
		return undefined;
	}

	try {
		const response = await fetcher(
			`https://places.googleapis.com/v1/${photoName}/media?maxWidthPx=${PHOTO_MAX_WIDTH_PX}&skipHttpRedirect=true`,
			{
				headers: { 'X-Goog-Api-Key': apiKey },
				...(signal ? { signal } : {}),
			}
		);
		if (!response.ok) {
			logger?.warn('places: photo media lookup failed', { status: response.status });
			return undefined;
		}
		const payload = placePhotoMediaResponseSchema.parse(await response.json());
		const photoUri = payload.photoUri;
		if (!photoUri || !/^https:\/\//.test(photoUri) || photoUri.includes(apiKey)) {
			return undefined;
		}
		return photoUri;
	} catch (error) {
		logger?.warn('places: photo media lookup errored', {
			message: error instanceof Error ? error.message : 'unknown error',
		});
		return undefined;
	}
}

async function readErrorMessage(response: Response): Promise<string> {
	try {
		const payload = (await response.json()) as { error?: { message?: string } };
		return typeof payload.error?.message === 'string'
			? payload.error.message.slice(0, 300)
			: 'no error message';
	} catch {
		return 'unparseable error body';
	}
}

async function expandShortLink(
	fetcher: FetchLike,
	url: string,
	signal: AbortSignal | undefined
): Promise<string | undefined> {
	try {
		const response = await fetcher(url, {
			method: 'GET',
			redirect: 'follow',
			...(signal ? { signal } : {}),
		});
		return response.url || undefined;
	} catch {
		return undefined;
	}
}

// Chained targets arrive via identifiers (placeQuery + optional coordinates),
// for example from a wikidata label + P625 claim.
function resolveIdentifierTarget(request: EnrichmentRequest): MapsUrlTarget | undefined {
	const placeId = getIdentifier(request, 'placeId', 'googlePlaceId');
	const query = getIdentifier(request, 'placeQuery');
	if (!(placeId || query)) {
		return undefined;
	}

	const latitudeRaw = getIdentifier(request, 'placeLatitude');
	const longitudeRaw = getIdentifier(request, 'placeLongitude');
	const latitude = latitudeRaw !== undefined ? Number(latitudeRaw) : undefined;
	const longitude = longitudeRaw !== undefined ? Number(longitudeRaw) : undefined;
	const hasCoordinates =
		latitude !== undefined &&
		longitude !== undefined &&
		Number.isFinite(latitude) &&
		Number.isFinite(longitude);

	return {
		...(query ? { name: query } : {}),
		...(hasCoordinates ? { latitude, longitude } : {}),
	};
}

function buildMapsSearchUrl(target: MapsUrlTarget): string {
	const query =
		target.latitude !== undefined && target.longitude !== undefined
			? `${target.latitude},${target.longitude}`
			: (target.name ?? '');
	return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function isMapsShortLink(url: string): boolean {
	try {
		const host = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
		return SHORT_LINK_HOSTS.has(host);
	} catch {
		return false;
	}
}

const COORDS_SEGMENT_PATTERN = /^@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/;

// Long Maps URLs: google.com/maps/place/{Name}/@{lat},{lng},{zoom}z/…
// `?q=` search URLs carry the name (or "lat,lng") as a query parameter.
export function parseMapsUrl(url: string): MapsUrlTarget | undefined {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		return undefined;
	}

	const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
	const isGoogleHost = host === 'google.com' || host.endsWith('.google.com');
	if (!isGoogleHost || !parsed.pathname.startsWith('/maps')) {
		return undefined;
	}

	const segments = parsed.pathname.split('/').filter(Boolean);
	const target: MapsUrlTarget = {};

	const placeIndex = segments.indexOf('place');
	const nameSegment = placeIndex >= 0 ? segments[placeIndex + 1] : undefined;
	if (nameSegment && !COORDS_SEGMENT_PATTERN.test(nameSegment)) {
		const name = decodeMapsName(nameSegment);
		if (name) target.name = name;
	}

	for (const segment of segments) {
		const match = COORDS_SEGMENT_PATTERN.exec(segment);
		if (match?.[1] && match[2]) {
			target.latitude = Number(match[1]);
			target.longitude = Number(match[2]);
			break;
		}
	}

	if (!target.name) {
		const query = parsed.searchParams.get('q');
		if (query && !/^-?\d+(\.\d+)?,-?\d+(\.\d+)?$/.test(query.trim())) {
			target.name = query.trim();
		}
	}

	return target.name || target.latitude !== undefined ? target : undefined;
}

function decodeMapsName(segment: string): string | undefined {
	try {
		const decoded = decodeURIComponent(segment.replace(/\+/g, ' ')).trim();
		return decoded.length > 0 ? decoded : undefined;
	} catch {
		return undefined;
	}
}

function normalizeName(value: string): string {
	return value
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim();
}

function namesMatch(urlName: string | undefined, resultName: string | undefined): boolean {
	if (!resultName) return false;
	// Coordinate-only URLs have no name to verify against; accept the biased
	// top result in that case.
	if (!urlName) return true;
	const left = normalizeName(urlName);
	const right = normalizeName(resultName);
	if (left.length === 0 || right.length === 0) return false;
	return left === right || left.includes(right) || right.includes(left);
}

function sanitizeHttpUrl(value: string | undefined): string | undefined {
	if (!value) return undefined;
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? value : undefined;
	} catch {
		return undefined;
	}
}
