/**
 * Feed Type Guards and Safe Parsers
 *
 * @module @0xintuition/types/feed
 */

import {
	FeedEntityKindSchema,
	FeedEntitySchema,
	FeedResponseSchema,
	PipelineRequestSchema,
	RecommendationEventSchema,
	SurfaceSchema,
} from './schemas';
import type {
	FeedEntity,
	FeedEntityKind,
	FeedResponse,
	PipelineRequest,
	RecommendationEvent,
	Surface,
} from './types';

// =============================================================================
// TYPE GUARDS
// =============================================================================

/** Check if a value is a valid `FeedEntityKind`. */
export function isFeedEntityKind(value: unknown): value is FeedEntityKind {
	return FeedEntityKindSchema.safeParse(value).success;
}

/** Check if a value is a valid `Surface`. */
export function isSurface(value: unknown): value is Surface {
	return SurfaceSchema.safeParse(value).success;
}

/** Check if a value is a valid `FeedEntity`. */
export function isFeedEntity(value: unknown): value is FeedEntity {
	return FeedEntitySchema.safeParse(value).success;
}

/** Check if a value is a valid `FeedResponse`. */
export function isFeedResponse(value: unknown): value is FeedResponse {
	return FeedResponseSchema.safeParse(value).success;
}

/** Check if a value is a valid `PipelineRequest`. */
export function isPipelineRequest(value: unknown): value is PipelineRequest {
	return PipelineRequestSchema.safeParse(value).success;
}

/** Check if a value is a valid `RecommendationEvent`. */
export function isRecommendationEvent(value: unknown): value is RecommendationEvent {
	return RecommendationEventSchema.safeParse(value).success;
}

// =============================================================================
// SAFE PARSERS
// =============================================================================

/** Safely parse a `FeedEntity` from unknown data. Returns `null` on failure. */
export function parseFeedEntity(data: unknown): FeedEntity | null {
	const result = FeedEntitySchema.safeParse(data);
	return result.success ? result.data : null;
}

/** Safely parse a `FeedResponse` from unknown data. Returns `null` on failure. */
export function parseFeedResponse(data: unknown): FeedResponse | null {
	const result = FeedResponseSchema.safeParse(data);
	return result.success ? result.data : null;
}

/** Safely parse a `PipelineRequest` from unknown data. Returns `null` on failure. */
export function parsePipelineRequest(data: unknown): PipelineRequest | null {
	const result = PipelineRequestSchema.safeParse(data);
	return result.success ? result.data : null;
}

/** Safely parse a `RecommendationEvent` from unknown data. Returns `null` on failure. */
export function parseRecommendationEvent(data: unknown): RecommendationEvent | null {
	const result = RecommendationEventSchema.safeParse(data);
	return result.success ? result.data : null;
}
