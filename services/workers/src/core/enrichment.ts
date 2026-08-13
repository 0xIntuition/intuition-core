import {
	type ClassifiedAtomInput,
	createIdentifierProviderPlan,
	type EnrichmentRunResult,
	type IdentifierProviderPlanEntry,
} from '@0xintuition/atom-enrichment';
import {
	getProcessingScopeDomains,
	type ProcessingDomain,
	type ProcessingScopePreset,
} from '../shared/processing-scope';
import type { WorkerClassificationResult } from './classification';
import type {
	IdentityClassificationDecision,
	IdentityProviderPlan,
	NormalizedAtomIdentity,
} from './identity-contract';
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
	identity?: NormalizedAtomIdentity;
	identityDecision?: IdentityClassificationDecision;
	providerPlan?: IdentityProviderPlan;
};

export type EnrichmentCompletionPromotedFields = {
	dataResolved: Record<string, unknown>;
	searchText: string;
};

export type IidProviderExecutionPlan =
	| {
			status: 'ready';
			plugins: string[];
			identifiers: Record<string, string>;
	  }
	| {
			status: 'blocked';
			retriable: boolean;
			reason: string;
			entries: IdentifierProviderPlanEntry[];
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

export type EnrichmentCompletionDisposition =
	| { kind: 'complete' }
	| {
			kind: 'retryable_failure';
			diagnostics: EnrichmentDiagnostics;
	  }
	| {
			kind: 'terminal_unresolved';
			diagnostics: EnrichmentDiagnostics;
	  };

export type EnrichmentDiagnostics = {
	errors: EnrichmentRunResult['errors'];
	skipped: EnrichmentRunResult['skipped'];
	totalErrors: number;
	totalSkipped: number;
	errorsTruncated: boolean;
	skippedTruncated: boolean;
};

const MAX_ENRICHMENT_DIAGNOSTICS_PER_KIND = 25;
const MAX_ENRICHMENT_ERROR_MESSAGE_LENGTH = 1_000;
const MAX_ENRICHMENT_SKIP_REASON_LENGTH = 256;

/**
 * A partial run is useful and completes. A run with no artifacts retries only
 * when every explicit provider failure is marked retryable by the enrichment
 * engine. A zero-artifact terminal error or all-skipped run is terminally
 * unresolved; it must never be presented as a successful resolution.
 */
export function evaluateEnrichmentCompletion(
	result: Pick<EnrichmentRunResult, 'artifacts' | 'errors' | 'skipped'>
): EnrichmentCompletionDisposition {
	if (
		result.artifacts.length === 0 &&
		result.errors.length > 0 &&
		result.errors.every((error) => error.retriable)
	) {
		return { kind: 'retryable_failure', diagnostics: boundEnrichmentDiagnostics(result) };
	}

	if (result.artifacts.length === 0) {
		return { kind: 'terminal_unresolved', diagnostics: boundEnrichmentDiagnostics(result) };
	}

	return { kind: 'complete' };
}

/**
 * Keep terminal/retry evidence useful without allowing provider fan-out or
 * messages to create an unbounded processing-error row.
 */
export function boundEnrichmentDiagnostics(
	result: Pick<EnrichmentRunResult, 'errors' | 'skipped'>
): EnrichmentDiagnostics {
	return {
		errors: result.errors.slice(0, MAX_ENRICHMENT_DIAGNOSTICS_PER_KIND).map((error) => ({
			...error,
			message: error.message.slice(0, MAX_ENRICHMENT_ERROR_MESSAGE_LENGTH),
		})),
		skipped: result.skipped.slice(0, MAX_ENRICHMENT_DIAGNOSTICS_PER_KIND).map((entry) => ({
			...entry,
			reason: entry.reason.slice(0, MAX_ENRICHMENT_SKIP_REASON_LENGTH),
		})),
		totalErrors: result.errors.length,
		totalSkipped: result.skipped.length,
		errorsTruncated: result.errors.length > MAX_ENRICHMENT_DIAGNOSTICS_PER_KIND,
		skippedTruncated: result.skipped.length > MAX_ENRICHMENT_DIAGNOSTICS_PER_KIND,
	};
}

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

	const identity = input.classificationResult.identity ?? input.parseResult?.identity;
	return {
		classificationResult: input.classificationResult,
		targetUrl,
		structuredDocument: input.parseResult?.structuredDocument,
		...(identity ? { identity } : {}),
		...(input.classificationResult.identityDecision
			? { identityDecision: input.classificationResult.identityDecision }
			: {}),
		...(input.classificationResult.providerPlan
			? { providerPlan: input.classificationResult.providerPlan }
			: {}),
	};
}

/**
 * Keeps the existing structured-document projection in the enrichment
 * completion transaction. Identity-derived projections remain deliberately
 * unplugged until the public resolver package provides resolved presentation
 * data and provenance.
 */
export function buildEnrichmentCompletionPromotedFields(
	plan: EnrichmentPlan,
	artifacts: EnrichmentRunResult['artifacts'] = []
): EnrichmentCompletionPromotedFields | undefined {
	if (plan.identity) {
		return buildIdentityPromotedFields(plan, artifacts);
	}

	if (plan.structuredDocument?.topLevelType !== 'object') {
		return undefined;
	}

	const dataResolved = toRecordMaybe(plan.structuredDocument.data);
	if (!dataResolved) {
		return undefined;
	}

	const name = resolveDisplayText(dataResolved.name);
	const description = resolveDisplayText(dataResolved.description);
	const searchText = [name, description]
		.filter((value): value is string => value !== undefined)
		.join(' ')
		.slice(0, 20_000);
	if (!searchText) {
		return undefined;
	}

	return { dataResolved, searchText };
}

export function buildClassifiedInputFromPlan(plan: EnrichmentPlan): ClassifiedAtomInput | null {
	const identifiers = collectIdentityIdentifierHints(plan);
	if (
		!plan.targetUrl &&
		plan.structuredDocument?.topLevelType !== 'object' &&
		Object.keys(identifiers).length === 0
	) {
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
		...(Object.keys(identifiers).length > 0 ? { identifiers } : {}),
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

/**
 * Converts the persisted public-registry plan into the exact plugin request
 * understood by Core's enrichment runtime. Any registry/runtime drift remains
 * explicit: unknown providers are terminal and missing deployed plugins are
 * retryable. The worker never silently falls back to running every plugin.
 */
export function buildIidProviderExecutionPlan(input: {
	plan: EnrichmentPlan;
	registeredPluginIds: Iterable<string>;
}): IidProviderExecutionPlan | undefined {
	if (!input.plan.identity) {
		return undefined;
	}

	const providerPlan = input.plan.providerPlan;
	if (!providerPlan || providerPlan.status !== 'planned' || providerPlan.targets.length === 0) {
		return {
			status: 'blocked',
			retriable: false,
			reason: 'The IID registry did not provide an executable provider plan.',
			entries: [],
		};
	}

	const execution = createIdentifierProviderPlan({
		providers: providerPlan.targets.map((target) => target.provider),
		identifiers: collectIdentityIdentifierHints(input.plan),
		registeredPluginIds: input.registeredPluginIds,
	});
	const blockers = execution.entries.filter((entry) => entry.status !== 'scheduled');
	if (blockers.length > 0) {
		const hasTerminalBlocker = blockers.some((entry) => entry.disposition === 'terminal');
		return {
			status: 'blocked',
			retriable: !hasTerminalBlocker,
			reason: hasTerminalBlocker
				? 'The IID provider plan contains an unsupported provider capability.'
				: 'The IID provider plan requires a plugin that is not registered in this runtime.',
			entries: blockers,
		};
	}

	return {
		status: 'ready',
		plugins: execution.plugins,
		identifiers: execution.identifiers,
	};
}

function collectIdentityIdentifierHints(plan: EnrichmentPlan): Record<string, string> {
	const identifiers: Record<string, string> = {};
	for (const target of plan.providerPlan?.targets ?? []) {
		for (const hint of target.identifierHints) {
			const existing = identifiers[hint.kind];
			if (existing !== undefined && existing !== hint.value) {
				throw new Error(
					`IID provider plan supplied conflicting values for identifier hint "${hint.kind}".`
				);
			}
			identifiers[hint.kind] = hint.value;
		}
	}
	return identifiers;
}

function buildIdentityPromotedFields(
	plan: EnrichmentPlan,
	artifacts: EnrichmentRunResult['artifacts']
): EnrichmentCompletionPromotedFields | undefined {
	const primary = artifacts[0];
	if (!primary) {
		return undefined;
	}

	const data = toRecordMaybe(primary.data) ?? {};
	const name = resolveDisplayText(data.name) ?? resolveDisplayText(data.title);
	const description = resolveDisplayText(data.description) ?? resolveDisplayText(data.summary);
	const image =
		resolveHttpUrl(data.image) ??
		resolveHttpUrl(data.imageUrl) ??
		resolveHttpUrl(data.coverUrl) ??
		resolveHttpUrl(data.thumbnailUrl) ??
		resolveHttpUrl(data.logoUrl);
	const provider = resolveDisplayText(primary.meta.provider);
	const sourceUrl = resolveDisplayText(primary.meta.sourceUrl);
	const searchText = [
		name,
		description,
		resolveDisplayText(data.artistCredit),
		resolveDisplayText(data.publisher),
		resolveDisplayList(data.authors),
	]
		.filter((value): value is string => value !== undefined)
		.join(' ')
		.slice(0, 20_000);

	return {
		dataResolved: {
			...(name ? { name } : {}),
			...(description ? { description } : {}),
			...(image ? { image } : {}),
			resolvedAtom: data,
			resolution: {
				artifactType: primary.artifact_type,
				...(provider ? { provider } : {}),
				...(sourceUrl ? { sourceUrl } : {}),
				identity: plan.identity?.canonical,
				providerPlanProvenance: plan.providerPlan?.provenance,
			},
		},
		searchText,
	};
}

function resolveDisplayList(value: unknown): string | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}
	const displayValues = value
		.map((entry) => resolveDisplayText(entry))
		.filter((entry): entry is string => entry !== undefined);
	return displayValues.length > 0 ? displayValues.join(' ') : undefined;
}

function resolveHttpUrl(value: unknown): string | undefined {
	const text = resolveString(value);
	if (!text) {
		return undefined;
	}
	try {
		const parsed = new URL(text);
		return parsed.protocol === 'http:' || parsed.protocol === 'https:'
			? parsed.toString()
			: undefined;
	} catch {
		return undefined;
	}
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
