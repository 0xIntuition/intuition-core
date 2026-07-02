import {
	normalizePersistedEnrichmentArtifacts,
	normalizeProcessEnrichmentArtifacts,
} from '@0xintuition/types/enrichment';
import type { AnyNormalizedArtifact, PersistedArtifactInput, ProcessArtifactInput } from './types';

export function normalizePersistedArtifacts(
	artifacts: PersistedArtifactInput[]
): AnyNormalizedArtifact[] {
	return normalizePersistedEnrichmentArtifacts(artifacts);
}

export function normalizeProcessArtifacts(
	artifacts: ProcessArtifactInput[]
): AnyNormalizedArtifact[] {
	return normalizeProcessEnrichmentArtifacts(artifacts);
}
