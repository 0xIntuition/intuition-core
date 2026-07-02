import { z } from 'zod/v4';

/**
 * Onboarding flow (v4) — the "stack-cards" onboarding.
 *
 * Steps:
 *   domains   → "What are you in the top 1% of?" (up to 3 signature domains)
 *   bio       → "Why should people trust you?" (bio + declared social links)
 *   curate    → "Prove it." (rank 3 songs into a first stack)
 *   stacks    → "Same stack. Different takes." (concept education)
 *   interests → "What topics are you interested in?" (≥3 categories)
 *   follow    → "The best of everything, ranked by everyone." (bookmark + follow)
 *   discuss   → "Find and share the thoughts that matter." (live threads on a card)
 *   reveal    → calibrating → booster-pack reveal → finalize
 */
export const onboardingStepSchema = z.enum([
	'domains',
	'bio',
	'curate',
	'stacks',
	'interests',
	'follow',
	'discuss',
	'reveal',
]);

export type OnboardingStep = z.infer<typeof onboardingStepSchema>;

export const onboardingStatusSchema = z.enum(['onboarding', 'completed']);
export type OnboardingStatus = z.infer<typeof onboardingStatusSchema>;

/** Retained for parsing finalized data written by the legacy v3 flow. */
export const personalizationOptionSchema = z.enum(['ranker', 'earn', 'discover', 'explore']);
export type PersonalizationOption = z.infer<typeof personalizationOptionSchema>;

export const onboardingInterestSchema = z.object({
	atomId: z.string().min(1),
	name: z.string().min(1),
});

export type OnboardingInterest = z.infer<typeof onboardingInterestSchema>;

/** A signature domain claimed on the "Top 1%" step (same shape as an interest). */
export const onboardingCategorySchema = onboardingInterestSchema;
export type OnboardingCategory = z.infer<typeof onboardingCategorySchema>;

export const onboardingSocialPlatformSchema = z.enum([
	'x',
	'github',
	'medium',
	'linkedin',
	'substack',
]);
export type OnboardingSocialPlatform = z.infer<typeof onboardingSocialPlatformSchema>;

/**
 * A social account the user declared on the bio step. Declared, not
 * OAuth-verified — verification is a follow-up once providers exist.
 */
export const onboardingSocialLinkSchema = z.object({
	platform: onboardingSocialPlatformSchema,
	handle: z.string().max(120).default(''),
});
export type OnboardingSocialLink = z.infer<typeof onboardingSocialLinkSchema>;

/** One ranked pick from the "Prove it" curation step (a real KG atom). */
export const onboardingSongPickSchema = z.object({
	atomId: z.string().min(1),
	title: z.string().min(1),
	subtitle: z.string().optional(),
	image: z.string().optional(),
});
export type OnboardingSongPick = z.infer<typeof onboardingSongPickSchema>;

/** Lightweight preview of a stack bookmarked during the follow step. */
export const onboardingStackPreviewSchema = z.object({
	stackId: z.string().min(1),
	title: z.string().min(1),
	image: z.string().optional(),
	curator: z.string().optional(),
});
export type OnboardingStackPreview = z.infer<typeof onboardingStackPreviewSchema>;

/** Lightweight preview of an account followed during the follow step. */
export const onboardingFollowPreviewSchema = z.object({
	accountId: z.string().min(1),
	name: z.string().min(1),
	image: z.string().optional(),
});
export type OnboardingFollowPreview = z.infer<typeof onboardingFollowPreviewSchema>;

export const onboardingDraftSchemaV4 = z.object({
	version: z.literal(4),
	currentStep: onboardingStepSchema,
	categories: z.array(onboardingCategorySchema).max(3).default([]),
	bio: z.string().max(500).default(''),
	socialLinks: z.array(onboardingSocialLinkSchema).default([]),
	songPicks: z.array(onboardingSongPickSchema).max(3).default([]),
	interests: z.array(onboardingInterestSchema).default([]),
	bookmarkedStacks: z.array(onboardingStackPreviewSchema).default([]),
	following: z.array(onboardingFollowPreviewSchema).default([]),
	updatedAt: z.string().datetime(),
});

export const onboardingDraftSchema = onboardingDraftSchemaV4;
export type OnboardingDraft = z.infer<typeof onboardingDraftSchemaV4>;

export const onboardingDraftUpdateSchema = z.object({
	currentStep: onboardingStepSchema,
	categories: z.array(onboardingCategorySchema).max(3).optional(),
	bio: z.string().max(500).optional(),
	socialLinks: z.array(onboardingSocialLinkSchema).optional(),
	songPicks: z.array(onboardingSongPickSchema).max(3).optional(),
	interests: z.array(onboardingInterestSchema).optional(),
	bookmarkedStacks: z.array(onboardingStackPreviewSchema).optional(),
	following: z.array(onboardingFollowPreviewSchema).optional(),
});

export type OnboardingDraftUpdate = z.infer<typeof onboardingDraftUpdateSchema>;

export const finalizedOnboardingSchema = z.object({
	version: z.literal(4),
	categories: z.array(onboardingCategorySchema).max(3).default([]),
	bio: z.string().max(500).default(''),
	socialLinks: z.array(onboardingSocialLinkSchema).default([]),
	songPicks: z.array(onboardingSongPickSchema).max(3).default([]),
	interests: z.array(onboardingInterestSchema).min(3),
	bookmarkedStacks: z.array(onboardingStackPreviewSchema).default([]),
	following: z.array(onboardingFollowPreviewSchema).default([]),
	completedAt: z.string().datetime(),
});

export type FinalizedOnboarding = z.infer<typeof finalizedOnboardingSchema>;

/**
 * Finalized data written by the legacy v3 flow. Still parsed by readers that
 * need interests from users who completed onboarding before v4 shipped
 * (e.g. the recommendations router).
 */
export const finalizedOnboardingSchemaV3 = z.object({
	version: z.literal(3),
	personalization: z.array(personalizationOptionSchema).min(1),
	interests: z.array(onboardingInterestSchema).min(3),
	completedAt: z.string().datetime(),
});

export type FinalizedOnboardingV3 = z.infer<typeof finalizedOnboardingSchemaV3>;

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function getLegacyCurrentStep(_status: string | undefined): OnboardingStep {
	// All legacy in-progress statuses restart at the first v4 step.
	return 'domains';
}

export function getNormalizedOnboardingStatus(status: string | undefined): OnboardingStatus {
	return status === 'complete' || status === 'completed' ? 'completed' : 'onboarding';
}

export function parseOnboardingDraft(data: unknown): OnboardingDraft | null {
	if (!isRecord(data) || !('onboardingDraft' in data)) {
		return null;
	}

	const raw = data.onboardingDraft;
	const v4 = onboardingDraftSchemaV4.safeParse(raw);
	if (v4.success) return v4.data;

	// Pre-v4 drafts (v1–v3) belong to the retired flow — restart from scratch.
	return null;
}

/**
 * Read finalized onboarding interests regardless of which flow version wrote
 * them (v4 or legacy v3).
 */
export function readFinalizedOnboardingInterests(data: unknown): OnboardingInterest[] {
	if (!isRecord(data) || !isRecord(data.onboarding)) {
		return [];
	}

	const v4 = finalizedOnboardingSchema.safeParse(data.onboarding);
	if (v4.success) return v4.data.interests;

	const v3 = finalizedOnboardingSchemaV3.safeParse(data.onboarding);
	if (v3.success) return v3.data.interests;

	return [];
}
