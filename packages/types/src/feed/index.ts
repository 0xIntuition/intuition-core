/**
 * Feed Recommendation Types and Utilities
 *
 * @module @0xintuition/types/feed
 */

// Type guards and safe parsers
export {
	isFeedEntity,
	isFeedEntityKind,
	isFeedResponse,
	isPipelineRequest,
	isRecommendationEvent,
	isSurface,
	parseFeedEntity,
	parseFeedResponse,
	parsePipelineRequest,
	parseRecommendationEvent,
} from './guards';

// Schemas
export {
	EngagementSignalsSchema,
	FeedEntityKindSchema,
	FeedEntitySchema,
	FeedResponseSchema,
	feedEntityKindOptions,
	PipelineRequestSchema,
	RecommendationEventSchema,
	recommendationEventTypeOptions,
	SurfaceSchema,
	surfaceOptions,
} from './schemas';

// Types
export type {
	EngagementSignals,
	FeedEntity,
	FeedEntityKind,
	FeedResponse,
	PipelineRequest,
	RecommendationEvent,
	RecommendationEventType,
	Surface,
} from './types';
