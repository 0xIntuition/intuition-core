import { getClassification, validateClassificationValues } from '@0xintuition/classifications';
import type { FetchLike } from '../plugins/providers/__shared__/http';
import {
	extractEthereumAccountFields,
	extractEthereumContractFields,
	extractEthereumErc20Fields,
	extractMusicFields,
	extractPlacesBackedFields,
	extractPodcastFields,
	extractSocialMediaAccountFields,
	extractSoftwareApplicationFields,
	extractSoftwareFields,
	extractVideoObjectFields,
} from './direct-providers';
import { extractPageNativeFields } from './page-native';
import {
	CONFIDENCE,
	field,
	findArtifactData,
	parseOpengraph,
	parseWikidata,
	parseWikipedia,
	readString,
} from './shared';
import type {
	ClassificationFieldExtractor,
	ExtractClassificationFieldsInput,
	ExtractedField,
	ExtractionContext,
	FieldExtractionResult,
} from './types';
import {
	WIKIDATA_CLASSIFICATION_MAPS,
	type WikidataClassificationMap,
} from './wikidata-claim-maps';
import {
	readEntityIdClaimValues,
	readQuantityClaimValue,
	readStringClaimValues,
	readTimeClaimValue,
	resolveWikidataEntityLabels,
} from './wikidata-claims';

const DESCRIPTION_MAX_LENGTH = 320;

function truncateAtSentence(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	const slice = value.slice(0, maxLength);
	const sentenceEnd = slice.lastIndexOf('. ');
	if (sentenceEnd > maxLength * 0.5) {
		return slice.slice(0, sentenceEnd + 1);
	}
	return `${slice.trimEnd()}…`;
}

// ── Wikidata claim-map executor ──────────────────────────────────────────────
// Runs the declarative per-classification claim mappings: literal claims map
// straight to fields; entity-valued claims resolve to labels in one batched
// call. Multi-valued claims use the first (preferred-rank aware) statement —
// for example the first P735 given name is the primary given name.

async function extractWikidataClaimFields(
	context: ExtractionContext,
	map: WikidataClassificationMap
): Promise<ExtractedField[]> {
	const wikidata = findArtifactData(context.artifacts, 'wikidata', parseWikidata);
	if (!wikidata) return [];

	const claims = wikidata.data.claims;
	const evidenceUrl = `https://www.wikidata.org/wiki/${wikidata.data.entityId}`;

	const entityIdByField = new Map<string, string>();
	for (const mapping of map.fields) {
		if (mapping.kind !== 'entity-label') continue;
		const entityId = readEntityIdClaimValues(claims, mapping.property)[0];
		if (entityId) entityIdByField.set(mapping.field, entityId);
	}
	const labels =
		entityIdByField.size > 0
			? await resolveWikidataEntityLabels(context.fetcher, [...entityIdByField.values()], {
					language: context.language,
					...(context.signal ? { signal: context.signal } : {}),
				})
			: new Map<string, string>();

	const fields: ExtractedField[] = [];
	for (const mapping of map.fields) {
		if (mapping.kind === 'entity-label') {
			const entityId = entityIdByField.get(mapping.field);
			const label = entityId ? labels.get(entityId) : undefined;
			if (label) {
				fields.push(
					field(mapping.field, label, 'wikidata', CONFIDENCE.wikidataResolvedLabel, evidenceUrl)
				);
			}
			continue;
		}
		const value =
			mapping.kind === 'string'
				? readStringClaimValues(claims, mapping.property)[0]
				: mapping.kind === 'time'
					? readTimeClaimValue(claims, mapping.property)
					: readQuantityClaimValue(claims, mapping.property);
		if (value !== undefined) {
			fields.push(field(mapping.field, value, 'wikidata', CONFIDENCE.wikidataClaim, evidenceUrl));
		}
	}

	// sameAs: input + knowledge urls + external-id templates (X handle, IMDb,
	// TMDb, LinkedIn, …). Only emitted when the spec defines sameAs.
	if (context.spec.fields.some((specField) => specField.key === 'sameAs')) {
		const wikipedia = findArtifactData(context.artifacts, 'wikipedia', parseWikipedia);
		const templated = (map.sameAsTemplates ?? []).flatMap((template) => {
			const value = readStringClaimValues(claims, template.property)[0];
			return value ? [template.template.replace('{value}', encodeURIComponent(value))] : [];
		});
		const sameAs = [
			...new Set(
				[context.url, wikipedia?.data.pageUrl, evidenceUrl, ...templated].filter(
					(value): value is string => typeof value === 'string' && value.length > 0
				)
			),
		];
		fields.push(field('sameAs', sameAs, 'wikidata', CONFIDENCE.wikidataResolvedLabel, evidenceUrl));
	}

	return fields;
}

// ── Location: address composed from admin area (P131) + country (P17) ───────
// Wikidata rarely stores street addresses; "City, Country" is an honest
// approximation, marked with reduced confidence.

async function extractLocationFields(context: ExtractionContext): Promise<ExtractedField[]> {
	const wikidata = findArtifactData(context.artifacts, 'wikidata', parseWikidata);
	if (!wikidata) return [];

	const claims = wikidata.data.claims;
	const evidenceUrl = `https://www.wikidata.org/wiki/${wikidata.data.entityId}`;
	const adminAreaId = readEntityIdClaimValues(claims, 'P131')[0];
	const countryId = readEntityIdClaimValues(claims, 'P17')[0];
	const entityIds = [adminAreaId, countryId].filter((id): id is string => Boolean(id));
	if (entityIds.length === 0) return [];

	const labels = await resolveWikidataEntityLabels(context.fetcher, entityIds, {
		language: context.language,
		...(context.signal ? { signal: context.signal } : {}),
	});
	const parts = [
		...new Set(
			[adminAreaId, countryId]
				.map((id) => (id ? labels.get(id) : undefined))
				.filter((label): label is string => Boolean(label))
		),
	];
	if (parts.length === 0) return [];

	return [field('address', parts.join(', '), 'wikidata', CONFIDENCE.wikidataComposed, evidenceUrl)];
}

const CLASSIFICATION_EXTRACTORS: Record<string, ClassificationFieldExtractor> = {
	...Object.fromEntries(
		Object.entries(WIKIDATA_CLASSIFICATION_MAPS).map(([slug, map]) => [
			slug,
			(context: ExtractionContext) => extractWikidataClaimFields(context, map),
		])
	),
	// Companies pasted as Maps links (a storefront, an HQ) resolve through the
	// Places artifact: name from the listing, url from the business website.
	// Wikidata claims still win for Wikipedia-sourced companies — first
	// candidate per key wins, and the two sources never co-occur in practice.
	company: async (context) => [
		...(await extractWikidataClaimFields(
			context,
			WIKIDATA_CLASSIFICATION_MAPS.company ?? { fields: [] }
		)),
		...extractPlacesBackedFields(context),
	],
	brand: async (context) => [
		...(await extractWikidataClaimFields(
			context,
			WIKIDATA_CLASSIFICATION_MAPS.brand ?? { fields: [] }
		)),
		...extractPlacesBackedFields(context),
	],
	service: async (context) => [
		...(await extractWikidataClaimFields(
			context,
			WIKIDATA_CLASSIFICATION_MAPS.service ?? { fields: [] }
		)),
		...extractPlacesBackedFields(context),
	],
	// Physical places: the Google Places artifact carries the full street
	// address/phone/website; wikidata's composed "City, Country" is the
	// fallback. First candidate per key wins in the merge.
	location: async (context) => [
		...extractPlacesBackedFields(context),
		...(await extractLocationFields(context)),
	],
	'local-business': (context) => Promise.resolve(extractPlacesBackedFields(context)),
	'music-recording': (context) => Promise.resolve(extractMusicFields(context)),
	'music-album': (context) => Promise.resolve(extractMusicFields(context)),
	'music-group': (context) => Promise.resolve(extractMusicFields(context)),
	'podcast-series': (context) => Promise.resolve(extractPodcastFields(context, 'series')),
	'podcast-episode': (context) => Promise.resolve(extractPodcastFields(context, 'episode')),
	software: (context) => Promise.resolve(extractSoftwareFields(context)),
	'software-application': (context) => Promise.resolve(extractSoftwareApplicationFields(context)),
	'video-object': (context) => Promise.resolve(extractVideoObjectFields(context)),
	'social-media-account': (context) => Promise.resolve(extractSocialMediaAccountFields(context)),
	'ethereum-account': (context) => Promise.resolve(extractEthereumAccountFields(context)),
	'ethereum-smart-contract': (context) => Promise.resolve(extractEthereumContractFields(context)),
	'ethereum-erc20': (context) => Promise.resolve(extractEthereumErc20Fields(context)),
};

// ── Generic metadata tier: name / description / url / sameAs ────────────────

// Knowledge-graph tier: wikidata/wikipedia derived name and description.
// Outranks the page's own JSON-LD — registry knowledge is curated.
function extractKnowledgeFields(context: ExtractionContext): ExtractedField[] {
	const wikidata = findArtifactData(context.artifacts, 'wikidata', parseWikidata);
	const wikipedia = findArtifactData(context.artifacts, 'wikipedia', parseWikipedia);
	const fields: ExtractedField[] = [];

	const wikidataUrl = wikidata ? `https://www.wikidata.org/wiki/${wikidata.data.entityId}` : null;

	const name = wikidata?.data.label
		? field(
				'name',
				wikidata.data.label,
				'wikidata',
				CONFIDENCE.wikidataLabel,
				wikidataUrl ?? undefined
			)
		: wikipedia?.data.title
			? field(
					'name',
					wikipedia.data.title,
					'wikipedia',
					CONFIDENCE.wikipedia,
					wikipedia.data.pageUrl
				)
			: null;
	if (name) fields.push(name);

	const description = readString(wikidata?.data.description)
		? field(
				'description',
				readString(wikidata?.data.description),
				'wikidata',
				CONFIDENCE.wikidataLabel,
				wikidataUrl ?? undefined
			)
		: readString(wikipedia?.data.extract)
			? field(
					'description',
					truncateAtSentence(wikipedia?.data.extract ?? '', DESCRIPTION_MAX_LENGTH),
					'wikipedia',
					CONFIDENCE.wikipedia,
					wikipedia?.data.pageUrl
				)
			: null;
	if (description) fields.push(description);

	return fields;
}

// Metadata tier: page OG fallbacks plus input-derived url/sameAs. Lowest rank.
function extractGenericFields(context: ExtractionContext): ExtractedField[] {
	const wikidata = findArtifactData(context.artifacts, 'wikidata', parseWikidata);
	const wikipedia = findArtifactData(context.artifacts, 'wikipedia', parseWikipedia);
	const opengraph = findArtifactData(context.artifacts, 'opengraph', parseOpengraph);
	const fields: ExtractedField[] = [];

	const wikidataUrl = wikidata ? `https://www.wikidata.org/wiki/${wikidata.data.entityId}` : null;

	const name = readString(opengraph?.data.title);
	if (name) {
		fields.push(field('name', name, 'opengraph', CONFIDENCE.opengraph, opengraph?.sourceUrl));
	}

	const description = readString(opengraph?.data.description);
	if (description) {
		fields.push(
			field('description', description, 'opengraph', CONFIDENCE.opengraph, opengraph?.sourceUrl)
		);
	}

	fields.push(field('url', context.url, 'input-url', CONFIDENCE.inputUrl));

	const sameAs = [
		...new Set(
			[context.url, wikipedia?.data.pageUrl, wikidataUrl].filter(
				(value): value is string => typeof value === 'string' && value.length > 0
			)
		),
	];
	fields.push(field('sameAs', sameAs, 'input-url', CONFIDENCE.inputUrl));

	return fields;
}

// ── Merge ────────────────────────────────────────────────────────────────────

function coerceValueForFieldType(fieldType: string, value: unknown): unknown {
	if (fieldType === 'string' && typeof value === 'number' && Number.isFinite(value)) {
		return String(value);
	}
	if (fieldType === 'string[]' && typeof value === 'string' && value.trim().length > 0) {
		return [value.trim()];
	}
	return value;
}

export async function extractClassificationFields(
	input: ExtractClassificationFieldsInput
): Promise<FieldExtractionResult> {
	const spec = getClassification(input.classification);
	if (!spec) {
		throw new Error(`Unknown classification "${input.classification}".`);
	}

	const context: ExtractionContext = {
		spec,
		url: input.url,
		artifacts: input.artifacts,
		fetcher: input.fetcher ?? (globalThis.fetch as FetchLike),
		language: input.language ?? 'en',
		...(input.signal ? { signal: input.signal } : {}),
	};

	const specificExtractor = CLASSIFICATION_EXTRACTORS[spec.slug];
	const specificFields = specificExtractor ? await specificExtractor(context) : [];
	// Tier order: provider extractors > knowledge graph (wikidata/wikipedia)
	// > the page's own schema.org JSON-LD > page metadata fallbacks.
	const knowledgeFields = extractKnowledgeFields(context);
	const pageNativeFields = extractPageNativeFields(context);
	const genericFields = extractGenericFields(context);

	// Classification-specific extractors win over the generic metadata tier;
	// within a tier the first extracted value for a key wins.
	const fieldByKey = new Map<string, ExtractedField>();
	const specFieldTypes = new Map(spec.fields.map((specField) => [specField.key, specField]));
	const droppedFields: FieldExtractionResult['droppedFields'] = [];

	for (const candidate of [
		...specificFields,
		...knowledgeFields,
		...pageNativeFields,
		...genericFields,
	]) {
		const specField = specFieldTypes.get(candidate.key);
		if (!specField) {
			continue;
		}
		if (fieldByKey.has(candidate.key)) {
			continue;
		}

		const value = coerceValueForFieldType(specField.fieldType, candidate.value);
		const issues = validateClassificationValues(spec.slug, { [candidate.key]: value }).filter(
			(issue) => issue.field === candidate.key && !issue.message.startsWith('Missing required')
		);
		if (issues.length > 0) {
			droppedFields.push({
				key: candidate.key,
				source: candidate.source,
				reason: issues[0]?.message ?? 'Invalid value.',
			});
			continue;
		}

		fieldByKey.set(candidate.key, { ...candidate, value });
	}

	const values = Object.fromEntries(
		[...fieldByKey.values()].map((entry) => [entry.key, entry.value])
	);
	const missingRequired = spec.fields
		.filter((specField) => specField.required && !(specField.key in values))
		.map((specField) => specField.key);

	return {
		classification: spec.slug,
		values,
		fields: Object.fromEntries(fieldByKey),
		missingRequired,
		droppedFields,
	};
}
