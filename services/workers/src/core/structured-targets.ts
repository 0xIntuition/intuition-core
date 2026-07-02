import type { CompactParseResult } from './parse';

export type StructuredTargetSource =
	| 'structured_document'
	| 'structured_document_same_as'
	| 'remote_final_url'
	| 'raw_input';

export type StructuredTarget = {
	url: string | undefined;
	source: StructuredTargetSource | undefined;
};

export function resolveStructuredDocumentTarget(
	structuredDocument: CompactParseResult['structuredDocument'] | undefined
): StructuredTarget {
	const candidate = structuredDocument?.urlCandidates.find((entry) => isHttpUrl(entry.url));
	if (candidate) {
		return {
			url: candidate.url,
			source: candidate.field === 'sameAs' ? 'structured_document_same_as' : 'structured_document',
		};
	}

	const data = toRecordMaybe(structuredDocument?.data);
	const sameAsUrl = resolveFirstHttpUrl(data?.sameAs);
	if (sameAsUrl) {
		return {
			url: sameAsUrl,
			source: 'structured_document_same_as',
		};
	}

	const url = resolveFirstHttpUrl(data?.url);
	if (url) {
		return {
			url,
			source: 'structured_document',
		};
	}

	return { url: undefined, source: undefined };
}

export function resolveFallbackUrl(
	parseResult: CompactParseResult | null,
	rawInput: string | null
): string | undefined {
	if (parseResult?.kind !== 'url') {
		return undefined;
	}
	if (parseResult.remote?.finalUrl && isHttpUrl(parseResult.remote.finalUrl)) {
		return parseResult.remote.finalUrl;
	}
	if (parseResult.canonicalId && isHttpUrl(parseResult.canonicalId)) {
		return parseResult.canonicalId;
	}
	const trimmed = rawInput?.trim();
	return trimmed && isHttpUrl(trimmed) ? trimmed : undefined;
}

export function isHttpUrl(value: string): boolean {
	try {
		const url = new URL(value);
		return url.protocol === 'http:' || url.protocol === 'https:';
	} catch {
		return false;
	}
}

function resolveFirstHttpUrl(value: unknown): string | undefined {
	if (typeof value === 'string') {
		const trimmed = value.trim();
		return trimmed && isHttpUrl(trimmed) ? trimmed : undefined;
	}

	if (!Array.isArray(value)) {
		return undefined;
	}

	for (const entry of value) {
		const url = resolveFirstHttpUrl(entry);
		if (url) {
			return url;
		}
	}

	return undefined;
}

function toRecordMaybe(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
