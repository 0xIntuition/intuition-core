import type { WorkerClassificationResult } from '../core/classification';
import {
	isIdentityClassificationDecision,
	isIdentityProviderPlan,
	isNormalizedAtomIdentity,
	isSemanticContractProvenance,
} from '../core/identity-contract';
import type { CompactParseResult } from '../core/parse';

export function getProcessingMetaString(meta: unknown, key: string): string {
	if (!meta || typeof meta !== 'object' || Array.isArray(meta)) {
		throw new Error(`Expected processing meta with ${key}.`);
	}

	const value = (meta as Record<string, unknown>)[key];
	if (typeof value !== 'string' || !value) {
		throw new Error(`Expected processing meta string for ${key}.`);
	}

	return value;
}

export function toCompactParseResultMaybe(value: unknown): CompactParseResult | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}

	const maybe = value as Partial<CompactParseResult>;
	if (!isNonEmptyString(maybe.kind) || !isNonEmptyString(maybe.normalizedInput)) {
		return null;
	}
	if (maybe.identity !== undefined && !isNormalizedAtomIdentity(maybe.identity)) {
		return null;
	}
	if (maybe.iidFallback !== undefined && !isIidFallback(maybe.iidFallback)) {
		return null;
	}

	return maybe as CompactParseResult;
}

function isIidFallback(value: unknown): boolean {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const maybe = value as Record<string, unknown>;
	return (
		(maybe.reason === 'malformed' ||
			maybe.reason === 'unknown-scheme' ||
			maybe.reason === 'noncanonical') &&
		isSemanticContractProvenance(maybe.provenance)
	);
}

export function toClassificationResultMaybe(value: unknown): WorkerClassificationResult | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null;
	}

	const maybe = value as Partial<WorkerClassificationResult>;
	if (!isClassificationStatus(maybe.status) || !isNonEmptyString(maybe.source)) {
		return null;
	}
	if (maybe.identity !== undefined && !isNormalizedAtomIdentity(maybe.identity)) {
		return null;
	}
	if (
		maybe.identityDecision !== undefined &&
		!isIdentityClassificationDecision(maybe.identityDecision)
	) {
		return null;
	}
	if (maybe.providerPlan !== undefined && !isIdentityProviderPlan(maybe.providerPlan)) {
		return null;
	}

	return maybe as WorkerClassificationResult;
}

function isClassificationStatus(value: unknown): value is WorkerClassificationResult['status'] {
	return value === 'recognized' || value === 'unknown_object' || value === 'not_applicable';
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}
