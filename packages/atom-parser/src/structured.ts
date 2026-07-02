import type {
	JsonTopLevelType,
	StructuredDocumentCandidate,
	StructuredDocumentSource,
	StructuredDocumentUrlCandidate,
} from './types.ts';

const URL_CANDIDATE_FIELDS = [
	'url',
	'contentUrl',
	'homepage',
	'externalUrl',
	'downloadUrl',
	'codeRepository',
	'logoUrl',
	'iconUrl',
	'image',
	'imageUrl',
	'audio',
	'audioUrl',
] as const;

export function analyzeStructuredDocument(
	value: unknown,
	source: StructuredDocumentSource
): StructuredDocumentCandidate | undefined {
	if (Array.isArray(value)) {
		return {
			source,
			format: 'json',
			topLevelType: 'array',
			context: undefined,
			schemaType: undefined,
			urlCandidates: [],
			data: undefined,
		};
	}

	if (!value || typeof value !== 'object') {
		return undefined;
	}

	const data = value as Record<string, unknown>;
	const context = toStringMaybe(data['@context']);
	const schemaType = readSchemaType(data['@type']);
	const urlCandidates = collectUrlCandidates(data);

	return {
		source,
		format: context ? 'jsonld' : 'json',
		topLevelType: 'object' satisfies JsonTopLevelType,
		context,
		schemaType,
		urlCandidates,
		data,
	};
}

function readSchemaType(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim().length > 0) {
		return value.trim();
	}

	if (Array.isArray(value)) {
		const first = value.find(
			(entry): entry is string => typeof entry === 'string' && entry.trim().length > 0
		);
		return first?.trim();
	}

	return undefined;
}

function collectUrlCandidates(data: Record<string, unknown>): StructuredDocumentUrlCandidate[] {
	const candidates: StructuredDocumentUrlCandidate[] = [];
	const seen = new Set<string>();

	for (const field of URL_CANDIDATE_FIELDS) {
		const value = data[field];
		const url = toHttpUrl(value);
		if (url && !seen.has(url)) {
			candidates.push({ field, url });
			seen.add(url);
		}
	}

	for (const entry of toStringArray(data.sameAs)) {
		const url = toHttpUrl(entry);
		if (url && !seen.has(url)) {
			candidates.push({ field: 'sameAs', url });
			seen.add(url);
		}
	}

	return candidates;
}

function toStringMaybe(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) {
		return [];
	}

	return value.filter((entry): entry is string => typeof entry === 'string');
}

function toHttpUrl(value: unknown): string | undefined {
	if (typeof value !== 'string') {
		return undefined;
	}

	try {
		const parsed = new URL(value.trim());
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return undefined;
		}
		return parsed.href;
	} catch {
		return undefined;
	}
}
