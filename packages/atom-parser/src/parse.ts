import { detectLocal } from './detect.ts';
import { inspectRemote } from './remote.ts';
import {
	DEFAULT_FETCH_POLICY,
	DEFAULT_MAX_INPUT_BYTES,
	ParseError,
	type ParseOptions,
	type ParseResult,
	type ResolvedFetchPolicy,
} from './types.ts';

export async function parseAtom(input: string, options?: ParseOptions): Promise<ParseResult> {
	const maxInputBytes = options?.maxInputBytes ?? DEFAULT_MAX_INPUT_BYTES;

	if (input.trim().length === 0) {
		throw new ParseError('EMPTY_INPUT', 'input must not be empty');
	}

	if (input.length > maxInputBytes) {
		throw new ParseError(
			'INPUT_TOO_LARGE',
			`input exceeds the configured size limit (${input.length} > ${maxInputBytes})`
		);
	}

	const normalizedInput = input.trim();
	const ipfsGatewayBaseUrl = options?.ipfsGatewayBaseUrl;
	const result = detectLocal(input, normalizedInput, ipfsGatewayBaseUrl);

	const remoteFetch = options?.remoteFetch !== false;

	if (remoteFetch) {
		const policy = resolveFetchPolicy(options ?? {});
		const remoteResult = await inspectRemote(result, policy);
		if (remoteResult) {
			if (result.kind === 'url' || result.kind === 'ipfs') {
				result.remote = remoteResult.inspection;
				result.subtype = remoteResult.inspection.subtype;
				result.structuredDocument = remoteResult.structuredDocument;
			}
			result.warnings.push(...remoteResult.warnings);
		}
	}

	return result;
}

function resolveFetchPolicy(options: ParseOptions): ResolvedFetchPolicy {
	return {
		allowHttp: options.allowHttp ?? DEFAULT_FETCH_POLICY.allowHttp,
		allowPrivateNetworks: options.allowPrivateNetworks ?? DEFAULT_FETCH_POLICY.allowPrivateNetworks,
		maxRedirects: options.maxRedirects ?? DEFAULT_FETCH_POLICY.maxRedirects,
		connectTimeoutMs: options.connectTimeoutMs ?? DEFAULT_FETCH_POLICY.connectTimeoutMs,
		requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_FETCH_POLICY.requestTimeoutMs,
		ipfsRequestTimeoutMs: options.ipfsRequestTimeoutMs ?? DEFAULT_FETCH_POLICY.ipfsRequestTimeoutMs,
		maxResponseBytes: options.maxResponseBytes ?? DEFAULT_FETCH_POLICY.maxResponseBytes,
		inspectBytes: options.inspectBytes ?? DEFAULT_FETCH_POLICY.inspectBytes,
	};
}
