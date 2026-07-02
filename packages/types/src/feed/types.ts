/**
 * Feed Recommendation Types
 *
 * TypeScript types inferred from the Zod schemas in `schemas.ts`.
 *
 * @module @0xintuition/types/feed
 */

import type { z } from 'zod';
import type {
	EngagementSignalsSchema,
	FeedEntityKindSchema,
	FeedEntitySchema,
	FeedResponseSchema,
	PipelineRequestSchema,
	RecommendationEventSchema,
	recommendationEventTypeOptions,
	SurfaceSchema,
} from './schemas';

/** Surface where the feed is rendered. */
export type Surface = z.infer<typeof SurfaceSchema>;

/** The kind of entity in the feed (frontend terms). */
export type FeedEntityKind = z.infer<typeof FeedEntityKindSchema>;

/** Recommendation event type. */
export type RecommendationEventType = (typeof recommendationEventTypeOptions)[number];

/** Engagement signal counters. */
export type EngagementSignals = z.infer<typeof EngagementSignalsSchema>;

/** A single entity in the recommendation feed. */
export type FeedEntity = z.infer<typeof FeedEntitySchema>;

/** Top-level response from the recommendation feed endpoint. */
export type FeedResponse = z.infer<typeof FeedResponseSchema>;

/** Request payload sent to the recommendation pipeline. */
export type PipelineRequest = z.infer<typeof PipelineRequestSchema>;

/** Analytics event emitted by the recommendation system. */
export type RecommendationEvent = z.infer<typeof RecommendationEventSchema>;
