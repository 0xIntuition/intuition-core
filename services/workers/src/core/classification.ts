import {
	type ClassificationCanonicalEnvelope,
	type ClassificationResult,
	createJsonLdTypeRegistry,
	createTypeProfilesPlugin,
	type JsonLdTypeDefinition,
} from '@0xintuition/atom-classification';
import type {
	IdentityClassificationDecision,
	IdentityProviderPlan,
	IdentityRungProjection,
	NormalizedAtomIdentity,
} from './identity-contract';
import type { IidLadderAdapter } from './iid-ladder';
import type { IidSemanticResolution } from './iid-registry';
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
	identity?: NormalizedAtomIdentity;
	identityDecision?: IdentityClassificationDecision;
	providerPlan?: IdentityProviderPlan;
	identityRungs?: IdentityRungProjection;
};

export type ClassificationPlan = {
	classificationResult: WorkerClassificationResult;
	runtimeInput: string | undefined;
	targetUrl: string | undefined;
	targetSource: ClassificationTargetSource | undefined;
	usesStructuredDocument: boolean;
	identity?: NormalizedAtomIdentity;
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
			...(parseResult?.identity ? { identity: parseResult.identity } : {}),
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
		...(parseResult?.identity ? { identity: parseResult.identity } : {}),
	};
}

export function deriveClassificationResultFromRuntime(input: {
	classification: ClassificationResult;
	ladder?: IidLadderAdapter;
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

	// Single plugin-to-worker conversion boundary: preserve provider identity
	// and identifier hints before compacting the runtime result for persistence.
	const identifiers =
		'hints' in resolved ? stringIdentifiers(resolved.hints.identifiers) : undefined;
	const identityRungs =
		input.ladder && (normalizedType || resolved.category)
			? input.ladder.projectIdentityRungs({
					schemaType: normalizedType,
					category: resolved.category,
					providerCanonicalId: 'canonicalId' in resolved ? resolved.canonicalId : undefined,
					canonicalUrl: input.targetUrl,
					identifiers,
				})
			: undefined;

	return {
		...(identityRungs ? { identityRungs } : {}),
		status: 'recognized',
		source: 'raw_input',
		...(normalizedType ? { schemaType: normalizedType } : {}),
		...(resolved.category ? { category: resolved.category } : {}),
		knownType: !!definition,
		...(input.targetUrl ? { targetUrl: input.targetUrl } : {}),
		...(input.targetSource ? { targetSource: input.targetSource } : {}),
	};
}

export function deriveIidClassificationResult(input: {
	identity: NormalizedAtomIdentity;
	resolution: IidSemanticResolution;
	ladder?: IidLadderAdapter;
}): WorkerClassificationResult {
	const decision = input.resolution.identityDecision;
	const identityRungs =
		input.ladder && (decision.category || decision.schemaType)
			? input.ladder.projectIdentityRungs({
					identity: input.identity,
					category: decision.category,
					schemaType: decision.schemaType,
				})
			: undefined;

	return {
		...(identityRungs ? { identityRungs } : {}),
		status: decision.status === 'classified' ? 'recognized' : 'not_applicable',
		source: 'iid-registry',
		...(decision.schemaType ? { schemaType: decision.schemaType } : {}),
		...(decision.category ? { category: decision.category } : {}),
		knownType: decision.status === 'classified',
		identity: input.identity,
		identityDecision: decision,
		providerPlan: input.resolution.providerPlan,
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

function stringIdentifiers(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	return Object.fromEntries(
		Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === 'string')
	);
}
