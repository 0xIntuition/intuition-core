import type { ParseResult } from '@0xintuition/atom-parser/types';
import type { NormalizedAtomIdentity, SemanticContractProvenance } from './identity-contract';

export type CompactParseResult = {
	// IID is a Core persistence kind produced only by the public inspection
	// adapter; the legacy atom parser remains limited to ParseResult['kind'].
	kind: ParseResult['kind'] | 'iid';
	normalizedInput: string;
	canonicalId?: string;
	identity?: NormalizedAtomIdentity;
	iidFallback?: {
		reason: 'malformed' | 'unknown-scheme' | 'noncanonical';
		provenance: SemanticContractProvenance;
	};
	remote?: {
		finalUrl?: string;
		contentType?: string;
		subtype?: string;
	};
	structuredDocument?: {
		source: string;
		format: string;
		topLevelType: string;
		context?: unknown;
		schemaType?: string;
		urlCandidates: Array<{ url: string; field?: string }>;
		data: unknown;
	};
	identifiers?: Record<string, unknown>;
	hints?: Record<string, unknown>;
};

export function toCompactParseResult(result: ParseResult): CompactParseResult {
	if (result.kind === 'url') {
		return {
			kind: result.kind,
			normalizedInput: result.normalizedInput,
			canonicalId: result.canonicalUrl,
			remote: result.remote
				? {
						finalUrl: result.remote.finalUrl,
						contentType: result.remote.contentType,
						subtype: result.remote.subtype,
					}
				: undefined,
			structuredDocument: result.structuredDocument
				? {
						source: result.structuredDocument.source,
						format: result.structuredDocument.format,
						topLevelType: result.structuredDocument.topLevelType,
						context: result.structuredDocument.context,
						schemaType: result.structuredDocument.schemaType,
						urlCandidates: result.structuredDocument.urlCandidates,
						data: result.structuredDocument.data,
					}
				: undefined,
			hints: {
				host: result.host,
				path: result.path,
				scheme: result.scheme,
			},
		};
	}

	if (result.kind === 'ipfs') {
		return {
			kind: result.kind,
			normalizedInput: result.normalizedInput,
			canonicalId: result.canonicalUri,
			identifiers: {
				cid: result.cid,
				...(result.path ? { path: result.path } : {}),
			},
			remote: result.remote
				? {
						finalUrl: result.remote.finalUrl,
						contentType: result.remote.contentType,
						subtype: result.remote.subtype,
					}
				: undefined,
			structuredDocument: result.structuredDocument
				? {
						source: result.structuredDocument.source,
						format: result.structuredDocument.format,
						topLevelType: result.structuredDocument.topLevelType,
						context: result.structuredDocument.context,
						schemaType: result.structuredDocument.schemaType,
						urlCandidates: result.structuredDocument.urlCandidates,
						data: result.structuredDocument.data,
					}
				: undefined,
			hints: {
				gatewayUrl: result.gatewayUrl,
			},
		};
	}

	if (result.kind === 'ethereum_address') {
		return {
			kind: result.kind,
			normalizedInput: result.normalizedInput,
			canonicalId: result.checksumAddress,
			identifiers: {
				address: result.address,
				checksumAddress: result.checksumAddress,
			},
		};
	}

	if (result.kind === 'ens_name') {
		return {
			kind: result.kind,
			normalizedInput: result.normalizedInput,
			canonicalId: result.name,
			identifiers: {
				name: result.name,
			},
		};
	}

	if (result.kind === 'isbn') {
		return {
			kind: result.kind,
			normalizedInput: result.normalizedInput,
			canonicalId: result.canonical,
			identifiers: {
				isbn: result.canonical,
				format: result.format,
			},
			hints: {
				checksumValid: result.checksumValid,
			},
		};
	}

	if (result.kind === 'json') {
		return {
			kind: result.kind,
			normalizedInput: result.normalizedInput,
			structuredDocument: result.structuredDocument
				? {
						source: result.structuredDocument.source,
						format: result.structuredDocument.format,
						topLevelType: result.structuredDocument.topLevelType,
						context: result.structuredDocument.context,
						schemaType: result.structuredDocument.schemaType,
						urlCandidates: result.structuredDocument.urlCandidates,
						data: result.structuredDocument.data,
					}
				: undefined,
			hints: {
				topLevelType: result.topLevelType,
				objectKeyCount: result.objectKeyCount,
				arrayLength: result.arrayLength,
			},
		};
	}

	return {
		kind: result.kind,
		normalizedInput: result.normalizedInput,
		canonicalId: result.normalizedInput,
		hints: result.kind === 'plain_string' ? { trimmed: result.trimmed } : undefined,
	};
}

/**
 * Builds the parse-stage search projection from understood parser output.
 *
 * A `plain_string` result is authoritative parser output, so retaining its
 * normalized value preserves legacy search behavior. IID payloads require
 * resolved presentation data and are never promoted verbatim. This helper does
 * not inspect prefixes or attempt to recognize IID grammar.
 */
export function resolveParseSearchText(result: CompactParseResult): string {
	if (result.kind === 'iid') {
		return '';
	}

	const structuredData = toRecordMaybe(result.structuredDocument?.data);
	const name = resolveDisplayString(structuredData?.name);
	const description = resolveDisplayString(structuredData?.description);
	const identityCandidates =
		result.kind === 'json' ? [] : [result.canonicalId, result.normalizedInput];

	return Array.from(
		new Set(
			[name, description, ...identityCandidates].filter(
				(value): value is string => typeof value === 'string' && value.trim().length > 0
			)
		)
	)
		.join(' ')
		.slice(0, 20_000);
}

function resolveDisplayString(value: unknown): string | undefined {
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

function toRecordMaybe(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
}
