import type {
	AnyCanonicalEnrichmentArtifact,
	CanonicalEnrichmentArtifact,
	CanonicalEnrichmentArtifactDataBySlug,
	CanonicalEnrichmentArtifactSlug,
	PersistedEnrichmentArtifactInput,
	ProcessEnrichmentArtifactInput,
} from '@0xintuition/types/enrichment';

export type DecisionVariantId =
	| 'spotify-track'
	| 'spotify-artist'
	| 'spotify-album'
	| 'spotify-playlist'
	| 'spotify-podcast-show'
	| 'spotify-podcast-episode'
	| 'apple-music-song'
	| 'github-repo'
	| 'github-profile'
	| 'amazon-product'
	| 'youtube-video'
	| 'wikipedia-article'
	| 'x-profile'
	| 'x-post'
	| 'npm-package'
	| 'tmdb-movie'
	| 'coingecko-token'
	| 'etherscan-contract'
	| 'website'
	| 'brand-company'
	| 'generic';

export type ArtifactSlug = CanonicalEnrichmentArtifactSlug;

export type ArtifactDataBySlug = CanonicalEnrichmentArtifactDataBySlug;

export type ClassificationResultInput = {
	category?: string;
	schemaType?: string;
	targetUrl?: string;
};

export type ParseResultInput = {
	structuredDocument?: {
		schemaType?: string;
		data?: Record<string, unknown>;
	};
};

export type PersistedArtifactInput = PersistedEnrichmentArtifactInput;

export type PersistedAtomInput = {
	id?: string;
	data?: string;
	artifacts?: PersistedArtifactInput[] | null;
	canonicalArtifacts?: AnyNormalizedArtifact[] | null;
	classification_result?: ClassificationResultInput | null;
	parse_result?: ParseResultInput | null;
};

export type ProcessResolvedAtomInput = {
	category?: string;
	schemaType?: string;
	title?: string;
	description?: string;
	canonicalId?: string;
	sameAs?: string[];
	data?: Record<string, unknown>;
};

export type ProcessPublishableInput = {
	type?: string;
	data?: Record<string, unknown>;
	meta?: {
		sourceUrl?: string;
	};
};

export type ProcessArtifactInput = ProcessEnrichmentArtifactInput;

export type ProcessPayloadInput = {
	classification?: {
		resolved?: {
			atoms?: ProcessResolvedAtomInput[];
			publishable?: ProcessPublishableInput[];
			classifications?: ProcessPublishableInput[];
		};
	};
	enrichment?: {
		artifacts?: ProcessArtifactInput[];
	} | null;
};

export type ResolvedIdentity = {
	category?: string;
	schemaType?: string;
	canonicalId?: string;
	sameAs: string[];
	title?: string;
	description?: string;
	canonicalUrl?: string;
	presentationFamily:
		| 'product'
		| 'software'
		| 'person'
		| 'company'
		| 'song'
		| 'video'
		| 'website'
		| 'generic';
};

export type NormalizedArtifact<TSlug extends ArtifactSlug = ArtifactSlug> =
	CanonicalEnrichmentArtifact<TSlug>;

export type AnyNormalizedArtifact = AnyCanonicalEnrichmentArtifact;

export type RuleEvaluation = {
	ruleId: DecisionVariantId;
	priority: number;
	matched: boolean;
	reason:
		| 'matched'
		| 'missing-artifact'
		| 'type-mismatch'
		| 'url-mismatch'
		| 'identity-mismatch'
		| 'fallback'
		| 'not-applicable';
};

export type DecisionTrace = {
	artifactSlugs: ArtifactSlug[];
	identity: ResolvedIdentity;
	evaluations: RuleEvaluation[];
	selectedRuleId: DecisionVariantId;
};

export type DecisionContext = {
	source: 'persisted-atom' | 'process-payload';
	atomData?: string;
	parsedAtomData?: Record<string, unknown>;
	structuredData?: Record<string, unknown>;
	rawInput?: string;
	derivedAtomData?: string;
	classificationResult?: ClassificationResultInput | null;
	identity: ResolvedIdentity;
	artifacts: AnyNormalizedArtifact[];
};

export type AtomDecisionResult = {
	variantId: DecisionVariantId;
	context: DecisionContext;
	trace: DecisionTrace;
};
