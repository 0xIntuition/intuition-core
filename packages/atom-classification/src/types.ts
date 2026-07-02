import { z } from 'zod/v4';

export const classificationModeSchema = z.enum(['client-only', 'progressive', 'server-only']);
export const classificationRuntimeSchema = z.enum(['client', 'server']);
export const classificationInputIntentSchema = z.enum(['generic', 'url-first']);

export const classificationSessionIdSchema = z.string().min(1).max(128);
export const classificationPluginIdSchema = z
	.string()
	.min(1)
	.max(128)
	.regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const classificationInputTypeSchema = z.enum([
	'url',
	'text',
	'json',
	'ipfs',
	'address',
	'coordinate',
	'identifier',
]);

export const classificationServerTierSchema = z.union([z.literal(2), z.literal(3), z.literal(4)]);

export const enhancementPolicySchema = z
	.object({
		runClientClassification: z.boolean(),
		runServerEnrichment: z.boolean(),
		runDedupe: z.boolean(),
		runAiFallback: z.boolean(),
		includeProvenance: z.boolean(),
		requestedServerTiers: z.array(classificationServerTierSchema).max(3),
	})
	.strict();

export const enhancementPolicyOverrideSchema = enhancementPolicySchema.partial().strict();

export const classificationClientClassificationHintSchema = z
	.object({
		type: classificationInputTypeSchema,
		domain: z.string().min(1).max(128),
		subtype: z.string().min(1).max(128),
		confidence: z.number().min(0).max(1),
		meta: z.record(z.string(), z.unknown()).default({}),
	})
	.strict();

export const classificationEntityCategorySchema = z.enum([
	'person',
	'place',
	'thing',
	'company',
	'product',
	'podcast',
	'song',
	'software',
]);

export const classificationClientResultHintSchema = z
	.object({
		schemaType: z.string().min(1).max(128),
		category: classificationEntityCategorySchema.optional(),
		resolvedBy: z.string().min(1).max(128),
		confidence: z.number().min(0).max(1).optional(),
		data: z.record(z.string(), z.unknown()).default({}),
		hints: z.record(z.string(), z.unknown()).optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
		source: z.string().min(1).max(128).optional(),
	})
	.strict();

export const classificationResolvedAtomSchema = z
	.object({
		schemaType: z.string().min(1).max(128),
		category: classificationEntityCategorySchema,
		title: z.string().min(1).max(512),
		description: z.string().min(1).max(2_000).optional(),
		canonicalId: z.string().min(1).max(512).optional(),
		sameAs: z.array(z.string().min(1).max(1_024)).max(20).default([]),
		source: z.string().min(1).max(128),
		confidence: z.number().min(0).max(1).default(0.5),
		pluginId: z.string().min(1).max(128).optional(),
		resolverId: z.string().min(1).max(128).optional(),
		hints: z.record(z.string(), z.unknown()).default({}),
		metadata: z.record(z.string(), z.unknown()).default({}),
		data: z.record(z.string(), z.unknown()).default({}),
	})
	.strict();

export const classificationSourceFamilySchema = z.enum([
	'jsonld',
	'oembed',
	'opengraph',
	'public-json',
	'domain-html',
	'domain-api',
]);

export const classificationPromotionTierSchema = z.enum(['identity', 'rich-public', 'volatile']);

export const classificationCanonicalFieldPolicySchema = z
	.object({
		promotionTier: classificationPromotionTierSchema,
		sourceFamily: classificationSourceFamilySchema.optional(),
	})
	.strict();

export const classificationCanonicalFieldPolicyMapSchema = z.record(
	z.string().min(1),
	classificationCanonicalFieldPolicySchema
);

export const classificationCanonicalMetaSchema = z
	.object({
		pluginId: z.string().min(1).max(128),
		provider: z.string().min(1).max(128),
		fetchedAt: z.iso.datetime(),
		sourceUrl: z.string().min(1).max(2_048).optional(),
		confidence: z.number().min(0).max(1).optional(),
		resolutionMode: z.enum(['identity-only', 'enriched']).optional(),
		sourceFamily: classificationSourceFamilySchema.optional(),
		fieldPolicies: classificationCanonicalFieldPolicyMapSchema.optional(),
	})
	.strict();

export const classificationCanonicalDataSchema = z
	.record(z.string(), z.unknown())
	.superRefine((value, ctx) => {
		if (Object.keys(value).length === 0) {
			ctx.addIssue({
				code: 'custom',
				message: 'Canonical classification data must include at least one field.',
			});
		}
	});

export const classificationCanonicalEnvelopeSchema = z
	.object({
		type: z.string().min(1).max(128),
		data: classificationCanonicalDataSchema,
		meta: classificationCanonicalMetaSchema,
	})
	.strict();

export const classificationResolvedPayloadSchema = z
	.object({
		resolverId: z.string().min(1).max(128),
		resolverChain: z.array(z.string().min(1).max(128)).max(64),
		dedupeKey: z.string().min(1).max(256),
		fallbackUsed: z.boolean(),
		classifications: z.array(classificationCanonicalEnvelopeSchema).max(10).default([]),
		publishable: z.array(classificationCanonicalEnvelopeSchema).max(10).default([]),
		atoms: z.array(classificationResolvedAtomSchema).max(10).default([]),
	})
	.strict();

export const classificationResolverErrorSchema = z
	.object({
		resolverId: z.string().min(1).max(128),
		message: z.string().min(1).max(512),
		timestamp: z.iso.datetime(),
	})
	.strict();

export const classificationClientHintsSchema = z
	.object({
		platform: z.string().min(1).max(128).optional(),
		locale: z.string().min(2).max(20).optional(),
		timezone: z.string().min(1).max(64).optional(),
		userAgent: z.string().min(1).max(512).optional(),
		expectedTypes: z.array(z.string().min(1).max(128)).max(20).optional(),
		clientClassification: classificationClientClassificationHintSchema.optional(),
		clientResult: classificationClientResultHintSchema.optional(),
		metadata: z.record(z.string(), z.unknown()).optional(),
	})
	.strict();

export const classificationRequestSchema = z
	.object({
		input: z.string().min(1).max(10_000),
		mode: classificationModeSchema.default('progressive'),
		inputIntent: classificationInputIntentSchema.default('generic'),
		classificationSessionId: classificationSessionIdSchema.optional(),
		pluginIds: z.array(classificationPluginIdSchema).max(32).optional(),
		policy: enhancementPolicyOverrideSchema.optional(),
		clientHints: classificationClientHintsSchema.optional(),
	})
	.superRefine((value, ctx) => {
		const result = resolveEnhancementPolicySafe(value.mode, value.policy);

		if ('issues' in result) {
			for (const message of result.issues) {
				ctx.addIssue({
					code: 'custom',
					path: ['policy'],
					message,
				});
			}
		}
	});

export const classificationProvenanceSourceSchema = z.enum(['client', 'server', 'merged', 'user']);

export const classificationFieldProvenanceEntrySchema = z
	.object({
		source: classificationProvenanceSourceSchema,
		confidence: z.number().min(0).max(1),
		updatedAt: z.iso.datetime(),
		tier: z
			.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
			.optional(),
		resolverId: z.string().min(1).max(128).optional(),
	})
	.strict();

export const classificationFieldProvenanceMapSchema = z.record(
	z.string().min(1),
	classificationFieldProvenanceEntrySchema
);

export const classificationResultSchema = z
	.object({
		ok: z.literal(true),
		status: z.enum(['placeholder', 'partial', 'complete']),
		contractVersion: z.enum(['cpkg-01', 'cpkg-02']),
		runtime: classificationRuntimeSchema,
		mode: classificationModeSchema,
		classificationSessionId: classificationSessionIdSchema,
		policy: enhancementPolicySchema,
		message: z.string().min(1),
		receivedAt: z.iso.datetime(),
		classification: classificationClientClassificationHintSchema.optional(),
		resolved: classificationResolvedPayloadSchema.optional(),
		resolverErrors: z.array(classificationResolverErrorSchema).optional(),
		provenance: classificationFieldProvenanceMapSchema.optional(),
		debug: z.object({
			inputPreview: z.string(),
			hasClientHints: z.boolean(),
			inputIntent: classificationInputIntentSchema.default('generic'),
			requestedPluginIds: z.array(classificationPluginIdSchema).max(32),
			requestedServerTiers: z.array(classificationServerTierSchema),
		}),
	})
	.strict();

export type ClassificationMode = z.infer<typeof classificationModeSchema>;
export type ClassificationRuntime = z.infer<typeof classificationRuntimeSchema>;
export type ClassificationInputIntent = z.infer<typeof classificationInputIntentSchema>;
export type ClassificationPluginId = z.infer<typeof classificationPluginIdSchema>;
export type ClassificationServerTier = z.infer<typeof classificationServerTierSchema>;
export type EnhancementPolicy = z.infer<typeof enhancementPolicySchema>;
export type EnhancementPolicyOverride = z.infer<typeof enhancementPolicyOverrideSchema>;
export type ClassificationClientClassificationHint = z.infer<
	typeof classificationClientClassificationHintSchema
>;
export type ClassificationClientHints = z.infer<typeof classificationClientHintsSchema>;
export type ClassificationRequest = z.infer<typeof classificationRequestSchema>;
export type ClassificationRequestInput = Omit<ClassificationRequest, 'mode' | 'inputIntent'> &
	Partial<Pick<ClassificationRequest, 'mode' | 'inputIntent'>>;
export type ClassificationResult = z.infer<typeof classificationResultSchema>;
export type ClassificationEntityCategory = z.infer<typeof classificationEntityCategorySchema>;
export type ClassificationResolvedAtom = z.infer<typeof classificationResolvedAtomSchema>;
export type ClassificationSourceFamily = z.infer<typeof classificationSourceFamilySchema>;
export type ClassificationPromotionTier = z.infer<typeof classificationPromotionTierSchema>;
export type ClassificationCanonicalFieldPolicy = z.infer<
	typeof classificationCanonicalFieldPolicySchema
>;
export type ClassificationCanonicalFieldPolicyMap = z.infer<
	typeof classificationCanonicalFieldPolicyMapSchema
>;
export type ClassificationCanonicalMeta = z.infer<typeof classificationCanonicalMetaSchema>;
export type ClassificationCanonicalData = z.infer<typeof classificationCanonicalDataSchema>;
export type ClassificationCanonicalEnvelope = z.infer<typeof classificationCanonicalEnvelopeSchema>;
export type ClassificationResolvedPayload = z.infer<typeof classificationResolvedPayloadSchema>;
export type ClassificationResolverError = z.infer<typeof classificationResolverErrorSchema>;
export type ClassificationFieldProvenanceEntry = z.infer<
	typeof classificationFieldProvenanceEntrySchema
>;
export type ClassificationFieldProvenanceMap = z.infer<
	typeof classificationFieldProvenanceMapSchema
>;

const defaultEnhancementPolicyByMode: Record<ClassificationMode, EnhancementPolicy> = {
	'client-only': {
		runClientClassification: true,
		runServerEnrichment: false,
		runDedupe: false,
		runAiFallback: false,
		includeProvenance: true,
		requestedServerTiers: [],
	},
	progressive: {
		runClientClassification: true,
		runServerEnrichment: true,
		runDedupe: true,
		runAiFallback: false,
		includeProvenance: true,
		requestedServerTiers: [2, 3],
	},
	'server-only': {
		runClientClassification: false,
		runServerEnrichment: true,
		runDedupe: true,
		runAiFallback: false,
		includeProvenance: true,
		requestedServerTiers: [2, 3],
	},
};

export function getDefaultEnhancementPolicy(mode: ClassificationMode): EnhancementPolicy {
	const defaults = defaultEnhancementPolicyByMode[mode];
	return {
		...defaults,
		requestedServerTiers: [...defaults.requestedServerTiers],
	};
}

export function resolveEnhancementPolicy(
	mode: ClassificationMode,
	overrides?: EnhancementPolicyOverride
): EnhancementPolicy {
	const result = resolveEnhancementPolicySafe(mode, overrides);

	if ('issues' in result) {
		throw new Error(result.issues.join(' '));
	}

	return result.policy;
}

function resolveEnhancementPolicySafe(
	mode: ClassificationMode,
	overrides?: EnhancementPolicyOverride
): { ok: true; policy: EnhancementPolicy } | { ok: false; issues: string[] } {
	const defaults = getDefaultEnhancementPolicy(mode);
	const merged: EnhancementPolicy = enhancementPolicySchema.parse({
		...defaults,
		...overrides,
		requestedServerTiers: normalizeRequestedServerTiers(
			overrides?.requestedServerTiers ?? defaults.requestedServerTiers
		),
	});

	const issues = validatePolicyCompatibility(mode, merged);

	if (issues.length > 0) {
		return { ok: false, issues };
	}

	return { ok: true, policy: merged };
}

function normalizeRequestedServerTiers(
	tiers: ClassificationServerTier[] | undefined
): ClassificationServerTier[] {
	if (!tiers || tiers.length === 0) {
		return [];
	}

	const unique = Array.from(new Set(tiers));
	return unique.sort((a, b) => a - b) as ClassificationServerTier[];
}

function validatePolicyCompatibility(
	mode: ClassificationMode,
	policy: EnhancementPolicy
): string[] {
	const issues: string[] = [];

	if (mode === 'client-only') {
		if (policy.runServerEnrichment) {
			issues.push('client-only mode cannot enable runServerEnrichment.');
		}
		if (policy.runDedupe) {
			issues.push('client-only mode cannot enable runDedupe.');
		}
		if (policy.runAiFallback) {
			issues.push('client-only mode cannot enable runAiFallback.');
		}
		if (policy.requestedServerTiers.length > 0) {
			issues.push('client-only mode must not request server tiers.');
		}
	}

	if (mode === 'server-only' && policy.runClientClassification) {
		issues.push('server-only mode cannot enable runClientClassification.');
	}

	if (!policy.runServerEnrichment) {
		if (policy.requestedServerTiers.length > 0) {
			issues.push('requestedServerTiers requires runServerEnrichment=true.');
		}
		if (policy.runDedupe) {
			issues.push('runDedupe requires runServerEnrichment=true.');
		}
		if (policy.runAiFallback) {
			issues.push('runAiFallback requires runServerEnrichment=true.');
		}
	}

	if (policy.runServerEnrichment && policy.requestedServerTiers.length === 0) {
		issues.push('runServerEnrichment=true requires at least one requested server tier.');
	}

	if (policy.runDedupe && !policy.requestedServerTiers.includes(3)) {
		issues.push('runDedupe=true requires requestedServerTiers to include tier 3.');
	}

	if (policy.runAiFallback && !policy.requestedServerTiers.includes(4)) {
		issues.push('runAiFallback=true requires requestedServerTiers to include tier 4.');
	}

	if (!policy.runAiFallback && policy.requestedServerTiers.includes(4)) {
		issues.push('requested server tier 4 requires runAiFallback=true.');
	}

	return issues;
}
