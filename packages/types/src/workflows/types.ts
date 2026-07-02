/**
 * Workflow Artifact Types
 *
 * This file provides comprehensive type definitions for workflow results and artifacts.
 * These types match the actual JSON structures stored in the database and returned by
 * the Mastra workflow engine.
 *
 * Usage:
 * - Import types for type-safe access to workflow data
 * - Use type guards for runtime validation
 * - Use utility functions for safe data extraction
 *
 * @module @0xintuition/types/workflows
 */

import { z } from 'zod';

// =============================================================================
// WORKFLOW STATUS & CLASSIFICATION
// =============================================================================

/**
 * Workflow status values - matches the backend schema
 */
export const WorkflowStatusSchema = z.enum([
	'pending',
	'running',
	'completed',
	'failed',
	'cancelled',
]);
export type WorkflowStatus = z.infer<typeof WorkflowStatusSchema>;

/**
 * Workflow classification - identifies the type of workflow
 */
export const WorkflowClassificationSchema = z.enum(['upscale-image']);
export type WorkflowClassification = z.infer<typeof WorkflowClassificationSchema>;

// =============================================================================
// ATOM DATA TYPES
// =============================================================================

/**
 * Atom data structure - core atom information for knowledge graph nodes
 */
export const AtomDataSchema = z.object({
	name: z.string().describe('Atom name/title'),
	description: z.string().describe('Atom description'),
	category: z.string().optional().describe('Atom category path'),
	keywords: z.array(z.string()).optional().describe('Search keywords'),
});
export type AtomData = z.infer<typeof AtomDataSchema>;

// Backwards compatibility aliases
export const ProductDataSchema = AtomDataSchema;
export type ProductData = AtomData;

/**
 * Atom data with optional fields for input
 */
export const AtomDataInputSchema = z.object({
	name: z.string().optional(),
	description: z.string().optional(),
	category: z.string().optional(),
	keywords: z.array(z.string()).optional(),
});
export type AtomDataInput = z.infer<typeof AtomDataInputSchema>;

// Backwards compatibility aliases
export const ProductDataInputSchema = AtomDataInputSchema;
export type ProductDataInput = AtomDataInput;

/**
 * Enriched atom data with validation constraints
 */
export const EnrichedAtomDataSchema = z.object({
	name: z.string().min(10).max(200).describe('Optimized atom title'),
	description: z.string().min(100).max(2000).describe('Detailed atom description'),
	category: z.string().min(5).describe('Hierarchical category path'),
	keywords: z.array(z.string()).min(5).max(25).describe('Search terms ordered by relevance'),
});
export type EnrichedAtomData = z.infer<typeof EnrichedAtomDataSchema>;

// Backwards compatibility alias
export const AmazonProductDataSchema = EnrichedAtomDataSchema;
export type AmazonProductData = EnrichedAtomData;

// =============================================================================
// CUSTOMER SEGMENT TYPES
// =============================================================================

// Demographics
export const SexSchema = z.enum(['male', 'female', 'unisex', 'other']).or(z.string());
export type Sex = z.infer<typeof SexSchema>;

export const AgeRangeSchema = z
	.string()
	.regex(/^\d{1,3}-\d{1,3}$/, "Age must be in format 'XX-XX'")
	.describe("Age range, e.g. '22-36'");

// Economic Profile
export const IncomeLevelSchema = z
	.enum(['budget', 'moderate', 'comfortable', 'affluent', 'luxury'])
	.or(z.string());
export type IncomeLevel = z.infer<typeof IncomeLevelSchema>;

export const PriceMotivationSchema = z
	.enum(['value-seeker', 'balanced', 'quality-over-price', 'premium-expectation'])
	.or(z.string());
export type PriceMotivation = z.infer<typeof PriceMotivationSchema>;

// Lifestyle
export const LifestageSchema = z
	.enum([
		'student',
		'early-career',
		'established-professional',
		'parent-young-kids',
		'parent-older-kids',
		'empty-nester',
		'retired',
	])
	.or(z.string());
export type Lifestage = z.infer<typeof LifestageSchema>;

export const EnvironmentTypeSchema = z
	.enum(['urban-apartment', 'urban-house', 'suburban', 'rural', 'mixed'])
	.or(z.string());
export type EnvironmentType = z.infer<typeof EnvironmentTypeSchema>;

export const LivingContextSchema = z
	.enum(['lives-alone', 'roommates', 'partner-no-kids', 'family-household', 'multi-generational'])
	.or(z.string());
export type LivingContext = z.infer<typeof LivingContextSchema>;

// Style & Preferences
export const AestheticStyleSchema = z
	.enum([
		'minimal-clean',
		'warm-organic',
		'bold-expressive',
		'classic-traditional',
		'eclectic-creative',
		'functional-practical',
		'luxury-refined',
	])
	.or(z.string());
export type AestheticStyle = z.infer<typeof AestheticStyleSchema>;

export const FashionSensibilitySchema = z
	.enum([
		'basics-focused',
		'trend-aware',
		'classic-timeless',
		'streetwear-influenced',
		'athleisure',
		'professional-polished',
		'bohemian-relaxed',
	])
	.or(z.string());
export type FashionSensibility = z.infer<typeof FashionSensibilitySchema>;

// Values & Behavior
export const PrimaryValuesSchema = z
	.enum([
		'convenience',
		'quality',
		'sustainability',
		'status',
		'self-improvement',
		'family-focus',
		'adventure',
		'wellness',
		'creativity',
		'security',
		'community',
		'authenticity',
	])
	.or(z.string());
export type PrimaryValue = z.infer<typeof PrimaryValuesSchema>;

export const BuyingStyleSchema = z
	.enum([
		'impulse-buyer',
		'research-heavy',
		'social-proof-driven',
		'deal-hunter',
		'brand-loyal',
		'trend-follower',
	])
	.or(z.string());
export type BuyingStyle = z.infer<typeof BuyingStyleSchema>;

// Social & Content
export const SocialPlatformSchema = z
	.enum([
		'tiktok',
		'instagram-reels',
		'instagram-feed',
		'instagram-stories',
		'facebook',
		'pinterest',
		'youtube',
		'youtube-shorts',
		'amazon',
	])
	.or(z.string());
export type SocialPlatform = z.infer<typeof SocialPlatformSchema>;

export const UGCArchetypeSchema = z
	.enum([
		'selfie-review',
		'unboxing',
		'morning-routine',
		'get-ready-with-me',
		'day-in-my-life',
		'haul',
		'before-after',
		'testimonial-talking-head',
		'lifestyle-integration',
		'showing-results',
	])
	.or(z.string());
export type UGCArchetype = z.infer<typeof UGCArchetypeSchema>;

export const TonePreferenceSchema = z
	.enum([
		'casual-friendly',
		'enthusiastic-energetic',
		'calm-reassuring',
		'direct-no-nonsense',
		'aspirational-elevated',
		'playful-humorous',
		'expert-authoritative',
	])
	.or(z.string());
export type TonePreference = z.infer<typeof TonePreferenceSchema>;

/**
 * Content responsiveness scores (1-10 scale)
 */
export const ContentResponsivenessSchema = z.object({
	ugcStyle: z.number().min(1).max(10).describe('How well they respond to UGC-style content'),
	polishedBrand: z
		.number()
		.min(1)
		.max(10)
		.describe('How well they respond to polished brand content'),
	influencerContent: z
		.number()
		.min(1)
		.max(10)
		.describe('How well they respond to influencer content'),
	educational: z.number().min(1).max(10).describe('How well they respond to educational content'),
});
export type ContentResponsiveness = z.infer<typeof ContentResponsivenessSchema>;

/**
 * Customer segment - detailed target audience profile
 */
export const CustomerSegmentSchema = z.object({
	// Basic Demographics
	name: z.string().describe('Name of target market segment'),
	age: AgeRangeSchema,
	sex: SexSchema,
	description: z.string().describe('Brief description of target market'),

	// Economic Profile
	incomeLevel: IncomeLevelSchema,
	priceMotivation: PriceMotivationSchema,

	// Living Situation
	lifestage: LifestageSchema,
	environmentType: EnvironmentTypeSchema,
	livingContext: LivingContextSchema,

	// Preferences & Style
	aestheticStyle: AestheticStyleSchema,
	fashionSensibility: FashionSensibilitySchema,

	// Values & Purchase Behavior
	primaryValues: z
		.array(PrimaryValuesSchema)
		.min(1)
		.max(10)
		.describe('Top values driving purchase decisions'),
	buyingStyle: BuyingStyleSchema,
	decisionDrivers: z.array(z.string()).min(1).max(10).describe('Top factors that close the sale'),

	// Social & Content Strategy
	primaryPlatforms: z.array(SocialPlatformSchema).min(1).describe('Primary social platforms'),
	contentResponsiveness: ContentResponsivenessSchema,
	ugcArchetypeMatch: z
		.array(UGCArchetypeSchema)
		.min(1)
		.max(10)
		.describe('Top UGC content archetypes'),
	relatableScenarios: z
		.array(z.string())
		.min(1)
		.max(10)
		.describe('Specific situations where they use the product'),
	tonePreference: TonePreferenceSchema,

	// Messaging Strategy
	keyMessages: z.array(z.string()).min(1).describe('Core messages that resonate'),
	avoidMessaging: z.array(z.string()).min(1).describe('Messaging that turns them off'),

	// Market Context
	currentSolutions: z.array(z.string()).min(1).describe('What they currently use'),
	brandAffinities: z.array(z.string()).max(10).optional().describe('Brands they trust'),
});
export type CustomerSegment = z.infer<typeof CustomerSegmentSchema>;

// Alias for backwards compatibility
export type TargetMarketSegment = CustomerSegment;
export const TargetMarketSegmentSchema = CustomerSegmentSchema;

// =============================================================================
// MARKET ANALYSIS TYPES
// =============================================================================

/**
 * Market analysis overview - summary and action items
 */
export const MarketAnalysisOverviewSchema = z.object({
	summary: z.string(),
	nextSteps: z.array(z.string()),
	highPriority: z.array(z.string()),
	lowPriority: z.array(z.string()),
});
export type MarketAnalysisOverview = z.infer<typeof MarketAnalysisOverviewSchema>;

/**
 * Market analysis data - comprehensive market research
 */
export const MarketAnalysisDataSchema = z.object({
	marketSize: z.string(),
	competition: z.string(),
	trends: z.array(z.string()),
	opportunities: z.array(z.string()),
	challenges: z.array(z.string()),
	segments: z.array(CustomerSegmentSchema),
});
export type MarketAnalysisData = z.infer<typeof MarketAnalysisDataSchema>;

/**
 * Full market analysis result with overview
 */
export const MarketAnalysisResultSchema = z.object({
	analysis: MarketAnalysisDataSchema,
	overview: MarketAnalysisOverviewSchema.optional(),
});
export type MarketAnalysisResult = z.infer<typeof MarketAnalysisResultSchema>;

// =============================================================================
// IMAGE PROMPT TYPES
// =============================================================================

/**
 * Aspect ratio options
 */
export const AspectRatioSchema = z
	.enum(['1:1', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9'])
	.default('16:9');
export type AspectRatio = z.infer<typeof AspectRatioSchema>;

/**
 * Image size options
 */
export const ImageSizeSchema = z.enum(['1K', '2K', '4K']).default('1K');
export type ImageSize = z.infer<typeof ImageSizeSchema>;

/**
 * Image categories for atom visuals
 */
export const ImageCategoriesSchema = z.enum([
	'general',
	'macro',
	'banner',
	'ugc',
	'modeling',
	'infographic',
	'action',
]);
export type ImageCategories = z.infer<typeof ImageCategoriesSchema>;

// Backwards compatibility alias
export const ProductImageCategoriesSchema = ImageCategoriesSchema;
export type ProductImageCategories = ImageCategories;

/**
 * Image prompt code - technical specifications for image generation
 */
export const ImagePromptCodeSchema = z.object({
	image_purpose: z.string().optional(),
	scene: z
		.object({
			environment: z.string().optional(),
			background: z
				.object({
					material: z.string().optional(),
					color_tone: z.string().optional(),
					cleanliness: z.string().optional(),
				})
				.optional(),
		})
		.optional(),
	camera: z
		.object({
			aperture_f: z.number().optional(),
			focal_length_mm: z.number().optional(),
			distance_descriptor: z.string().optional(),
			focus_strategy: z.string().optional(),
		})
		.optional(),
	lighting: z
		.object({
			type: z.string().optional(),
			quality: z.string().optional(),
			contrast: z.string().optional(),
			direction: z.string().optional(),
			shadow_behavior: z.string().optional(),
			color_temperature: z.string().optional(),
		})
		.optional(),
	composition: z
		.object({
			angle: z.string().optional(),
			framing: z.string().optional(),
			camera_height: z.string().optional(),
			negative_space: z.string().optional(),
		})
		.optional(),
	depth_of_field: z
		.object({
			subject_sharpness: z.string().optional(),
			background_softness: z.string().optional(),
		})
		.optional(),
	output: z
		.object({
			file_style: z.string().optional(),
			resolution: z.string().optional(),
			aspect_ratio: z.string().optional(),
		})
		.optional(),
});
export type ImagePromptCode = z.infer<typeof ImagePromptCodeSchema>;

/**
 * Image prompt - complete prompt for image generation
 */
export const ImagePromptSchema = z.object({
	spoken: z.string().describe('Natural language prompt'),
	code: ImagePromptCodeSchema.or(z.any()).describe('Technical specifications'),
	aspectRatio: AspectRatioSchema.or(z.string()),
});
export type ImagePrompt = z.infer<typeof ImagePromptSchema>;

export const ImagePromptsSchema = z.array(ImagePromptSchema);

// =============================================================================
// ADVERTISEMENT TYPES
// =============================================================================

/**
 * Advertisement - generated ad content
 */
export const AdvertisementSchema = z.object({
	copyedit: z.string().describe('Ad copy text'),
	imageUrl: z.string().url().describe('Generated image URL'),
});
export type Advertisement = z.infer<typeof AdvertisementSchema>;

/**
 * Ad generation prompt - intermediate format during workflow
 */
export const AdPromptSchema = z.object({
	title: z.string(),
	copy: z.string(),
	imagePrompt: ImagePromptSchema,
});
export type AdPrompt = z.infer<typeof AdPromptSchema>;

// =============================================================================
// WORKFLOW ERROR TYPES
// =============================================================================

/**
 * Workflow error - error information when workflow fails
 */
export const WorkflowErrorSchema = z.object({
	message: z.string(),
	code: z.string().optional(),
	details: z.record(z.string(), z.unknown()).optional(),
	category: z.string().optional(),
	domain: z.string().optional(),
	cause: z
		.object({
			name: z.string().optional(),
			message: z.string().optional(),
		})
		.optional(),
});
export type WorkflowError = z.infer<typeof WorkflowErrorSchema>;

// =============================================================================
// WORKFLOW STEP TYPES
// =============================================================================

/**
 * Workflow step result - individual step execution result
 */
export const WorkflowStepResultSchema = z.object({
	status: z.enum(['success', 'failed']),
	startedAt: z.number(),
	endedAt: z.number(),
	payload: z.record(z.string(), z.unknown()),
	output: z.record(z.string(), z.unknown()).optional(),
	error: WorkflowErrorSchema.optional(),
});
export type WorkflowStepResult = z.infer<typeof WorkflowStepResultSchema>;

// =============================================================================
// WORKFLOW METADATA
// =============================================================================

/**
 * Workflow metadata - execution information
 */
export const WorkflowMetadataSchema = z.object({
	durationMs: z.number().optional(),
	runId: z.string().optional(),
});
export type WorkflowMetadata = z.infer<typeof WorkflowMetadataSchema>;

// =============================================================================
// WORKFLOW RESULT - TOP LEVEL STRUCTURE
// =============================================================================

/**
 * Generic workflow result structure
 * This matches the JSON structure stored in node.data for workflow nodes
 */
/**
 * Step output status - matches Mastra workflow step statuses
 * Note: Steps use "success"/"failed" while workflow uses "completed"/"failed"
 */
export const StepOutputStatusSchema = z.enum(['success', 'failed']);
export type StepOutputStatus = z.infer<typeof StepOutputStatusSchema>;

export const WorkflowResultSchema = z.object({
	classification: WorkflowClassificationSchema,
	status: WorkflowStatusSchema,
	startedAt: z.string().datetime(),
	completedAt: z.string().datetime().optional(),
	inputs: z.record(z.string(), z.unknown()),
	outputs: z
		.object({
			input: z.record(z.string(), z.unknown()).optional(),
			// Steps can be either a proper step result or raw input data (for the "input" key)
			steps: z
				.record(z.string(), WorkflowStepResultSchema.or(z.record(z.string(), z.unknown())))
				.optional(),
			result: z.record(z.string(), z.unknown()).optional(),
			// Mastra outputs use "success"/"failed" not the workflow status enum
			status: StepOutputStatusSchema.optional(),
			error: WorkflowErrorSchema.optional(),
		})
		.optional(),
	error: WorkflowErrorSchema.optional(),
	metadata: WorkflowMetadataSchema.optional(),
});
export type WorkflowResult = z.infer<typeof WorkflowResultSchema>;

/**
 * Typed workflow result for specific workflow classifications
 */
export interface TypedWorkflowResult<TInput, TOutput> {
	classification: WorkflowClassification;
	status: WorkflowStatus;
	startedAt: string;
	completedAt?: string;
	inputs: TInput;
	outputs?: {
		input?: TInput;
		steps?: Record<string, WorkflowStepResult>;
		result?: TOutput;
		status?: WorkflowStatus;
		error?: WorkflowError;
	};
	error?: WorkflowError;
	metadata?: WorkflowMetadata;
}

// =============================================================================
// ARTIFACT DATA TYPES
// =============================================================================

/**
 * Artifact types - matches database enum
 */
export const ArtifactTypeSchema = z.enum([
	'content',
	'url',
	'atom-data',
	'market-analysis',
	'market-segment',
	'image-prompts',
	'advertisements',
]);
export type ArtifactType = z.infer<typeof ArtifactTypeSchema>;

/**
 * Artifact data by type
 */
export type ArtifactDataByType = {
	content: string;
	url: string;
	'atom-data': AtomData;
	'market-analysis': MarketAnalysisData;
	'market-segment': CustomerSegment;
	'image-prompts': ImagePrompt[];
	advertisements: Advertisement[];
};

/**
 * Generic artifact structure
 */
export interface Artifact<T extends ArtifactType = ArtifactType> {
	id: string;
	type: T;
	data: ArtifactDataByType[T];
	nodeId?: string;
	userId?: string;
	organizationId?: string;
	createdAt: Date;
	updatedAt: Date;
}
