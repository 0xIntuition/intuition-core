// Declarative wikidata-claim → classification-field mappings. Adding URL-first
// support for a new wikidata-backed classification is a table entry here, not
// new extractor code. Property ids referenced below were verified against
// live entities (see .planning/backlog/url-first-item-creation/
// classification-parity-spec.md).

export type WikidataClaimFieldKind = 'entity-label' | 'string' | 'time' | 'quantity';

export type WikidataClaimFieldMapping = {
	/** Classification spec field key the claim value fills. */
	field: string;
	/** Wikidata property id, e.g. P856. */
	property: string;
	kind: WikidataClaimFieldKind;
};

export type WikidataSameAsTemplate = {
	/** Wikidata property id holding an external id (string claim). */
	property: string;
	/** URL template; `{value}` is replaced with the claim value. */
	template: string;
};

export type WikidataClassificationMap = {
	fields: WikidataClaimFieldMapping[];
	sameAsTemplates?: WikidataSameAsTemplate[];
};

const COMPANY_SAME_AS_TEMPLATES: WikidataSameAsTemplate[] = [
	{ property: 'P2002', template: 'https://x.com/{value}' },
	{ property: 'P4264', template: 'https://www.linkedin.com/company/{value}' },
];

export const WIKIDATA_CLASSIFICATION_MAPS: Record<string, WikidataClassificationMap> = {
	person: {
		fields: [
			{ field: 'givenName', property: 'P735', kind: 'entity-label' },
			{ field: 'familyName', property: 'P734', kind: 'entity-label' },
		],
		sameAsTemplates: [{ property: 'P2002', template: 'https://x.com/{value}' }],
	},
	company: {
		fields: [{ field: 'url', property: 'P856', kind: 'string' }],
		sameAsTemplates: COMPANY_SAME_AS_TEMPLATES,
	},
	brand: {
		fields: [{ field: 'url', property: 'P856', kind: 'string' }],
		sameAsTemplates: COMPANY_SAME_AS_TEMPLATES,
	},
	service: {
		fields: [],
		sameAsTemplates: COMPANY_SAME_AS_TEMPLATES,
	},
	event: {
		fields: [
			{ field: 'startDate', property: 'P580', kind: 'time' },
			{ field: 'location', property: 'P276', kind: 'entity-label' },
		],
	},
	movie: {
		fields: [{ field: 'datePublished', property: 'P577', kind: 'time' }],
		sameAsTemplates: [
			{ property: 'P345', template: 'https://www.imdb.com/title/{value}/' },
			{ property: 'P4947', template: 'https://www.themoviedb.org/movie/{value}' },
		],
	},
	'tv-series': {
		fields: [
			{ field: 'startDate', property: 'P580', kind: 'time' },
			{ field: 'endDate', property: 'P582', kind: 'time' },
		],
		sameAsTemplates: [
			{ property: 'P345', template: 'https://www.imdb.com/title/{value}/' },
			{ property: 'P4983', template: 'https://www.themoviedb.org/tv/{value}' },
		],
	},
	book: {
		fields: [{ field: 'author', property: 'P50', kind: 'entity-label' }],
	},
};
