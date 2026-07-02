import type { AnyNormalizedArtifact, ArtifactSlug, DecisionContext } from './types';

export type RawRecord = Record<string, unknown>;

export function findArtifact<TSlug extends ArtifactSlug>(
	context: DecisionContext,
	slug: TSlug
): Extract<AnyNormalizedArtifact, { slug: TSlug }> | undefined {
	return context.artifacts.find(
		(artifact): artifact is Extract<AnyNormalizedArtifact, { slug: TSlug }> =>
			artifact.slug === slug
	);
}

export function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

export function toRecord(value: unknown): RawRecord | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as RawRecord;
}

export function parseJsonRecord(value: string | undefined): RawRecord | undefined {
	if (!value || !value.startsWith('{')) {
		return undefined;
	}

	try {
		return toRecord(JSON.parse(value));
	} catch {
		return undefined;
	}
}

export function isHttpUrl(value: string | undefined): value is string {
	if (!value) {
		return false;
	}

	try {
		const parsed = new URL(value);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:';
	} catch {
		return false;
	}
}

export function isAmazonUrl(value: string | undefined): boolean {
	return hasHost(value, 'amazon.');
}

export function isAppleMusicUrl(value: string | undefined): boolean {
	return hasHost(value, 'music.apple.com');
}

export function isEtherscanUrl(value: string | undefined): boolean {
	return hasHost(value, 'etherscan.io');
}

export function isNpmUrl(value: string | undefined): boolean {
	return hasHost(value, 'npmjs.com');
}

export function isTmdbUrl(value: string | undefined): boolean {
	return hasHost(value, 'themoviedb.org');
}

export function isWikipediaUrl(value: string | undefined): boolean {
	return hasHost(value, 'wikipedia.org');
}

export function isXUrl(value: string | undefined): boolean {
	return hasHost(value, 'x.com') || hasHost(value, 'twitter.com');
}

export function isYouTubeUrl(value: string | undefined): boolean {
	return hasHost(value, 'youtube.com') || hasHost(value, 'youtu.be');
}

function hasHost(value: string | undefined, hostSubstring: string): boolean {
	if (!value) {
		return false;
	}

	try {
		return new URL(value).hostname.toLowerCase().includes(hostSubstring);
	} catch {
		return false;
	}
}
