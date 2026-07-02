/**
 * Intuition Shared Types
 *
 * This package provides shared type definitions and utilities
 * for the Intuition monorepo.
 *
 * @module @0xintuition/types
 *
 * @example
 * ```typescript
 * // Import workflow types
 * import type { WorkflowResult, AtomData } from '@0xintuition/types/workflows';
 *
 * // Or import everything
 * import * as workflows from '@0xintuition/types/workflows';
 * ```
 */

// Re-export classification contracts for convenience
// Prefer using '@0xintuition/types/classification' for tree-shaking
export * from './classification';
// Re-export enrichment contracts for convenience
// Prefer using '@0xintuition/types/enrichment' for tree-shaking
export * from './enrichment';
// Re-export feed/recommendation types for convenience
// Prefer using '@0xintuition/types/feed' for tree-shaking
export * from './feed';
// Re-export onboarding contracts for convenience
// Prefer using '@0xintuition/types/onboarding' for tree-shaking
export * from './onboarding';
// Re-export timescale domain types for convenience
// Prefer using '@0xintuition/types/timescale' for tree-shaking
export * from './timescale';
// Re-export Trust Circle contracts for convenience
// Prefer using '@0xintuition/types/trust-circles' for tree-shaking
export * from './trust-circles';
// Re-export workflow types for convenience
// Prefer using '@0xintuition/types/workflows' for tree-shaking
export * from './workflows';
