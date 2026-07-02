import { analyzeStructuredDocument } from './structured.ts';
import type {
	ParseResult,
	ParseWarning,
	RemoteContentKind,
	RemoteInspection,
	ResolvedFetchPolicy,
	StructuredDocumentCandidate,
} from './types.ts';

export async function inspectRemote(
	result: ParseResult,
	policy: ResolvedFetchPolicy
): Promise<
	| {
			inspection: RemoteInspection;
			warnings: ParseWarning[];
			structuredDocument?: StructuredDocumentCandidate;
	  }
	| undefined
> {
	const target = resolveRemoteTarget(result, policy);
	if (!target) return undefined;

	if ('warning' in target) {
		return {
			inspection: {
				attempted: false,
				outcome: 'skipped',
				finalUrl: undefined,
				statusCode: undefined,
				contentType: undefined,
				contentLength: undefined,
				redirectCount: 0,
				subtype: undefined,
				reason: target.warning.message,
			},
			warnings: [target.warning],
		};
	}

	try {
		return await fetchWithRedirects(
			target.url,
			target.timeoutMs,
			policy,
			result.kind === 'ipfs' ? 'resolved_ipfs' : 'resolved_url'
		);
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		if (isDeniedError(message)) {
			return {
				inspection: {
					attempted: true,
					outcome: 'denied',
					finalUrl: undefined,
					statusCode: undefined,
					contentType: undefined,
					contentLength: undefined,
					redirectCount: 0,
					subtype: undefined,
					reason: message,
				},
				warnings: [{ code: 'REMOTE_FETCH_DENIED', message }],
			};
		}
		throw err;
	}
}

type RemoteTarget = { url: string; timeoutMs: number } | { warning: ParseWarning };

function resolveRemoteTarget(
	result: ParseResult,
	policy: ResolvedFetchPolicy
): RemoteTarget | undefined {
	switch (result.kind) {
		case 'url':
			return { url: result.canonicalUrl, timeoutMs: policy.requestTimeoutMs };
		case 'ipfs': {
			const gatewayUrl = result.gatewayUrl;
			if (!gatewayUrl) {
				return {
					warning: {
						code: 'REMOTE_FETCH_SKIPPED_NO_IPFS_GATEWAY',
						message: 'remote inspection skipped because no IPFS gateway is configured',
					},
				};
			}
			return { url: gatewayUrl, timeoutMs: policy.ipfsRequestTimeoutMs };
		}
		default:
			return undefined;
	}
}

function isDeniedError(message: string): boolean {
	return (
		(message.includes('scheme') && message.includes('not allowed')) ||
		message.includes('denied IP') ||
		message.includes('localhost') ||
		message.includes('missing a host')
	);
}

async function fetchWithRedirects(
	initialUrl: string,
	timeoutMs: number,
	policy: ResolvedFetchPolicy,
	source: 'resolved_url' | 'resolved_ipfs'
): Promise<{
	inspection: RemoteInspection;
	warnings: ParseWarning[];
	structuredDocument?: StructuredDocumentCandidate;
}> {
	let currentUrl = initialUrl;
	let redirectCount = 0;

	while (true) {
		validateTarget(currentUrl, policy);

		let response: Response;
		try {
			const controller = new AbortController();
			const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
			response = await fetch(currentUrl, {
				redirect: 'manual',
				signal: controller.signal,
			});
			clearTimeout(timeoutId);
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			if ((err instanceof DOMException && err.name === 'AbortError') || message.includes('abort')) {
				return {
					inspection: {
						attempted: true,
						outcome: 'timeout',
						finalUrl: currentUrl,
						statusCode: undefined,
						contentType: undefined,
						contentLength: undefined,
						redirectCount,
						subtype: undefined,
						reason: 'remote request timed out',
					},
					warnings: [
						{
							code: 'REMOTE_FETCH_TIMEOUT',
							message: `remote inspection timed out for ${currentUrl}`,
						},
					],
				};
			}
			return {
				inspection: {
					attempted: true,
					outcome: 'error',
					finalUrl: currentUrl,
					statusCode: undefined,
					contentType: undefined,
					contentLength: undefined,
					redirectCount,
					subtype: undefined,
					reason: message,
				},
				warnings: [
					{
						code: 'REMOTE_FETCH_ERROR',
						message: `remote inspection failed for ${currentUrl}: ${message}`,
					},
				],
			};
		}

		if (response.status >= 300 && response.status < 400) {
			if (redirectCount >= policy.maxRedirects) {
				return {
					inspection: {
						attempted: true,
						outcome: 'redirect_limit_exceeded',
						finalUrl: currentUrl,
						statusCode: response.status,
						contentType: undefined,
						contentLength: undefined,
						redirectCount,
						subtype: undefined,
						reason: 'redirect limit exceeded',
					},
					warnings: [
						{
							code: 'REMOTE_FETCH_REDIRECT_LIMIT',
							message: `remote inspection exceeded the redirect limit for ${currentUrl}`,
						},
					],
				};
			}

			const location = response.headers.get('location');
			if (!location) {
				return {
					inspection: {
						attempted: true,
						outcome: 'error',
						finalUrl: currentUrl,
						statusCode: response.status,
						contentType: undefined,
						contentLength: undefined,
						redirectCount,
						subtype: undefined,
						reason: 'redirect response missing Location header',
					},
					warnings: [
						{
							code: 'REMOTE_FETCH_REDIRECT_INVALID',
							message: 'remote inspection received a redirect without a Location header',
						},
					],
				};
			}

			currentUrl = new URL(location, currentUrl).href;
			redirectCount++;
			continue;
		}

		return inspectResponse(currentUrl, redirectCount, response, policy, source);
	}
}

function validateTarget(url: string, policy: ResolvedFetchPolicy): void {
	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		throw new Error(`remote fetch target is missing a host`);
	}

	const scheme = parsed.protocol.replace(/:$/, '');
	if (scheme === 'https') {
		// allowed
	} else if (scheme === 'http' && policy.allowHttp) {
		// allowed
	} else {
		throw new Error(`remote fetch scheme ${scheme} is not allowed`);
	}

	if (policy.allowPrivateNetworks) return;

	const hostname = parsed.hostname;
	if (!hostname) {
		throw new Error('remote fetch target is missing a host');
	}

	if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
		throw new Error('remote fetch target resolves to localhost');
	}

	if (isDeniedHostname(hostname)) {
		throw new Error(`remote fetch target resolves to a denied IP address: ${hostname}`);
	}
}

function isDeniedHostname(hostname: string): boolean {
	const parts = hostname.split('.').map(Number);
	if (parts.length === 4 && parts.every((p) => !Number.isNaN(p) && p >= 0 && p <= 255)) {
		const [a, b, c, d] = parts as [number, number, number, number];
		if (a === 10) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 127) return true;
		if (a === 0) return true;
		if (a === 100 && b >= 64 && b <= 127) return true;
		if (a === 169 && b === 254) return true;
	}
	return false;
}

async function inspectResponse(
	finalUrl: string,
	redirectCount: number,
	response: Response,
	policy: ResolvedFetchPolicy,
	source: 'resolved_url' | 'resolved_ipfs'
): Promise<{
	inspection: RemoteInspection;
	warnings: ParseWarning[];
	structuredDocument?: StructuredDocumentCandidate;
}> {
	const statusCode = response.status;
	const contentType = response.headers.get('content-type') ?? undefined;
	const contentLengthHeader = response.headers.get('content-length');
	const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : undefined;

	if (contentLength !== undefined && contentLength > policy.maxResponseBytes) {
		return {
			inspection: {
				attempted: true,
				outcome: 'oversized',
				finalUrl,
				statusCode,
				contentType,
				contentLength,
				redirectCount,
				subtype: undefined,
				reason: 'response exceeded the configured byte limit',
			},
			warnings: [
				{
					code: 'REMOTE_FETCH_OVERSIZED',
					message: `remote inspection skipped body analysis for ${finalUrl} because the response is too large`,
				},
			],
		};
	}

	let inspectedBytes: Uint8Array;
	let fullBody: Uint8Array;
	try {
		({ inspectedBytes, fullBody } = await readBodyLimited(
			response,
			policy.maxResponseBytes,
			policy.inspectBytes
		));
	} catch (err) {
		if (err instanceof OversizedError) {
			return {
				inspection: {
					attempted: true,
					outcome: 'oversized',
					finalUrl,
					statusCode,
					contentType,
					contentLength,
					redirectCount,
					subtype: undefined,
					reason: 'response exceeded the configured byte limit',
				},
				warnings: [
					{
						code: 'REMOTE_FETCH_OVERSIZED',
						message: `remote inspection skipped body analysis for ${finalUrl} because the response is too large`,
					},
				],
			};
		}
		throw err;
	}

	const subtype = classifyRemoteKind(contentType, inspectedBytes);
	const structuredDocument =
		subtype === 'json_document' ? analyzeRemoteStructuredDocument(fullBody, source) : undefined;
	return {
		inspection: {
			attempted: true,
			outcome: 'success',
			finalUrl,
			statusCode,
			contentType,
			contentLength,
			redirectCount,
			subtype,
			reason: `classified remote content as ${subtype}`,
		},
		warnings: [],
		structuredDocument,
	};
}

class OversizedError extends Error {
	constructor() {
		super('oversized');
	}
}

async function readBodyLimited(
	response: Response,
	maxBytes: number,
	inspectBytes: number
): Promise<{ inspectedBytes: Uint8Array; fullBody: Uint8Array }> {
	if (!response.body) {
		return {
			inspectedBytes: new Uint8Array(0),
			fullBody: new Uint8Array(0),
		};
	}

	const reader = response.body.getReader();
	const inspectedChunks: Uint8Array[] = [];
	const allChunks: Uint8Array[] = [];
	let totalBytes = 0;
	let inspectedLength = 0;

	while (true) {
		const { done, value } = await reader.read();
		if (done || !value) break;

		totalBytes += value.length;
		if (totalBytes > maxBytes) {
			reader.cancel();
			throw new OversizedError();
		}

		allChunks.push(value);

		if (inspectedLength < inspectBytes) {
			const remaining = inspectBytes - inspectedLength;
			inspectedChunks.push(value.slice(0, remaining));
			inspectedLength += Math.min(value.length, remaining);
		}
	}

	const inspectedBytes = new Uint8Array(inspectedLength);
	let offset = 0;
	for (const chunk of inspectedChunks) {
		inspectedBytes.set(chunk, offset);
		offset += chunk.length;
	}

	const fullBody = new Uint8Array(totalBytes);
	offset = 0;
	for (const chunk of allChunks) {
		fullBody.set(chunk, offset);
		offset += chunk.length;
	}

	return { inspectedBytes, fullBody };
}

export function classifyRemoteKind(
	contentType: string | undefined,
	inspected: Uint8Array
): RemoteContentKind {
	if (contentType) {
		const lowered = contentType.toLowerCase();
		if (lowered.startsWith('text/html')) return 'webpage';
		if (
			lowered.startsWith('application/json') ||
			lowered.includes('+json') ||
			lowered.endsWith('/json')
		) {
			return 'json_document';
		}
		if (lowered.startsWith('image/')) return 'image';
		if (lowered.startsWith('video/')) return 'video';
		if (lowered.startsWith('audio/')) return 'audio';
		if (lowered.startsWith('text/plain') || lowered === 'application/octet-stream') {
			return sniffBody(inspected);
		}
		return 'generic_file';
	}

	return sniffBody(inspected);
}

function sniffBody(inspected: Uint8Array): RemoteContentKind {
	const text = new TextDecoder('utf-8', { fatal: false }).decode(inspected);
	const trimmed = text.trimStart().toLowerCase();
	if (trimmed.startsWith('<!doctype html') || trimmed.startsWith('<html')) {
		return 'webpage';
	}

	try {
		const value = JSON.parse(text);
		if (Array.isArray(value) || (value !== null && typeof value === 'object')) {
			return 'json_document';
		}
	} catch {
		// not json
	}

	if (startsWith(inspected, [0x89, 0x50, 0x4e, 0x47])) return 'image'; // PNG
	if (startsWith(inspected, [0xff, 0xd8, 0xff])) return 'image'; // JPEG
	if (startsWith(inspected, [0x47, 0x49, 0x46, 0x38])) return 'image'; // GIF8

	if (startsWith(inspected, [0x52, 0x49, 0x46, 0x46])) return 'audio'; // RIFF
	if (startsWith(inspected, [0x49, 0x44, 0x33])) return 'audio'; // ID3

	if (containsBytes(inspected, [0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d])) {
		return 'video'; // ftypisom
	}

	if (inspected.length === 0) return 'unknown_remote';
	return 'generic_file';
}

function startsWith(data: Uint8Array, prefix: number[]): boolean {
	if (data.length < prefix.length) return false;
	for (let i = 0; i < prefix.length; i++) {
		if (data[i] !== prefix[i]) return false;
	}
	return true;
}

function containsBytes(data: Uint8Array, needle: number[]): boolean {
	if (data.length < needle.length) return false;
	outer: for (let i = 0; i <= data.length - needle.length; i++) {
		for (let j = 0; j < needle.length; j++) {
			if (data[i + j] !== needle[j]) continue outer;
		}
		return true;
	}
	return false;
}

function analyzeRemoteStructuredDocument(
	body: Uint8Array,
	source: 'resolved_url' | 'resolved_ipfs'
): StructuredDocumentCandidate | undefined {
	try {
		const text = new TextDecoder('utf-8', { fatal: false }).decode(body);
		const parsed = JSON.parse(text);
		return analyzeStructuredDocument(parsed, source);
	} catch {
		return undefined;
	}
}
