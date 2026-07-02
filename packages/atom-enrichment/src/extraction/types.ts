import type { ClassificationSpec } from '@0xintuition/classifications';
import type { FetchLike } from '../plugins/providers/__shared__/http';
import type { EnrichmentArtifact } from '../types';

// Provenance source identifiers are stable strings so they can travel through
// the tRPC boundary and be rendered by the UI (for example as a chip).
export type FieldExtractionSource =
	| 'input-url'
	| 'opengraph'
	| 'wikidata'
	| 'wikipedia'
	| (string & {});

export type ExtractedField = {
	key: string;
	value: unknown;
	source: FieldExtractionSource;
	confidence: number;
	evidenceUrl?: string;
};

export type DroppedField = {
	key: string;
	source: FieldExtractionSource;
	reason: string;
};

export type FieldExtractionResult = {
	classification: string;
	values: Record<string, unknown>;
	fields: Record<string, ExtractedField>;
	missingRequired: string[];
	droppedFields: DroppedField[];
};

export type ExtractionContext = {
	spec: ClassificationSpec;
	url: string;
	artifacts: readonly EnrichmentArtifact[];
	fetcher: FetchLike;
	language: string;
	signal?: AbortSignal;
};

export type ClassificationFieldExtractor = (
	context: ExtractionContext
) => Promise<ExtractedField[]>;

export type ExtractClassificationFieldsInput = {
	classification: string;
	url: string;
	artifacts: readonly EnrichmentArtifact[];
	fetcher?: FetchLike;
	language?: string;
	signal?: AbortSignal;
};
