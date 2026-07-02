import type { ParseResult } from '@0xintuition/atom-parser/types';

export type CompactParseResult = {
	kind: ParseResult['kind'];
	normalizedInput: string;
	canonicalId?: string;
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
