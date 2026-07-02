import { appleMusicDataSchema } from '../plugins/providers/apple-music/schema';
import { tokenMetadataDataSchema } from '../plugins/providers/coingecko/schema';
import { etherscanDataSchema } from '../plugins/providers/etherscan/schema';
import { githubRepoDataSchema, githubUserDataSchema } from '../plugins/providers/github/schema';
import { microdataDataSchema } from '../plugins/providers/microdata/schema';
import { npmPackageDataSchema } from '../plugins/providers/npm/schema';
import { oembedDataSchema } from '../plugins/providers/oembed/schema';
import { opengraphDataSchema } from '../plugins/providers/opengraph/schema';
import { placesDataSchema } from '../plugins/providers/places/schema';
import { podcastIndexDataSchema } from '../plugins/providers/podcast-index/schema';
import { spotifyDataSchema } from '../plugins/providers/spotify/schema';
import { wikidataDataSchema } from '../plugins/providers/wikidata/schema';
import { wikipediaDataSchema } from '../plugins/providers/wikipedia/schema';
import { xProfileDataSchema } from '../plugins/providers/x-profile/schema';
import { youtubeDataSchema } from '../plugins/providers/youtube/schema';
import type { EnrichmentArtifact } from '../types';
import type { ExtractedField } from './types';

export const CONFIDENCE = {
	inputUrl: 1,
	provider: 0.95,
	wikidataResolvedLabel: 0.95,
	wikidataClaim: 0.9,
	wikidataLabel: 0.9,
	urlParse: 0.85,
	wikidataComposed: 0.8,
	wikipedia: 0.85,
	opengraph: 0.7,
} as const;

export function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function field(
	key: string,
	value: unknown,
	source: ExtractedField['source'],
	confidence: number,
	evidenceUrl?: string
): ExtractedField {
	return {
		key,
		value,
		source,
		confidence,
		...(evidenceUrl ? { evidenceUrl } : {}),
	};
}

export function findArtifactData<TData>(
	artifacts: readonly EnrichmentArtifact[],
	artifactType: string,
	parse: (data: unknown) => TData | null
): { data: TData; sourceUrl?: string } | null {
	for (const artifact of artifacts) {
		if (artifact.artifact_type !== artifactType) continue;
		const data = parse(artifact.data);
		if (data) {
			return {
				data,
				...(artifact.meta.sourceUrl ? { sourceUrl: artifact.meta.sourceUrl } : {}),
			};
		}
	}
	return null;
}

export function safeParser<TOutput>(schema: {
	safeParse: (value: unknown) => { success: boolean; data?: TOutput };
}) {
	return (data: unknown): TOutput | null => {
		const parsed = schema.safeParse(data);
		return parsed.success && parsed.data !== undefined ? parsed.data : null;
	};
}

export const parseWikidata = safeParser(wikidataDataSchema);
export const parseWikipedia = safeParser(wikipediaDataSchema);
export const parseOpengraph = safeParser(opengraphDataSchema);
export const parseSpotify = safeParser(spotifyDataSchema);
export const parseAppleMusic = safeParser(appleMusicDataSchema);
export const parsePodcastIndex = safeParser(podcastIndexDataSchema);
export const parsePlaces = safeParser(placesDataSchema);
export const parseGithubRepo = safeParser(githubRepoDataSchema);
export const parseGithubUser = safeParser(githubUserDataSchema);
export const parseNpm = safeParser(npmPackageDataSchema);
export const parseYoutube = safeParser(youtubeDataSchema);
export const parseXProfile = safeParser(xProfileDataSchema);
export const parseTokenMetadata = safeParser(tokenMetadataDataSchema);
export const parseEtherscan = safeParser(etherscanDataSchema);
export const parseOembed = safeParser(oembedDataSchema);
export const parseMicrodata = safeParser(microdataDataSchema);
