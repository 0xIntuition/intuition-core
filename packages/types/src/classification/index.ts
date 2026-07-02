/**
 * Shared classification contracts for cross-package consumers.
 *
 * This surface intentionally excludes plugin authoring/runtime internals.
 * Plugin manifests, hooks, resolvers, and related validation helpers remain
 * implementation-owned in `@0xintuition/atom-classification`.
 */

export type {
	ClassificationCanonicalData,
	ClassificationCanonicalEnvelope,
	ClassificationCanonicalFieldPolicy,
	ClassificationCanonicalFieldPolicyMap,
	ClassificationCanonicalMeta,
	ClassificationClientClassificationHint,
	ClassificationClientHints,
	ClassificationEntityCategory,
	ClassificationFieldProvenanceEntry,
	ClassificationFieldProvenanceMap,
	ClassificationInputIntent,
	ClassificationMode,
	ClassificationPluginId,
	ClassificationPromotionTier,
	ClassificationRequest,
	ClassificationRequestInput,
	ClassificationResolvedAtom,
	ClassificationResolvedPayload,
	ClassificationResolverError,
	ClassificationResult,
	ClassificationRuntime,
	ClassificationServerTier,
	ClassificationSourceFamily,
	EnhancementPolicy,
	EnhancementPolicyOverride,
} from '@0xintuition/atom-classification/types';

export {
	classificationCanonicalDataSchema,
	classificationCanonicalEnvelopeSchema,
	classificationCanonicalFieldPolicyMapSchema,
	classificationCanonicalFieldPolicySchema,
	classificationCanonicalMetaSchema,
	classificationClientClassificationHintSchema,
	classificationClientHintsSchema,
	classificationClientResultHintSchema,
	classificationEntityCategorySchema,
	classificationFieldProvenanceEntrySchema,
	classificationFieldProvenanceMapSchema,
	classificationInputIntentSchema,
	classificationInputTypeSchema,
	classificationModeSchema,
	classificationPluginIdSchema,
	classificationPromotionTierSchema,
	classificationProvenanceSourceSchema,
	classificationRequestSchema,
	classificationResolvedAtomSchema,
	classificationResolvedPayloadSchema,
	classificationResolverErrorSchema,
	classificationResultSchema,
	classificationRuntimeSchema,
	classificationServerTierSchema,
	classificationSessionIdSchema,
	classificationSourceFamilySchema,
	enhancementPolicyOverrideSchema,
	enhancementPolicySchema,
	getDefaultEnhancementPolicy,
	resolveEnhancementPolicy,
} from '@0xintuition/atom-classification/types';
