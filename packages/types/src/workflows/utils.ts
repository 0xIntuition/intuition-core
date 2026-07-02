/**
 * Workflow Artifact Utilities
 *
 * This file provides utility functions for safely parsing, validating,
 * and extracting data from workflow results and artifacts.
 *
 * @module @0xintuition/types/workflows
 */

import type {
	Advertisement,
	ArtifactType,
	AtomData,
	CustomerSegment,
	ImagePrompt,
	MarketAnalysisData,
	WorkflowClassification,
	WorkflowError,
	WorkflowResult,
	WorkflowStatus,
} from './types';

import {
	AdvertisementSchema,
	AtomDataSchema,
	CustomerSegmentSchema,
	ImagePromptSchema,
	MarketAnalysisDataSchema,
	WorkflowClassificationSchema,
	WorkflowResultSchema,
	WorkflowStatusSchema,
} from './types';

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if a value is a valid workflow classification
 */
export function isWorkflowClassification(value: unknown): value is WorkflowClassification {
	return WorkflowClassificationSchema.safeParse(value).success;
}

/**
 * Check if a value is a valid workflow status
 */
export function isWorkflowStatus(value: unknown): value is WorkflowStatus {
	return WorkflowStatusSchema.safeParse(value).success;
}

/**
 * Check if a workflow result is completed successfully
 */
export function isWorkflowCompleted(result: WorkflowResult): boolean {
	return result.status === 'completed' && !result.error;
}

/**
 * Check if a workflow result has failed
 */
export function isWorkflowFailed(result: WorkflowResult): boolean {
	return result.status === 'failed' || !!result.error;
}

/**
 * Check if a workflow result is still running
 */
export function isWorkflowRunning(result: WorkflowResult): boolean {
	return result.status === 'running' || result.status === 'pending';
}

/**
 * Check if data is valid atom data
 */
export function isAtomData(data: unknown): data is AtomData {
	return AtomDataSchema.safeParse(data).success;
}

// Backwards compatibility alias
export const isProductData = isAtomData;

/**
 * Check if data is valid market analysis
 */
export function isMarketAnalysisData(data: unknown): data is MarketAnalysisData {
	return MarketAnalysisDataSchema.safeParse(data).success;
}

/**
 * Check if data is valid customer segment
 */
export function isCustomerSegment(data: unknown): data is CustomerSegment {
	return CustomerSegmentSchema.safeParse(data).success;
}

/**
 * Check if data is valid advertisement
 */
export function isAdvertisement(data: unknown): data is Advertisement {
	return AdvertisementSchema.safeParse(data).success;
}

/**
 * Check if data is valid image prompt
 */
export function isImagePrompt(data: unknown): data is ImagePrompt {
	return ImagePromptSchema.safeParse(data).success;
}

// =============================================================================
// SAFE PARSERS
// =============================================================================

/**
 * Safely parse workflow result from unknown data
 */
export function parseWorkflowResult(data: unknown): WorkflowResult | null {
	const result = WorkflowResultSchema.safeParse(data);
	return result.success ? result.data : null;
}

/**
 * Safely parse atom data from unknown data
 */
export function parseAtomData(data: unknown): AtomData | null {
	const result = AtomDataSchema.safeParse(data);
	return result.success ? result.data : null;
}

// Backwards compatibility alias
export const parseProductData = parseAtomData;

/**
 * Safely parse market analysis from unknown data
 */
export function parseMarketAnalysisData(data: unknown): MarketAnalysisData | null {
	const result = MarketAnalysisDataSchema.safeParse(data);
	return result.success ? result.data : null;
}

/**
 * Safely parse customer segment from unknown data
 */
export function parseCustomerSegment(data: unknown): CustomerSegment | null {
	const result = CustomerSegmentSchema.safeParse(data);
	return result.success ? result.data : null;
}

/**
 * Safely parse advertisement from unknown data
 */
export function parseAdvertisement(data: unknown): Advertisement | null {
	const result = AdvertisementSchema.safeParse(data);
	return result.success ? result.data : null;
}

/**
 * Safely parse image prompt from unknown data
 */
export function parseImagePrompt(data: unknown): ImagePrompt | null {
	const result = ImagePromptSchema.safeParse(data);
	return result.success ? result.data : null;
}

// =============================================================================
// DATA EXTRACTION HELPERS
// =============================================================================

/**
 * Extract workflow result from node data
 */
export function extractWorkflowResult(nodeData: unknown): WorkflowResult | null {
	if (!nodeData || typeof nodeData !== 'object') {
		return null;
	}
	return parseWorkflowResult(nodeData);
}

/**
 * Extract the final result from workflow outputs
 */
export function extractWorkflowOutputResult<T>(workflowResult: WorkflowResult): T | null {
	if (!workflowResult.outputs) {
		return null;
	}
	// Check for 'result' field first (final output)
	if (workflowResult.outputs.result) {
		return workflowResult.outputs.result as T;
	}
	// Fall back to the entire outputs object
	return workflowResult.outputs as unknown as T;
}

/**
 * Extract atom data from workflow result
 */
export function extractAtomData(workflowResult: WorkflowResult): AtomData | null {
	const output = extractWorkflowOutputResult<Record<string, unknown>>(workflowResult);
	// Check for 'atom' field first (new format)
	if (output?.atom) {
		return parseAtomData(output.atom);
	}

	// Try extracting from result field
	const result = workflowResult.outputs?.result as Record<string, unknown> | undefined;
	if (result?.atom) {
		return parseAtomData(result.atom);
	}

	// Backwards compatibility: check for 'product' field
	if (output?.product) {
		return parseAtomData(output.product);
	}
	if (result?.product) {
		return parseAtomData(result.product);
	}

	return null;
}

// Backwards compatibility alias
export const extractProductData = extractAtomData;

/**
 * Extract market analysis from workflow result
 */
export function extractMarketAnalysis(workflowResult: WorkflowResult): MarketAnalysisData | null {
	const output = extractWorkflowOutputResult<Record<string, unknown>>(workflowResult);
	if (output?.analysis) {
		return parseMarketAnalysisData(output.analysis);
	}

	// Try extracting from result field
	const result = workflowResult.outputs?.result as Record<string, unknown> | undefined;
	if (result?.analysis) {
		return parseMarketAnalysisData(result.analysis);
	}

	return null;
}

/**
 * Extract advertisements from workflow result
 */
export function extractAdvertisements(workflowResult: WorkflowResult): Advertisement[] {
	const output = extractWorkflowOutputResult<Record<string, unknown>>(workflowResult);
	if (output?.advertisements && Array.isArray(output.advertisements)) {
		return (output.advertisements as unknown[]).filter(isAdvertisement);
	}

	// Try extracting from result field
	const result = workflowResult.outputs?.result as Record<string, unknown> | undefined;
	if (result?.advertisements && Array.isArray(result.advertisements)) {
		return (result.advertisements as unknown[]).filter(isAdvertisement);
	}

	return [];
}

/**
 * Extract image prompts from workflow result
 */
export function extractImagePrompts(workflowResult: WorkflowResult): ImagePrompt[] {
	const output = extractWorkflowOutputResult<Record<string, unknown>>(workflowResult);
	if (output?.prompts && Array.isArray(output.prompts)) {
		return (output.prompts as unknown[]).filter(isImagePrompt);
	}

	// Try extracting from result field
	const result = workflowResult.outputs?.result as Record<string, unknown> | undefined;
	if (result?.prompts && Array.isArray(result.prompts)) {
		return (result.prompts as unknown[]).filter(isImagePrompt);
	}

	return [];
}

/**
 * Extract file URLs from workflow result
 */
export function extractFileUrls(workflowResult: WorkflowResult): string[] {
	const output = extractWorkflowOutputResult<Record<string, unknown>>(workflowResult);
	const urls: string[] = [];

	// Check various URL fields
	const urlFields = ['fileUrls', 'fileUrlsVariations', 'fileUrlOriginals', 'fileUrlsOriginal'];
	for (const field of urlFields) {
		const value = output?.[field];
		if (Array.isArray(value)) {
			urls.push(...value.filter((url): url is string => typeof url === 'string'));
		}
	}

	return [...new Set(urls)]; // Deduplicate
}

/**
 * Extract customer segments from market analysis
 */
export function extractCustomerSegments(
	marketAnalysis: MarketAnalysisData | null
): CustomerSegment[] {
	if (!marketAnalysis?.segments) {
		return [];
	}
	return marketAnalysis.segments.filter(isCustomerSegment);
}

// =============================================================================
// ERROR HELPERS
// =============================================================================

/**
 * Extract error information from workflow result
 */
export function extractWorkflowError(workflowResult: WorkflowResult): WorkflowError | null {
	// Check top-level error
	if (workflowResult.error) {
		return workflowResult.error;
	}

	// Check outputs error
	if (workflowResult.outputs?.error) {
		return workflowResult.outputs.error;
	}

	return null;
}

/**
 * Get human-readable error message from workflow
 */
export function getWorkflowErrorMessage(workflowResult: WorkflowResult): string | null {
	const error = extractWorkflowError(workflowResult);
	if (!error) {
		return null;
	}

	return error.message || error.cause?.message || 'Unknown error occurred';
}

// =============================================================================
// METADATA HELPERS
// =============================================================================

/**
 * Get workflow duration in milliseconds
 */
export function getWorkflowDuration(workflowResult: WorkflowResult): number | null {
	return workflowResult.metadata?.durationMs ?? null;
}

/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
	if (ms < 1000) return `${ms}ms`;
	if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
	return `${(ms / 60000).toFixed(1)}m`;
}

/**
 * Get workflow started at date
 */
export function getWorkflowStartedAt(workflowResult: WorkflowResult): Date | null {
	if (!workflowResult.startedAt) {
		return null;
	}
	const date = new Date(workflowResult.startedAt);
	return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Get workflow completed at date
 */
export function getWorkflowCompletedAt(workflowResult: WorkflowResult): Date | null {
	if (!workflowResult.completedAt) {
		return null;
	}
	const date = new Date(workflowResult.completedAt);
	return Number.isNaN(date.getTime()) ? null : date;
}

// =============================================================================
// STEP HELPERS
// =============================================================================

/**
 * Get all step results from workflow
 */
export function getWorkflowSteps(workflowResult: WorkflowResult): Record<string, unknown> | null {
	return workflowResult.outputs?.steps ?? null;
}

/**
 * Get a specific step result by name
 */
export function getWorkflowStep(workflowResult: WorkflowResult, stepName: string): unknown | null {
	const steps = getWorkflowSteps(workflowResult);
	if (!steps) {
		return null;
	}
	return steps[stepName] ?? null;
}

/**
 * Check if a specific step completed successfully
 */
export function isStepCompleted(workflowResult: WorkflowResult, stepName: string): boolean {
	const step = getWorkflowStep(workflowResult, stepName);
	if (!step || typeof step !== 'object') {
		return false;
	}
	return (step as Record<string, unknown>).status === 'success';
}

// =============================================================================
// ARTIFACT HELPERS
// =============================================================================

/**
 * Map workflow classification to artifact type
 */
export function classificationToArtifactType(
	classification: WorkflowClassification
): ArtifactType | null {
	const mapping: Record<WorkflowClassification, ArtifactType | null> = {
		'upscale-image': null, // No artifact type for upscale
	};
	return mapping[classification];
}

/**
 * Get display label for workflow classification
 */
export function getClassificationLabel(classification: WorkflowClassification): string {
	const labels: Record<WorkflowClassification, string> = {
		'upscale-image': 'Image Upscale',
	};
	return labels[classification] ?? classification;
}

/**
 * Get display label for workflow status
 */
export function getStatusLabel(status: WorkflowStatus): string {
	const labels: Record<WorkflowStatus, string> = {
		pending: 'Pending',
		running: 'Running',
		completed: 'Completed',
		failed: 'Failed',
		cancelled: 'Cancelled',
	};
	return labels[status] ?? status;
}

// =============================================================================
// INPUT VALIDATION HELPERS
// =============================================================================

/**
 * Check if workflow inputs contain required atom data
 */
export function hasAtomInput(workflowResult: WorkflowResult): boolean {
	const inputs = workflowResult.inputs;
	if (!inputs || typeof inputs !== 'object') {
		return false;
	}
	// Check for 'atom' or 'product' (backwards compatibility)
	return 'atom' in inputs || 'product' in inputs;
}

// Backwards compatibility alias
export const hasProductInput = hasAtomInput;

/**
 * Check if workflow inputs contain file URLs
 */
export function hasFileUrls(workflowResult: WorkflowResult): boolean {
	const inputs = workflowResult.inputs;
	if (!inputs || typeof inputs !== 'object') {
		return false;
	}
	const fileUrls = (inputs as Record<string, unknown>).fileUrls;
	return Array.isArray(fileUrls) && fileUrls.length > 0;
}

/**
 * Get input file URLs from workflow result
 */
export function getInputFileUrls(workflowResult: WorkflowResult): string[] {
	const inputs = workflowResult.inputs;
	if (!inputs || typeof inputs !== 'object') {
		return [];
	}
	const fileUrls = (inputs as Record<string, unknown>).fileUrls;
	if (!Array.isArray(fileUrls)) {
		return [];
	}
	return fileUrls.filter((url): url is string => typeof url === 'string');
}
