/**
 * Core-owned persistence and worker-handoff contracts for normalized identity.
 *
 * These DTOs intentionally contain no IID grammar, scheme registry, semantic
 * mappings, or provider selection logic. Future adapters map public package
 * results into these stable Core records before they cross worker/database
 * boundaries.
 */

export type SemanticContractProvenance = {
	producer: string;
	version: string;
	specificationVersion?: string;
};

export type NormalizedAtomIdentity = {
	raw: string;
	canonical: string;
	scheme: string;
	value: string;
	/** Atom representation profile, when the producing adapter has that context. */
	profile?: 'p0' | 'p1' | 'p2';
	/** Public inspection metadata; optional so older persisted records remain valid. */
	class?: 'A' | 'B' | 'C';
	typing?: 'unambiguous' | 'polymorphic';
	anchorIneligibilityReason?: 'class-c' | 'polymorphic-scheme';
	anchorEligible: boolean;
	provenance: SemanticContractProvenance;
};

export type IdentityClassificationDecision = {
	status: 'classified' | 'unmapped' | 'ambiguous';
	classificationSlug?: string;
	schemaType?: string;
	category?: string;
	provenance: SemanticContractProvenance;
};

export type IdentityProviderHint = {
	kind: string;
	value: string;
};

export type IdentityProviderTarget = {
	provider: string;
	capabilities: readonly string[];
	identifierHints: readonly IdentityProviderHint[];
};

export type IdentityProviderPlan = {
	status: 'planned' | 'unsupported';
	targets: readonly IdentityProviderTarget[];
	provenance: SemanticContractProvenance;
};

export function isNormalizedAtomIdentity(value: unknown): value is NormalizedAtomIdentity {
	if (!isRecord(value)) return false;
	return (
		isNonEmptyString(value.raw) &&
		isNonEmptyString(value.canonical) &&
		isNonEmptyString(value.scheme) &&
		isNonEmptyString(value.value) &&
		isOptionalIdentityProfile(value.profile) &&
		isOptionalIdentityClass(value.class) &&
		isOptionalIdentityTyping(value.typing) &&
		isOptionalAnchorIneligibilityReason(value.anchorIneligibilityReason) &&
		typeof value.anchorEligible === 'boolean' &&
		isSemanticContractProvenance(value.provenance)
	);
}

export function isIdentityClassificationDecision(
	value: unknown
): value is IdentityClassificationDecision {
	if (!isRecord(value) || !isClassificationDecisionStatus(value.status)) return false;
	if (!isOptionalNonEmptyString(value.classificationSlug)) return false;
	if (!isOptionalNonEmptyString(value.schemaType)) return false;
	if (!isOptionalNonEmptyString(value.category)) return false;
	return isSemanticContractProvenance(value.provenance);
}

export function isIdentityProviderPlan(value: unknown): value is IdentityProviderPlan {
	if (!isRecord(value) || (value.status !== 'planned' && value.status !== 'unsupported')) {
		return false;
	}
	if (!Array.isArray(value.targets) || !value.targets.every(isIdentityProviderTarget)) {
		return false;
	}
	return isSemanticContractProvenance(value.provenance);
}

function isIdentityProviderTarget(value: unknown): value is IdentityProviderTarget {
	if (!isRecord(value) || !isNonEmptyString(value.provider)) return false;
	if (!Array.isArray(value.capabilities) || !value.capabilities.every(isNonEmptyString))
		return false;
	return (
		Array.isArray(value.identifierHints) && value.identifierHints.every(isIdentityProviderHint)
	);
}

function isIdentityProviderHint(value: unknown): value is IdentityProviderHint {
	return isRecord(value) && isNonEmptyString(value.kind) && isNonEmptyString(value.value);
}

export function isSemanticContractProvenance(value: unknown): value is SemanticContractProvenance {
	return (
		isRecord(value) &&
		isNonEmptyString(value.producer) &&
		isNonEmptyString(value.version) &&
		isOptionalNonEmptyString(value.specificationVersion)
	);
}

function isClassificationDecisionStatus(
	value: unknown
): value is IdentityClassificationDecision['status'] {
	return value === 'classified' || value === 'unmapped' || value === 'ambiguous';
}

function isOptionalIdentityProfile(value: unknown): value is NormalizedAtomIdentity['profile'] {
	return value === undefined || value === 'p0' || value === 'p1' || value === 'p2';
}

function isOptionalIdentityClass(value: unknown): value is NormalizedAtomIdentity['class'] {
	return value === undefined || value === 'A' || value === 'B' || value === 'C';
}

function isOptionalIdentityTyping(value: unknown): value is NormalizedAtomIdentity['typing'] {
	return value === undefined || value === 'unambiguous' || value === 'polymorphic';
}

function isOptionalAnchorIneligibilityReason(
	value: unknown
): value is NormalizedAtomIdentity['anchorIneligibilityReason'] {
	return value === undefined || value === 'class-c' || value === 'polymorphic-scheme';
}

function isOptionalNonEmptyString(value: unknown): boolean {
	return value === undefined || isNonEmptyString(value);
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === 'string' && value.trim().length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}
