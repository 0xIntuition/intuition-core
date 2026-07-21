import type { ClassifiedAtomInput } from '@0xintuition/atom-enrichment';
import {
	getProcessingScopeDomains,
	type ProcessingDomain,
	type ProcessingScopePreset,
} from '../shared/processing-scope';
import type { WorkerClassificationResult } from './classification';
import type { CompactParseResult } from './parse';
import { resolveFallbackUrl, resolveStructuredDocumentTarget } from './structured-targets';

export const WEBSITE_ARTIFACT_TYPE_ALLOWLIST = ['opengraph', 'favicon', 'brand'] as const;
export const SPOTIFY_TRACK_ARTIFACT_TYPE_ALLOWLIST = [
	'opengraph',
	'favicon',
	'brand',
	'spotify',
	'wikipedia',
	'wikidata',
] as const;
export const MUSIC_SCOPE_ARTIFACT_TYPE_ALLOWLIST = [
	'opengraph',
	'spotify',
	'musicbrainz',
	'apple-music',
	'wikipedia',
	'wikidata',
] as const;
export const PODCAST_SCOPE_ARTIFACT_TYPE_ALLOWLIST = [
	'opengraph',
	'spotify',
	'apple-music',
	'podcast-index',
	'wikipedia',
	'wikidata',
] as const;

export type EnrichmentPlan = {
	classificationResult: WorkerClassificationResult;
	targetUrl: string | undefined;
	structuredDocument: CompactParseResult['structuredDocument'];
};

export type ScopedEnrichmentDecision =
	| {
			shouldEnrich: true;
			artifactTypes?: string[];
			matchedDomains: ProcessingDomain[];
	  }
	| {
			shouldEnrich: false;
			reason: string;
			matchedDomains: ProcessingDomain[];
	  };

export function deriveEnrichmentPlan(input: {
	parseResult: CompactParseResult | null;
	classificationResult: WorkerClassificationResult;
	rawInput: string | null;
}): EnrichmentPlan {
	const structuredTarget = resolveStructuredDocumentTarget(input.parseResult?.structuredDocument);
	const targetUrl =
		input.classificationResult.targetUrl ??
		structuredTarget.url ??
		resolveFallbackUrl(input.parseResult, input.rawInput);

	return {
		classificationResult: input.classificationResult,
		targetUrl,
		structuredDocument: input.parseResult?.structuredDocument,
	};
}

export function buildClassifiedInputFromPlan(plan: EnrichmentPlan): ClassifiedAtomInput | null {
	if (!plan.targetUrl && plan.structuredDocument?.topLevelType !== 'object') {
		return null;
	}

	const documentData =
		plan.structuredDocument?.topLevelType === 'object'
			? (toRecordMaybe(plan.structuredDocument.data) ?? {})
			: {};
	const name = resolveDisplayText(documentData.name);
	const description = resolveDisplayText(documentData.description);
	const hints: NonNullable<ClassifiedAtomInput['hints']> = {
		...(name ? { name } : {}),
		...(description ? { description } : {}),
		...(plan.targetUrl ? { url: plan.targetUrl } : {}),
	};

	return {
		atomType: resolveAtomType(plan.classificationResult.category),
		jsonLd: {
			...documentData,
			'@context': resolveString(documentData['@context']) ?? 'https://schema.org',
			'@type':
				plan.classificationResult.schemaType ?? resolveString(documentData['@type']) ?? 'Thing',
			...(name ? { name } : {}),
			...(description ? { description } : {}),
			...(plan.targetUrl ? { url: plan.targetUrl } : {}),
		},
		source: {
			classificationEngine: 'backend/workers:kg-classification-result',
			classifiedAt: new Date().toISOString(),
		},
		...(Object.keys(hints).length > 0 ? { hints } : {}),
	};
}

function resolveAtomType(value: string | undefined): ClassifiedAtomInput['atomType'] {
	const normalized = value?.toLowerCase();
	switch (normalized) {
		case 'person':
		case 'place':
		case 'thing':
		case 'company':
		case 'product':
		case 'song':
		case 'podcast':
		case 'software':
		case 'unknown':
			return normalized;
		default:
			return 'unknown';
	}
}

export function getArtifactTypeAllowListForEnrichmentPlan(
	plan: EnrichmentPlan
): string[] | undefined {
	if (plan.classificationResult.schemaType === 'WebSite') {
		return [...WEBSITE_ARTIFACT_TYPE_ALLOWLIST];
	}

	if (
		plan.classificationResult.schemaType === 'MusicRecording' &&
		isSpotifyTrackUrl(plan.targetUrl)
	) {
		return [...SPOTIFY_TRACK_ARTIFACT_TYPE_ALLOWLIST];
	}

	return undefined;
}

export function evaluateEnrichmentProcessingScope(input: {
	plan: EnrichmentPlan;
	scope: ProcessingScopePreset;
}): ScopedEnrichmentDecision {
	const scopeDomains = getProcessingScopeDomains(input.scope);
	if (!scopeDomains) {
		return {
			shouldEnrich: true,
			artifactTypes: getArtifactTypeAllowListForEnrichmentPlan(input.plan),
			matchedDomains: resolveProcessingDomainsForEnrichmentPlan(input.plan),
		};
	}

	const allowedDomains = new Set(scopeDomains);
	const matchedDomains = resolveProcessingDomainsForEnrichmentPlan(input.plan).filter((domain) =>
		allowedDomains.has(domain)
	);

	if (matchedDomains.length === 0) {
		return {
			shouldEnrich: false,
			matchedDomains: [],
			reason: `Processing scope "${input.scope}" skipped enrichment for ${describeClassification(input.plan)} because it does not match ${formatScopeDomains(scopeDomains)}.`,
		};
	}

	return {
		shouldEnrich: true,
		artifactTypes: getArtifactTypeAllowListForProcessingDomains(matchedDomains),
		matchedDomains,
	};
}

function resolveProcessingDomainsForEnrichmentPlan(plan: EnrichmentPlan): ProcessingDomain[] {
	const domains = new Set<ProcessingDomain>();
	const schemaType = normalizeDomainKey(
		plan.classificationResult.schemaType ?? readStructuredSchemaType(plan)
	);
	const category = normalizeDomainKey(plan.classificationResult.category);

	if (schemaType && MUSIC_SCHEMA_TYPES.has(schemaType)) {
		domains.add('music');
	}
	if (category && MUSIC_CATEGORIES.has(category)) {
		domains.add('music');
	}
	if (schemaType && PODCAST_SCHEMA_TYPES.has(schemaType)) {
		domains.add('podcast');
	}
	if (category && PODCAST_CATEGORIES.has(category)) {
		domains.add('podcast');
	}

	const providerDomain = resolveProviderDomain(plan.targetUrl);
	if (providerDomain) {
		domains.add(providerDomain);
	}

	return Array.from(domains);
}

function getArtifactTypeAllowListForProcessingDomains(domains: ProcessingDomain[]): string[] {
	const artifactTypes = new Set<string>();
	for (const domain of domains) {
		const allowList =
			domain === 'music'
				? MUSIC_SCOPE_ARTIFACT_TYPE_ALLOWLIST
				: PODCAST_SCOPE_ARTIFACT_TYPE_ALLOWLIST;
		for (const artifactType of allowList) {
			artifactTypes.add(artifactType);
		}
	}
	return Array.from(artifactTypes);
}

const MUSIC_SCHEMA_TYPES = new Set(['musicrecording', 'musicalbum', 'musicgroup']);
const PODCAST_SCHEMA_TYPES = new Set(['podcastseries', 'podcastepisode']);
const MUSIC_CATEGORIES = new Set(['music', 'song', 'track', 'album', 'artist', 'playlist']);
const PODCAST_CATEGORIES = new Set(['podcast', 'show', 'episode']);

function resolveProviderDomain(value: string | undefined): ProcessingDomain | undefined {
	if (!value) {
		return undefined;
	}

	try {
		const url = new URL(value);
		const host = url.hostname.toLowerCase().replace(/^www\./, '');
		const segments = url.pathname
			.split('/')
			.map((segment) => segment.trim().toLowerCase())
			.filter(Boolean);
		const firstSegment = segments[0];

		if (host === 'open.spotify.com') {
			if (firstSegment === 'show' || firstSegment === 'episode') {
				return 'podcast';
			}
			if (
				firstSegment === 'track' ||
				firstSegment === 'album' ||
				firstSegment === 'artist' ||
				firstSegment === 'playlist'
			) {
				return 'music';
			}
		}

		if (host === 'music.apple.com') {
			return 'music';
		}

		if (host === 'podcastindex.org' || host === 'podcasts.apple.com') {
			return 'podcast';
		}
	} catch {
		return undefined;
	}

	return undefined;
}

function describeClassification(plan: EnrichmentPlan): string {
	return `classification "${plan.classificationResult.schemaType ?? plan.classificationResult.category ?? 'Unknown'}"`;
}

function formatScopeDomains(domains: readonly ProcessingDomain[]): string {
	if (domains.length === 1) {
		return `${domains[0]} domain`;
	}
	return `${domains.join(' or ')} domains`;
}

function readStructuredSchemaType(plan: EnrichmentPlan): string | undefined {
	return typeof plan.structuredDocument?.schemaType === 'string'
		? plan.structuredDocument.schemaType
		: undefined;
}

function normalizeDomainKey(value: string | undefined): string | undefined {
	return (
		value
			?.trim()
			.toLowerCase()
			.replace(/[^a-z0-9]/g, '') || undefined
	);
}

function isSpotifyTrackUrl(value: string | undefined): boolean {
	if (!value) {
		return false;
	}

	try {
		const url = new URL(value);
		return url.hostname === 'open.spotify.com' && url.pathname.startsWith('/track/');
	} catch {
		return false;
	}
}

function toRecordMaybe(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}

function resolveString(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim().length > 0) {
		return value.trim();
	}

	if (Array.isArray(value)) {
		const first = value.find(
			(entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
		);
		return first?.trim();
	}

	return undefined;
}

function resolveDisplayText(value: unknown): string | undefined {
	const text = resolveString(value);
	if (!text) {
		return undefined;
	}

	try {
		const parsed = new URL(text);
		if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
			return undefined;
		}
	} catch {
		return text;
	}

	return text;
}
