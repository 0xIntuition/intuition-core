import type { ClassifiedAtomInput } from '@0xintuition/atom-enrichment';
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

export type EnrichmentPlan = {
	classificationResult: WorkerClassificationResult;
	targetUrl: string | undefined;
	structuredDocument: CompactParseResult['structuredDocument'];
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
