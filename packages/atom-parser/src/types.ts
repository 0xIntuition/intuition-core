export type ParsedKind =
	| 'ipfs'
	| 'ethereum_address'
	| 'ens_name'
	| 'json'
	| 'url'
	| 'isbn'
	| 'plain_string';

export type JsonTopLevelType = 'object' | 'array';
export type IsbnFormat = 'isbn10' | 'isbn13';
export type StructuredDocumentSource = 'inline_json' | 'resolved_url' | 'resolved_ipfs';

export type RemoteOutcome =
	| 'success'
	| 'skipped'
	| 'denied'
	| 'timeout'
	| 'error'
	| 'oversized'
	| 'redirect_limit_exceeded';

export type RemoteContentKind =
	| 'webpage'
	| 'json_document'
	| 'image'
	| 'video'
	| 'audio'
	| 'generic_file'
	| 'unknown_remote';

export interface ParseWarning {
	code: string;
	message: string;
}

export interface StructuredDocumentUrlCandidate {
	field: string;
	url: string;
}

export interface StructuredDocumentCandidate {
	source: StructuredDocumentSource;
	format: 'json' | 'jsonld';
	topLevelType: JsonTopLevelType;
	context: string | undefined;
	schemaType: string | undefined;
	urlCandidates: StructuredDocumentUrlCandidate[];
	data: Record<string, unknown> | undefined;
}

export interface RemoteInspection {
	attempted: boolean;
	outcome: RemoteOutcome;
	finalUrl: string | undefined;
	statusCode: number | undefined;
	contentType: string | undefined;
	contentLength: number | undefined;
	redirectCount: number;
	subtype: RemoteContentKind | undefined;
	reason: string | undefined;
}

// ── Per-kind result interfaces ──────────────────────────────────

interface ParseResultBase {
	input: string;
	normalizedInput: string;
	warnings: ParseWarning[];
	structuredDocument: StructuredDocumentCandidate | undefined;
}

interface RemoteCapableBase extends ParseResultBase {
	subtype: RemoteContentKind | undefined;
	remote: RemoteInspection | undefined;
}

export interface IpfsParseResult extends RemoteCapableBase {
	kind: 'ipfs';
	canonicalUri: string;
	cid: string;
	path: string | undefined;
	gatewayUrl: string | undefined;
}

export interface UrlParseResult extends RemoteCapableBase {
	kind: 'url';
	canonicalUrl: string;
	scheme: string;
	host: string | undefined;
	path: string;
	hasQuery: boolean;
}

export interface EthereumAddressParseResult extends ParseResultBase {
	kind: 'ethereum_address';
	address: string;
	checksumAddress: string;
}

export interface EnsNameParseResult extends ParseResultBase {
	kind: 'ens_name';
	name: string;
}

export interface JsonParseResult extends ParseResultBase {
	kind: 'json';
	topLevelType: JsonTopLevelType;
	objectKeyCount: number | undefined;
	arrayLength: number | undefined;
}

export interface IsbnParseResult extends ParseResultBase {
	kind: 'isbn';
	canonical: string;
	format: IsbnFormat;
	checksumValid: boolean;
}

export interface PlainStringParseResult extends ParseResultBase {
	kind: 'plain_string';
	original: string;
	trimmed: string;
}

export type ParseResult =
	| IpfsParseResult
	| UrlParseResult
	| EthereumAddressParseResult
	| EnsNameParseResult
	| JsonParseResult
	| IsbnParseResult
	| PlainStringParseResult;

// ── Errors ──────────────────────────────────────────────────────

export type ParseErrorCode =
	| 'EMPTY_INPUT'
	| 'INPUT_TOO_LARGE'
	| 'INVALID_IPFS_GATEWAY'
	| 'INVALID_REQUEST'
	| 'INTERNAL_ERROR';

export class ParseError extends Error {
	code: ParseErrorCode;

	constructor(code: ParseErrorCode, message: string) {
		super(message);
		this.code = code;
		this.name = 'ParseError';
	}
}

// ── Options & policy ────────────────────────────────────────────

export interface ParseOptions {
	remoteFetch?: boolean;
	maxInputBytes?: number;
	allowHttp?: boolean;
	allowPrivateNetworks?: boolean;
	maxRedirects?: number;
	connectTimeoutMs?: number;
	requestTimeoutMs?: number;
	ipfsRequestTimeoutMs?: number;
	maxResponseBytes?: number;
	inspectBytes?: number;
	ipfsGatewayBaseUrl?: string;
}

export interface ResolvedFetchPolicy {
	allowHttp: boolean;
	allowPrivateNetworks: boolean;
	maxRedirects: number;
	connectTimeoutMs: number;
	requestTimeoutMs: number;
	ipfsRequestTimeoutMs: number;
	maxResponseBytes: number;
	inspectBytes: number;
}

export const DEFAULT_FETCH_POLICY: ResolvedFetchPolicy = {
	allowHttp: false,
	allowPrivateNetworks: false,
	maxRedirects: 3,
	connectTimeoutMs: 3_000,
	requestTimeoutMs: 5_000,
	ipfsRequestTimeoutMs: 8_000,
	maxResponseBytes: 1_048_576,
	inspectBytes: 262_144,
};

export const DEFAULT_MAX_INPUT_BYTES = 16_384;
