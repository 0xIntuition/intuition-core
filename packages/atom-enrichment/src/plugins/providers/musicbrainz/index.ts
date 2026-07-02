import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getIdentifier, getRequestName } from '../__shared__/request';
import { musicBrainzRecordingResponseSchema, musicBrainzSearchResponseSchema } from './external';
import { musicbrainzDataSchema } from './schema';

type CreateMusicBrainzPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	userAgent?: string;
};

type MusicBrainzRecording = {
	id?: string;
	title?: string;
	disambiguation?: string;
	isrcs?: string[];
	'first-release-date'?: string;
	'artist-credit'?: Array<{ name?: string }>;
	tags?: Array<{ name?: string }>;
};

type MusicBrainzSearchResponse = {
	recordings?: MusicBrainzRecording[];
};

const defaultUserAgent = '@0xintuition/atom-enrichment/0.1.0 (https://0xintuition.com)';

export function createMusicBrainzPlugin(
	options: CreateMusicBrainzPluginOptions = {}
): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);
	const userAgent = options.userAgent ?? defaultUserAgent;

	return defineEnrichmentPlugin({
		id: 'musicbrainz',
		version: '1.0.0',
		runtime: 'universal',
		artifactTypes: ['musicbrainz'],
		priority: options.priority ?? 50,
		TTL: options.TTL ?? 3_600,

		supports(request: EnrichmentRequest) {
			return !!resolveMusicBrainzRequest(request);
		},

		async enrich(request, ctx) {
			const resolved = resolveMusicBrainzRequest(request);
			if (!resolved) {
				return [];
			}

			const recording = await fetchRecording(fetcher, resolved, ctx.signal, userAgent);
			if (!recording?.id || !recording.title) {
				return [];
			}

			return [
				{
					artifact_type: 'musicbrainz',
					data: musicbrainzDataSchema.parse({
						mbid: recording.id,
						name: recording.title,
						type: 'Recording',
						disambiguation: recording.disambiguation,
						isrcs: recording.isrcs,
						releaseDate: recording['first-release-date'],
						artistCredit: recording['artist-credit']
							?.map((entry) => entry.name)
							.filter((value): value is string => !!value)
							.join(', '),
						tags: recording.tags
							?.map((entry) => entry.name)
							.filter((value): value is string => !!value),
					}),
					meta: {
						pluginId: 'musicbrainz',
						provider: 'musicbrainz',
						fetchedAt: ctx.now(),
						sourceUrl: `https://musicbrainz.org/recording/${recording.id}`,
					},
				},
			];
		},
	});
}

type ResolvedMusicBrainzRequest =
	| {
			kind: 'mbid';
			mbid: string;
	  }
	| {
			kind: 'search';
			query: string;
	  };

function resolveMusicBrainzRequest(
	request: EnrichmentRequest
): ResolvedMusicBrainzRequest | undefined {
	const mbid = getIdentifier(request, 'musicbrainz', 'mbid');
	if (mbid) {
		return { kind: 'mbid', mbid };
	}

	if (!isMusicRecordingRequest(request)) {
		return undefined;
	}

	const name = getRequestName(request);
	if (!name) {
		return undefined;
	}

	return { kind: 'search', query: name };
}

function isMusicRecordingRequest(request: EnrichmentRequest): boolean {
	if (request.input.atomType !== 'song') {
		return false;
	}

	const schemaType = request.input.jsonLd['@type'];
	if (Array.isArray(schemaType)) {
		return schemaType.includes('MusicRecording');
	}

	return schemaType === 'MusicRecording';
}

async function fetchRecording(
	fetcher: FetchLike,
	request: ResolvedMusicBrainzRequest,
	signal: AbortSignal,
	userAgent: string
): Promise<MusicBrainzRecording | undefined> {
	const headers = {
		'User-Agent': userAgent,
	};

	if (request.kind === 'mbid') {
		return await fetchJsonWithSchema(
			fetcher,
			`https://musicbrainz.org/ws/2/recording/${encodeURIComponent(request.mbid)}?fmt=json`,
			musicBrainzRecordingResponseSchema,
			{ signal, headers }
		);
	}

	const payload = await fetchJsonWithSchema(
		fetcher,
		`https://musicbrainz.org/ws/2/recording?fmt=json&limit=1&query=${encodeURIComponent(request.query)}`,
		musicBrainzSearchResponseSchema,
		{ signal, headers }
	);

	return payload.recordings?.[0];
}
