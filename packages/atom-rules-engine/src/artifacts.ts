import {
	type AppleMusicData,
	appleMusicDataSchema,
	type BrandData,
	brandDataSchema,
	type CompanyProfileData,
	companyProfileDataSchema,
	type EtherscanData,
	etherscanDataSchema,
	type FaviconData,
	faviconDataSchema,
	type GitHubRepoData,
	type GitHubUserData,
	githubRepoDataSchema,
	githubUserDataSchema,
	type MusicBrainzData,
	musicbrainzDataSchema,
	type NpmPackageData,
	npmPackageDataSchema,
	type OEmbedData,
	type OpenGraphData,
	oembedDataSchema,
	opengraphDataSchema,
	type PlacesData,
	type ProductListingData,
	placesDataSchema,
	productListingDataSchema,
	type SpotifyData,
	spotifyDataSchema,
	type TmdbData,
	type TokenMetadataData,
	tmdbDataSchema,
	tokenMetadataDataSchema,
	type WikidataData,
	type WikipediaData,
	wikidataDataSchema,
	wikipediaDataSchema,
	type XProfileData,
	xProfileDataSchema,
	type YouTubeData,
	youtubeDataSchema,
} from '@0xintuition/atom-enrichment/provider-data';
import { canonicalizeEnrichmentSlug } from '@0xintuition/atom-enrichment/slug-aliases';
import type { z } from 'zod/v4';

type RawRecord = Record<string, unknown>;

export type CanonicalEnrichmentArtifactSlug =
	| 'apple-music'
	| 'brand'
	| 'company-profile'
	| 'etherscan'
	| 'favicon'
	| 'github-repo'
	| 'github-user'
	| 'musicbrainz'
	| 'npm-package'
	| 'oembed'
	| 'opengraph'
	| 'places'
	| 'product-listing'
	| 'spotify'
	| 'tmdb'
	| 'token-metadata'
	| 'twitter-profile'
	| 'wikidata'
	| 'wikipedia'
	| 'x-profile'
	| 'youtube';

export type CanonicalEnrichmentArtifactDataBySlug = {
	'apple-music': AppleMusicData;
	brand: BrandData;
	'company-profile': CompanyProfileData;
	etherscan: EtherscanData;
	favicon: FaviconData;
	'github-repo': GitHubRepoData;
	'github-user': GitHubUserData;
	musicbrainz: MusicBrainzData;
	'npm-package': NpmPackageData;
	oembed: OEmbedData;
	opengraph: OpenGraphData;
	places: PlacesData;
	'product-listing': ProductListingData;
	spotify: SpotifyData;
	tmdb: TmdbData;
	'token-metadata': TokenMetadataData;
	'twitter-profile': XProfileData;
	wikidata: WikidataData;
	wikipedia: WikipediaData;
	'x-profile': XProfileData;
	youtube: YouTubeData;
};

export type PersistedEnrichmentArtifactInput = {
	id?: string;
	type?: string;
	classification?: string | null;
	data?: unknown;
	linkData?: unknown;
	createdAt?: string;
};

export type ProcessEnrichmentArtifactInput = {
	artifact_type: string;
	data: RawRecord;
	meta: {
		pluginId: string;
		provider: string;
		fetchedAt?: string;
		sourceUrl?: string;
	};
};

export type CanonicalEnrichmentArtifactMeta = {
	sourceUrl?: string;
	pluginId?: string;
	provider?: string;
	fetchedAt?: string;
};

export type CanonicalEnrichmentArtifact<
	TSlug extends CanonicalEnrichmentArtifactSlug = CanonicalEnrichmentArtifactSlug,
> = {
	id: string;
	slug: TSlug;
	artifactType: TSlug;
	classification?: string | null;
	recordType?: string;
	provider?: string;
	sourceUrl?: string;
	meta: CanonicalEnrichmentArtifactMeta;
	rawData: RawRecord;
	innerData: RawRecord;
	linkData: RawRecord;
	resolvedAtom?: RawRecord;
	data: CanonicalEnrichmentArtifactDataBySlug[TSlug];
};

export type AnyCanonicalEnrichmentArtifact = {
	[TSlug in CanonicalEnrichmentArtifactSlug]: CanonicalEnrichmentArtifact<TSlug>;
}[CanonicalEnrichmentArtifactSlug];

export function normalizePersistedEnrichmentArtifacts(
	artifacts: PersistedEnrichmentArtifactInput[]
): AnyCanonicalEnrichmentArtifact[] {
	const normalized: AnyCanonicalEnrichmentArtifact[] = [];

	for (const artifact of artifacts) {
		const rawData = toRecord(artifact.data) ?? {};
		const innerData = toRecord(rawData.data) ?? rawData;
		const linkData = toRecord(artifact.linkData) ?? {};
		const slug = resolveCanonicalArtifactSlug({ rawData, innerData, linkData });
		if (!slug) {
			continue;
		}

		const data = parseCanonicalArtifactData(slug, innerData);
		if (!data) {
			continue;
		}

		const meta = toRecord(rawData.meta) ?? {};
		const sourceUrl = resolveFirstHttpUrl(
			readString(linkData.sourceUrl),
			readString(meta.sourceUrl)
		);
		const provider = readString(meta.provider) ?? readString(linkData.provider);
		const pluginId = readString(meta.pluginId) ?? readString(linkData.pluginId);
		const fetchedAt = readString(meta.fetchedAt);

		normalized.push({
			id: artifact.id ?? `${slug}-${normalized.length.toString(36)}`,
			slug,
			artifactType: slug,
			classification: artifact.classification,
			recordType: artifact.type,
			provider,
			sourceUrl,
			meta: {
				sourceUrl,
				pluginId,
				provider,
				fetchedAt,
			},
			rawData,
			innerData,
			linkData,
			resolvedAtom: toRecord(rawData.resolvedAtom),
			data,
		} as AnyCanonicalEnrichmentArtifact);
	}

	return normalized;
}

export function normalizeProcessEnrichmentArtifacts(
	artifacts: ProcessEnrichmentArtifactInput[]
): AnyCanonicalEnrichmentArtifact[] {
	const normalized: AnyCanonicalEnrichmentArtifact[] = [];

	for (const artifact of artifacts) {
		const slug = canonicalizeKnownArtifactSlug(artifact.artifact_type);
		if (!slug) {
			continue;
		}

		const data = parseCanonicalArtifactData(slug, artifact.data);
		if (!data) {
			continue;
		}

		const sourceUrl = resolveFirstHttpUrl(artifact.meta.sourceUrl);

		normalized.push({
			id: `${slug}-${normalized.length.toString(36)}`,
			slug,
			artifactType: slug,
			classification: slug,
			recordType: 'json',
			provider: artifact.meta.provider,
			sourceUrl,
			meta: {
				pluginId: artifact.meta.pluginId,
				provider: artifact.meta.provider,
				fetchedAt: artifact.meta.fetchedAt,
				sourceUrl,
			},
			rawData: {
				artifactType: artifact.artifact_type,
				data: artifact.data,
				meta: artifact.meta,
			},
			innerData: artifact.data,
			linkData: {
				artifactType: artifact.artifact_type,
				pluginId: artifact.meta.pluginId,
				provider: artifact.meta.provider,
				sourceUrl,
			},
			resolvedAtom: undefined,
			data,
		} as AnyCanonicalEnrichmentArtifact);
	}

	return normalized;
}

export function canonicalizeKnownArtifactSlug(
	value: string | undefined
): CanonicalEnrichmentArtifactSlug | null {
	if (!value) {
		return null;
	}

	if (value === 'coingecko') {
		return 'token-metadata';
	}

	if (value === 'npm') {
		return 'npm-package';
	}

	const canonical = canonicalizeEnrichmentSlug(value);
	return isCanonicalEnrichmentArtifactSlug(canonical) ? canonical : null;
}

function resolveCanonicalArtifactSlug(input: {
	rawData: RawRecord;
	innerData: RawRecord;
	linkData: RawRecord;
}): CanonicalEnrichmentArtifactSlug | null {
	const meta = toRecord(input.rawData.meta) ?? {};
	const rawSlug =
		readString(input.linkData.artifactType) ??
		readString(input.rawData.artifactType) ??
		readString(input.rawData.classification) ??
		readString(meta.pluginId) ??
		readString(input.linkData.pluginId);

	if (!rawSlug) {
		return null;
	}

	if (rawSlug === 'github') {
		if (readString(input.innerData.fullName)) return 'github-repo';
		if (readString(input.innerData.login)) return 'github-user';
	}

	return canonicalizeKnownArtifactSlug(rawSlug);
}

function parseCanonicalArtifactData<TSlug extends CanonicalEnrichmentArtifactSlug>(
	slug: TSlug,
	data: RawRecord
): CanonicalEnrichmentArtifactDataBySlug[TSlug] | null {
	const parsed = canonicalArtifactDataSchemaBySlug[slug].safeParse(data);
	return parsed.success ? (parsed.data as CanonicalEnrichmentArtifactDataBySlug[TSlug]) : null;
}

function isCanonicalEnrichmentArtifactSlug(
	value: string
): value is CanonicalEnrichmentArtifactSlug {
	return value in canonicalArtifactDataSchemaBySlug;
}

const canonicalArtifactDataSchemaBySlug = {
	'apple-music': appleMusicDataSchema,
	brand: brandDataSchema,
	'company-profile': companyProfileDataSchema,
	etherscan: etherscanDataSchema,
	favicon: faviconDataSchema,
	'github-repo': githubRepoDataSchema,
	'github-user': githubUserDataSchema,
	musicbrainz: musicbrainzDataSchema,
	'npm-package': npmPackageDataSchema,
	oembed: oembedDataSchema,
	opengraph: opengraphDataSchema,
	places: placesDataSchema,
	'product-listing': productListingDataSchema,
	spotify: spotifyDataSchema,
	tmdb: tmdbDataSchema,
	'token-metadata': tokenMetadataDataSchema,
	'twitter-profile': xProfileDataSchema,
	wikidata: wikidataDataSchema,
	wikipedia: wikipediaDataSchema,
	'x-profile': xProfileDataSchema,
	youtube: youtubeDataSchema,
} satisfies {
	[TSlug in CanonicalEnrichmentArtifactSlug]: z.ZodType<
		CanonicalEnrichmentArtifactDataBySlug[TSlug]
	>;
};

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toRecord(value: unknown): RawRecord | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}
	return value as RawRecord;
}

function isHttpUrl(value: string | undefined): value is string {
	if (!value) {
		return false;
	}
	try {
		const parsed = new URL(value);
		return parsed.protocol === 'https:' || parsed.protocol === 'http:';
	} catch {
		return false;
	}
}

function resolveFirstHttpUrl(...candidates: Array<string | undefined>): string | undefined {
	return candidates.find(isHttpUrl);
}
