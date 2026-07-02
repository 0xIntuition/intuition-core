import { CID } from 'multiformats/cid';
import { getAddress, isAddress } from 'viem';
import { analyzeStructuredDocument } from './structured.ts';
import type { IsbnFormat, JsonTopLevelType, ParseResult } from './types.ts';

export function detectLocal(
	input: string,
	normalizedInput: string,
	ipfsGatewayBaseUrl: string | undefined
): ParseResult {
	const base = { input, normalizedInput, warnings: [] as [] };

	const ipfs = tryIpfs(normalizedInput, ipfsGatewayBaseUrl);
	if (ipfs) {
		return {
			...base,
			kind: 'ipfs',
			subtype: undefined,
			remote: undefined,
			structuredDocument: undefined,
			...ipfs,
		};
	}

	const ethAddress = tryEthereumAddress(normalizedInput);
	if (ethAddress) {
		return { ...base, kind: 'ethereum_address', structuredDocument: undefined, ...ethAddress };
	}

	const ensName = tryEnsName(normalizedInput);
	if (ensName) {
		return { ...base, kind: 'ens_name', structuredDocument: undefined, ...ensName };
	}

	const json = tryJson(normalizedInput);
	if (json) {
		return { ...base, kind: 'json', ...json };
	}

	const url = tryUrl(normalizedInput);
	if (url) {
		return {
			...base,
			kind: 'url',
			subtype: undefined,
			remote: undefined,
			structuredDocument: undefined,
			...url,
		};
	}

	const isbn = tryIsbn(normalizedInput);
	if (isbn) {
		return { ...base, kind: 'isbn', structuredDocument: undefined, ...isbn };
	}

	return {
		...base,
		kind: 'plain_string',
		structuredDocument: undefined,
		original: input,
		trimmed: normalizedInput,
	};
}

interface IpfsData {
	canonicalUri: string;
	cid: string;
	path: string | undefined;
	gatewayUrl: string | undefined;
}

function tryIpfs(
	normalizedInput: string,
	ipfsGatewayBaseUrl: string | undefined
): IpfsData | undefined {
	let candidate: string;
	if (normalizedInput.startsWith('ipfs://')) {
		candidate = normalizedInput.slice(7);
	} else if (normalizedInput.startsWith('/ipfs/')) {
		candidate = normalizedInput.slice(6);
	} else {
		return undefined;
	}

	const slashIndex = candidate.indexOf('/');
	let cidCandidate: string;
	let pathPart: string | undefined;
	if (slashIndex >= 0) {
		cidCandidate = candidate.slice(0, slashIndex);
		pathPart = candidate.slice(slashIndex + 1);
	} else {
		cidCandidate = candidate;
		pathPart = undefined;
	}

	let parsedCid: CID;
	try {
		parsedCid = CID.parse(cidCandidate);
	} catch {
		return undefined;
	}

	const cid = parsedCid.toString();
	const trimmedPath = pathPart?.replace(/^\/+|\/+$/g, '');
	const path = trimmedPath && trimmedPath.length > 0 ? trimmedPath : undefined;
	const canonicalUri = path ? `ipfs://${cid}/${path}` : `ipfs://${cid}`;
	const gatewayUrl = buildGatewayUrl(ipfsGatewayBaseUrl, cid, path);

	return { canonicalUri, cid, path, gatewayUrl };
}

function buildGatewayUrl(
	baseUrl: string | undefined,
	cid: string,
	path: string | undefined
): string | undefined {
	if (!baseUrl) return undefined;
	const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
	const ipfsPath = path ? `ipfs/${cid}/${path}` : `ipfs/${cid}`;
	return `${base}${ipfsPath}`;
}

interface EthereumAddressData {
	address: string;
	checksumAddress: string;
}

function tryEthereumAddress(normalizedInput: string): EthereumAddressData | undefined {
	if (!/^0x[0-9a-fA-F]{40}$/.test(normalizedInput)) return undefined;

	if (!isAddress(normalizedInput, { strict: false })) return undefined;

	const checksumAddress = getAddress(normalizedInput);
	return { address: normalizedInput, checksumAddress };
}

interface EnsNameData {
	name: string;
}

function tryEnsName(normalizedInput: string): EnsNameData | undefined {
	if (!normalizedInput.toLowerCase().endsWith('.eth')) return undefined;
	const name = normalizedInput.toLowerCase();
	const label = name.slice(0, -4);
	if (label.length === 0) return undefined;
	if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/.test(label)) {
		return undefined;
	}
	return { name };
}

interface JsonData {
	topLevelType: JsonTopLevelType;
	objectKeyCount: number | undefined;
	arrayLength: number | undefined;
	structuredDocument: ReturnType<typeof analyzeStructuredDocument>;
}

function tryJson(normalizedInput: string): JsonData | undefined {
	let parsed: unknown;
	try {
		parsed = JSON.parse(normalizedInput);
	} catch {
		return undefined;
	}

	if (Array.isArray(parsed)) {
		return {
			topLevelType: 'array',
			objectKeyCount: undefined,
			arrayLength: parsed.length,
			structuredDocument: analyzeStructuredDocument(parsed, 'inline_json'),
		};
	}

	if (parsed !== null && typeof parsed === 'object') {
		return {
			topLevelType: 'object',
			objectKeyCount: Object.keys(parsed as Record<string, unknown>).length,
			arrayLength: undefined,
			structuredDocument: analyzeStructuredDocument(parsed, 'inline_json'),
		};
	}

	return undefined;
}

interface UrlData {
	canonicalUrl: string;
	scheme: string;
	host: string | undefined;
	path: string;
	hasQuery: boolean;
}

function tryUrl(normalizedInput: string): UrlData | undefined {
	let parsed: URL;
	try {
		parsed = new URL(normalizedInput);
	} catch {
		return undefined;
	}

	return {
		canonicalUrl: parsed.href,
		scheme: parsed.protocol.replace(/:$/, ''),
		host: parsed.hostname || undefined,
		path: parsed.pathname || '/',
		hasQuery: parsed.search.length > 0,
	};
}

interface IsbnData {
	canonical: string;
	format: IsbnFormat;
	checksumValid: boolean;
}

function tryIsbn(normalizedInput: string): IsbnData | undefined {
	const candidate = normalizedInput.replace(/[-\s]/g, '');

	if (candidate.length === 10 && isbn10ChecksumValid(candidate)) {
		return { canonical: candidate, format: 'isbn10', checksumValid: true };
	}

	if (candidate.length === 13 && /^\d{13}$/.test(candidate) && isbn13ChecksumValid(candidate)) {
		return { canonical: candidate, format: 'isbn13', checksumValid: true };
	}

	return undefined;
}

function isbn10ChecksumValid(candidate: string): boolean {
	let total = 0;
	for (let i = 0; i < 10; i++) {
		const ch = candidate[i];
		let value: number;
		if (i === 9 && (ch === 'X' || ch === 'x')) {
			value = 10;
		} else if (ch !== undefined && ch >= '0' && ch <= '9') {
			value = Number.parseInt(ch, 10);
		} else {
			return false;
		}
		total += (10 - i) * value;
	}
	return total % 11 === 0;
}

function isbn13ChecksumValid(candidate: string): boolean {
	let total = 0;
	for (let i = 0; i < 13; i++) {
		const digit = Number.parseInt(candidate[i]!, 10);
		total += i % 2 === 0 ? digit : digit * 3;
	}
	return total % 10 === 0;
}
