import type { ArtifactSlug, DecisionVariantId } from '../types';

type RuleIdentityDoc = {
	categories?: string[];
	schemaTypes?: string[];
	urlSignals?: string[];
	canonicalIdSignals?: string[];
};

type RuleEnrichmentDoc = {
	primary: ArtifactSlug[];
	supporting?: ArtifactSlug[];
};

export type RuleDocSnippet = {
	variantId: DecisionVariantId;
	summary: string;
	identity: RuleIdentityDoc;
	enrichment: RuleEnrichmentDoc;
	selectionNotes: string[];
	dbExamples: string[];
};
