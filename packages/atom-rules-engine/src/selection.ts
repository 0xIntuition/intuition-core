import { getRuleDocSnippet } from './rule-catalog';
import type { AnyNormalizedArtifact, AtomDecisionResult } from './types';

export function selectPrimaryArtifactForDecision(
	decision: AtomDecisionResult
): AnyNormalizedArtifact | null {
	const primarySlugs = getRuleDocSnippet(decision.variantId).enrichment.primary;

	for (const slug of primarySlugs) {
		const artifact = decision.context.artifacts.find((candidate) => candidate.slug === slug);
		if (artifact) {
			return artifact;
		}
	}

	return null;
}
