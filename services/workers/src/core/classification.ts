import {
	type ClassificationCanonicalEnvelope,
	type ClassificationResult,
	createJsonLdTypeRegistry,
	createTypeProfilesPlugin,
	type JsonLdTypeDefinition,
} from '@0xintuition/atom-classification';
import type { CompactParseResult } from './parse';
import {
	resolveFallbackUrl,
	resolveStructuredDocumentTarget,
	type StructuredTargetSource,
} from './structured-targets';

const typeDefinitions = buildTypeDefinitions();

export type ClassificationTargetSource = StructuredTargetSource;

export type WorkerClassificationResult = {
	status: 'recognized' | 'unknown_object' | 'not_applicable';
	source: string;
	format?: string;
	topLevelType?: string;
	schemaType?: string;
	category?: string;
	knownType?: boolean;
	targetUrl?: string;
	targetSource?: ClassificationTargetSource;
};

export type ClassificationPlan = {
	classificationResult: WorkerClassificationResult;
	runtimeInput: string | undefined;
	targetUrl: string | undefined;
	targetSource: ClassificationTargetSource | undefined;
	usesStructuredDocument: boolean;
};

export function deriveClassificationPlan(input: {
	parseResult: CompactParseResult | null;
	rawInput: string | null;
}): ClassificationPlan {
	const parseResult = input.parseResult;
	const structuredDocument = parseResult?.structuredDocument;
	const fallbackTarget = resolveFallbackTarget({ parseResult, rawInput: input.rawInput });

	if (structuredDocument) {
		const normalizedType = normalizeSchemaType(structuredDocument.schemaType);
		const definition = normalizedType ? findTypeDefinition(normalizedType) : undefined;
		const documentTarget = resolveStructuredDocumentTarget(structuredDocument);
		const targetUrl = documentTarget.url ?? fallbackTarget.url;
		const targetSource = documentTarget.source ?? fallbackTarget.source;
		const classificationStatus =
			structuredDocument.topLevelType === 'object'
				? definition
					? 'recognized'
					: 'unknown_object'
				: 'not_applicable';

		return {
			classificationResult: {
				status: classificationStatus,
				source: structuredDocument.source,
				format: structuredDocument.format,
				topLevelType: structuredDocument.topLevelType,
				...(normalizedType ? { schemaType: normalizedType } : {}),
				...(definition ? { category: definition.category, knownType: true } : { knownType: false }),
				...(targetUrl ? { targetUrl } : {}),
				...(targetSource ? { targetSource } : {}),
			},
			runtimeInput: undefined,
			targetUrl,
			targetSource,
			usesStructuredDocument: true,
		};
	}

	return {
		classificationResult: {
			status: 'not_applicable',
			source: 'raw_input',
			...(fallbackTarget.url ? { targetUrl: fallbackTarget.url } : {}),
			...(fallbackTarget.source ? { targetSource: fallbackTarget.source } : {}),
		},
		runtimeInput: fallbackTarget.url ?? parseResult?.normalizedInput ?? input.rawInput ?? undefined,
		targetUrl: fallbackTarget.url,
		targetSource: fallbackTarget.source,
		usesStructuredDocument: false,
	};
}

export function deriveClassificationResultFromRuntime(input: {
	classification: ClassificationResult;
	targetUrl: string | undefined;
	targetSource: ClassificationTargetSource | undefined;
}): WorkerClassificationResult {
	const resolved =
		input.classification.resolved?.atoms[0] ??
		toResolvedAtomFromCanonical(input.classification.resolved?.classifications[0]);

	if (!resolved) {
		return {
			status: 'not_applicable',
			source: 'raw_input',
			...(input.targetUrl ? { targetUrl: input.targetUrl } : {}),
			...(input.targetSource ? { targetSource: input.targetSource } : {}),
		};
	}

	const normalizedType = normalizeSchemaType(resolved.schemaType);
	const definition = normalizedType ? findTypeDefinition(normalizedType) : undefined;

	return {
		status: 'recognized',
		source: 'raw_input',
		...(normalizedType ? { schemaType: normalizedType } : {}),
		...(resolved.category ? { category: resolved.category } : {}),
		knownType: !!definition,
		...(input.targetUrl ? { targetUrl: input.targetUrl } : {}),
		...(input.targetSource ? { targetSource: input.targetSource } : {}),
	};
}

export function resolveClassificationType(result: WorkerClassificationResult): string {
	return result.schemaType ?? result.category ?? 'Unknown';
}

function buildTypeDefinitions(): JsonLdTypeDefinition[] {
	const registry = createJsonLdTypeRegistry();
	createTypeProfilesPlugin().registerTypes?.(registry);
	return registry.list();
}

function findTypeDefinition(type: string): JsonLdTypeDefinition | undefined {
	const lookup = normalizeLookupKey(type);
	return typeDefinitions.find((definition) => {
		if (normalizeLookupKey(definition.type) === lookup) {
			return true;
		}
		return definition.aliases?.some((alias) => normalizeLookupKey(alias) === lookup) ?? false;
	});
}

function resolveFallbackTarget(input: {
	parseResult: CompactParseResult | null;
	rawInput: string | null;
}): {
	url: string | undefined;
	source: ClassificationTargetSource | undefined;
} {
	const url = resolveFallbackUrl(input.parseResult, input.rawInput);
	if (!url) {
		return { url: undefined, source: undefined };
	}
	if (url === input.parseResult?.remote?.finalUrl) {
		return {
			url,
			source: 'remote_final_url',
		};
	}

	return { url, source: 'raw_input' };
}

function toResolvedAtomFromCanonical(value: ClassificationCanonicalEnvelope | undefined) {
	if (!value) {
		return undefined;
	}

	return {
		schemaType: value.type,
		category: undefined,
	};
}

function normalizeLookupKey(value: string): string {
	return normalizeSchemaType(value)?.toLowerCase() ?? '';
}

function normalizeSchemaType(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	if (!trimmed) {
		return undefined;
	}

	const withoutFragment = trimmed.split('#').pop() ?? trimmed;
	const withoutPath = withoutFragment.split('/').pop() ?? withoutFragment;
	const withoutNamespace = withoutPath.includes(':')
		? (withoutPath.split(':').pop() ?? withoutPath)
		: withoutPath;

	return withoutNamespace.trim() || undefined;
}
