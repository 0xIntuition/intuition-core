/**
 * Feed Recommendation Schemas
 *
 * Zod schemas for the recommendation feed pipeline. These schemas use
 * frontend terminology (item, claim) per the domain glossary.
 *
 * @module @0xintuition/types/feed
 */

import { z } from 'zod';

// =============================================================================
// ENUMS
// =============================================================================

export const surfaceOptions = ['feed', 'discovery', 'explore', 'ad', 'related_items'] as const;
export const SurfaceSchema = z.enum(surfaceOptions);

export const feedEntityKindOptions = ['item', 'claim', 'post', 'stack'] as const;
export const FeedEntityKindSchema = z.enum(feedEntityKindOptions);

export const recommendationEventTypeOptions = [
	'impression',
	'click',
	'bookmark',
	'share',
	'deposit',
	'dwell',
	'dismiss',
] as const;

// =============================================================================
// CORE ENTITY
// =============================================================================

export const EngagementSignalsSchema = z.object({
	bookmarkCount: z.number().int().nonnegative(),
	commentCount: z.number().int().nonnegative(),
	referenceCount: z.number().int().nonnegative(),
	depositCount: z.number().int().nonnegative(),
	vaultAssets: z.number().nonnegative(),
});

export const FeedEntitySchema = z.object({
	id: z.string(),
	kind: FeedEntityKindSchema,
	authorId: z.string(),
	createdAt: z.string().datetime(),
	engagement: EngagementSignalsSchema.nullable(),
	score: z.number(),
	scorerBreakdown: z.record(z.string(), z.number()).optional(),
});

// =============================================================================
// FEED RESPONSE
// =============================================================================

export const FeedResponseSchema = z.object({
	items: z.array(FeedEntitySchema),
	nextCursor: z.string().nullable(),
	candidatesEvaluated: z.number().int().nonnegative(),
	candidatesPassedFilters: z.number().int().nonnegative(),
});

// =============================================================================
// PIPELINE REQUEST
// =============================================================================

export const PipelineRequestSchema = z.object({
	surface: SurfaceSchema,
	userId: z.string(),
	cursor: z.string().optional(),
	limit: z.number().int().min(1).max(100).default(20),
});

// =============================================================================
// RECOMMENDATION EVENT (ANALYTICS)
// =============================================================================

export const RecommendationEventSchema = z.object({
	eventType: z.enum(recommendationEventTypeOptions),
	entityId: z.string(),
	entityKind: FeedEntityKindSchema,
	surface: SurfaceSchema,
	dwellMs: z.number().int().nonnegative().optional(),
	position: z.number().int().nonnegative().optional(),
	timestamp: z.string().datetime().optional(),
});
