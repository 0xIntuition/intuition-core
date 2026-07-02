export { harvestAugmentationLookups, mergeHarvests } from './augmentation';
export type { ChainHarvest } from './chaining';
export { harvestChainIdentifiers } from './chaining';
export { extractClassificationFields } from './extract';
export { extractPageNativeFields, pickPrimaryJsonLdType } from './page-native';
export { suggestClassifications } from './suggest';
export type {
	ClassificationFieldExtractor,
	DroppedField,
	ExtractClassificationFieldsInput,
	ExtractedField,
	ExtractionContext,
	FieldExtractionResult,
	FieldExtractionSource,
} from './types';
export type { UrlFirstClassification, UrlFirstEnrichmentPreset } from './url-first';
export {
	buildUrlFirstClassifiedAtomInput,
	hasArtifactOfType,
	readWikibaseItemFromArtifacts,
	resolveUrlFirstClassification,
} from './url-first';
export {
	readEntityIdClaimValues,
	readTimeClaimValue,
	resolveWikidataEntityLabels,
	WIKIDATA_PROPERTY,
} from './wikidata-claims';
