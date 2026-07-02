import { createNonUrlPlugin, type NonUrlV0Profile } from '../shared/non-url';

const ETH_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
const EIP155_ADDRESS_REGEX = /^eip155:(\d+):(0x[a-fA-F0-9]{40})$/i;
const ENS_NAME_REGEX = /^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.eth$/i;
const CONTRACT_PREFIX = 'contract:';
const ACCOUNT_PREFIX = 'account:';
const ERC20_PREFIX = 'erc20:';
const ETHERSCAN_API_BASE_URL = 'https://api.etherscan.io/v2/api';
const ETHERSCAN_PLUGIN_ID = 'etherscan';
const ETHERSCAN_RESOLVER_ID = 'etherscan-resolver';
const DEFAULT_CHAIN_ID = 1;

const EXPLORER_BASE_URL_BY_CHAIN_ID: Record<number, string> = {
	1: 'https://etherscan.io',
	137: 'https://polygonscan.com',
	8453: 'https://basescan.org',
	1155: 'https://explorer.intuition.systems',
	13579: 'https://testnet.explorer.intuition.systems',
};

const ERC20_METHOD_SELECTORS = {
	name: '0x06fdde03',
	symbol: '0x95d89b41',
	decimals: '0x313ce567',
	totalSupply: '0x18160ddd',
} as const;

export const DEFAULT_ETHERSCAN_SCAN_CHAIN_IDS = [1, 8453, 1155, 137] as const;

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type ScanResult = {
	kind: 'smart-contract' | 'erc20';
	chainId: number;
	sourceUrl: string;
	name?: string;
	symbol?: string;
	decimals?: string;
};

type EtherscanProxyPayload = {
	status?: string;
	message?: string;
	result?: unknown;
	error?: unknown;
};

type Erc20Metadata = {
	isErc20: boolean;
	name?: string;
	symbol?: string;
	decimals?: string;
};

export type EtherscanPluginOptions = {
	apiKey?: string;
	chainIds?: number[];
	fetch?: FetchLike;
	apiBaseUrl?: string;
};

export function createEtherscanProfile(options: EtherscanPluginOptions = {}): NonUrlV0Profile {
	const configuredChainIds = normalizeScanChainIds(options.chainIds);
	const apiKey = normalizeString(options.apiKey);
	const fetcher =
		options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch : null);
	const apiBaseUrl = normalizeString(options.apiBaseUrl) ?? ETHERSCAN_API_BASE_URL;

	return {
		id: 'ethereum',
		classifier: {
			id: 'ethereum-identifier-classifier',
			priority: 20,
			classify: (input) => {
				const value = input.trim();
				const normalizedInput = value.toLowerCase();
				const normalizedAddressCandidate = normalizedInput.startsWith('ethereum:')
					? normalizedInput.slice('ethereum:'.length)
					: normalizedInput;
				const { candidate, hintedSubtype } = stripAddressHints(normalizedAddressCandidate);
				const eip155Match = candidate.match(EIP155_ADDRESS_REGEX);

				if (eip155Match?.[1] && eip155Match[2]) {
					const chainId = Number.parseInt(eip155Match[1], 10);
					const address = eip155Match[2].toLowerCase();
					if (Number.isInteger(chainId) && chainId > 0) {
						return {
							type: 'address',
							domain: 'ethereum',
							subtype: hintedSubtype,
							confidence: 0.99,
							meta: {
								address,
								chainId,
								addressFormat: 'hex',
							},
						};
					}
				}

				if (ETH_ADDRESS_REGEX.test(candidate)) {
					return {
						type: 'address',
						domain: 'ethereum',
						subtype: hintedSubtype,
						confidence: 0.99,
						meta: {
							address: candidate,
							addressFormat: 'hex',
						},
					};
				}

				if (ENS_NAME_REGEX.test(value)) {
					const normalized = value.toLowerCase();
					return {
						type: 'address',
						domain: 'ethereum',
						subtype: 'ens-name',
						confidence: 0.94,
						meta: {
							ens: normalized,
							chainId: DEFAULT_CHAIN_ID,
							addressFormat: 'ens',
						},
					};
				}

				return null;
			},
		},
		canResolve: (classification) => classification.domain === 'ethereum',
		resolve: async ({ classification, request, now }) => {
			const addressOrEns =
				(typeof classification.meta.address === 'string' && classification.meta.address) ||
				(typeof classification.meta.ens === 'string' && classification.meta.ens) ||
				request.input.trim();
			const normalizedAddressOrEns = addressOrEns.toLowerCase();
			const preferredChainId = parseChainIdValue(classification.meta.chainId);
			const scanChainIds = buildScanChainOrder(configuredChainIds, preferredChainId);
			const fallbackChainId = scanChainIds[0] ?? DEFAULT_CHAIN_ID;
			const shouldRunNetworkScan =
				request.mode !== 'client-only' &&
				!!apiKey &&
				typeof fetcher === 'function' &&
				normalizedAddressOrEns.startsWith('0x');

			const scanResult = shouldRunNetworkScan
				? await scanAddressAcrossChains({
						address: normalizedAddressOrEns,
						apiKey,
						apiBaseUrl,
						fetcher,
						chainIds: scanChainIds,
					})
				: null;

			const resolvedChainId = scanResult?.chainId ?? preferredChainId ?? fallbackChainId;
			const resolvedChainIdString = String(resolvedChainId);
			const hintedSchemaType =
				classification.subtype === 'erc20'
					? 'EthereumERC20'
					: classification.subtype === 'smart-contract'
						? 'EthereumSmartContract'
						: 'EthereumAccount';
			const schemaType = scanResult
				? scanResult.kind === 'erc20'
					? 'EthereumERC20'
					: 'EthereumSmartContract'
				: hintedSchemaType;
			const sourceUrl = normalizedAddressOrEns.startsWith('0x')
				? (scanResult?.sourceUrl ??
					buildExplorerAddressUrl({
						chainId: resolvedChainId,
						address: normalizedAddressOrEns,
					}))
				: `https://app.ens.domains/${normalizedAddressOrEns}`;
			const canonicalId = normalizedAddressOrEns.startsWith('0x')
				? `eip155:${resolvedChainIdString}:${normalizedAddressOrEns}`
				: `ens:${normalizedAddressOrEns}`;

			return {
				fallbackUsed: true,
				atoms: [
					{
						schemaType,
						category: schemaType === 'EthereumERC20' ? 'product' : 'thing',
						title: `${schemaType} ${normalizedAddressOrEns}`,
						canonicalId,
						sameAs: [sourceUrl],
						data: {
							sameAs: [sourceUrl],
							...(schemaType === 'EthereumAccount'
								? {
										address: normalizedAddressOrEns,
									}
								: {
										chainId: resolvedChainIdString,
										address: normalizedAddressOrEns,
									}),
							...(schemaType === 'EthereumERC20'
								? {
										...(scanResult?.name ? { name: scanResult.name } : {}),
										...(scanResult?.symbol ? { symbol: scanResult.symbol } : {}),
										...(scanResult?.decimals ? { decimals: scanResult.decimals } : {}),
									}
								: {}),
						},
						metadata: {
							pluginId: ETHERSCAN_PLUGIN_ID,
							provider: normalizedAddressOrEns.startsWith('0x') ? 'etherscan' : 'ens',
							fetchedAt: now,
							sourceUrl,
							identifierKind: classification.subtype,
							resolvedChainId: resolvedChainIdString,
							scannedChainIds: scanChainIds,
						},
					},
				],
			};
		},
	};
}

export const etherscanProfile = createEtherscanProfile();
export const ethereumProfile = etherscanProfile;

export function createEtherscanPlugin(options: EtherscanPluginOptions = {}) {
	return createNonUrlPlugin({
		pluginId: ETHERSCAN_PLUGIN_ID,
		resolverId: ETHERSCAN_RESOLVER_ID,
		profile: createEtherscanProfile(options),
	});
}

export function createEthereumPlugin(options: EtherscanPluginOptions = {}) {
	return createEtherscanPlugin(options);
}

async function scanAddressAcrossChains(input: {
	address: string;
	chainIds: number[];
	fetcher: FetchLike;
	apiKey: string;
	apiBaseUrl: string;
}): Promise<ScanResult | null> {
	let firstContractMatch: ScanResult | null = null;

	for (const chainId of input.chainIds) {
		const code = await callProxy(input, {
			chainId,
			action: 'eth_getCode',
			params: {
				address: input.address,
				tag: 'latest',
			},
		});
		if (!hasDeployedCode(code)) {
			continue;
		}

		const sourceUrl = buildExplorerAddressUrl({
			chainId,
			address: input.address,
		});
		const erc20Metadata = await detectErc20Metadata(input, chainId);
		if (erc20Metadata.isErc20) {
			return {
				kind: 'erc20',
				chainId,
				sourceUrl,
				...(erc20Metadata.name ? { name: erc20Metadata.name } : {}),
				...(erc20Metadata.symbol ? { symbol: erc20Metadata.symbol } : {}),
				...(erc20Metadata.decimals ? { decimals: erc20Metadata.decimals } : {}),
			};
		}

		if (!firstContractMatch) {
			firstContractMatch = {
				kind: 'smart-contract',
				chainId,
				sourceUrl,
			};
		}
	}

	return firstContractMatch;
}

async function detectErc20Metadata(
	input: {
		address: string;
		fetcher: FetchLike;
		apiKey: string;
		apiBaseUrl: string;
	},
	chainId: number
): Promise<Erc20Metadata> {
	const [nameHex, symbolHex, decimalsHex, totalSupplyHex] = await Promise.all([
		callProxy(input, {
			chainId,
			action: 'eth_call',
			params: {
				to: input.address,
				data: ERC20_METHOD_SELECTORS.name,
				tag: 'latest',
			},
		}),
		callProxy(input, {
			chainId,
			action: 'eth_call',
			params: {
				to: input.address,
				data: ERC20_METHOD_SELECTORS.symbol,
				tag: 'latest',
			},
		}),
		callProxy(input, {
			chainId,
			action: 'eth_call',
			params: {
				to: input.address,
				data: ERC20_METHOD_SELECTORS.decimals,
				tag: 'latest',
			},
		}),
		callProxy(input, {
			chainId,
			action: 'eth_call',
			params: {
				to: input.address,
				data: ERC20_METHOD_SELECTORS.totalSupply,
				tag: 'latest',
			},
		}),
	]);
	const name = decodeAbiString(nameHex);
	const symbol = decodeAbiString(symbolHex);
	const decimals = decodeAbiInteger(decimalsHex);
	const totalSupply = decodeAbiInteger(totalSupplyHex);
	const hasCoreSignals = totalSupply !== null || decimals !== null;
	const hasIdentitySignals = name !== null || symbol !== null;

	return {
		isErc20: hasCoreSignals && hasIdentitySignals,
		...(name ? { name } : {}),
		...(symbol ? { symbol } : {}),
		...(decimals ? { decimals } : {}),
	};
}

async function callProxy(
	input: {
		fetcher: FetchLike;
		apiKey: string;
		apiBaseUrl: string;
	},
	args: {
		chainId: number;
		action: string;
		params: Record<string, string>;
	}
): Promise<string | null> {
	const query = new URLSearchParams({
		chainid: String(args.chainId),
		module: 'proxy',
		action: args.action,
		...args.params,
		apikey: input.apiKey,
	});

	try {
		const response = await input.fetcher(`${input.apiBaseUrl}?${query.toString()}`);
		if (!response.ok) {
			return null;
		}

		const payload = (await response.json()) as EtherscanProxyPayload;
		if (typeof payload?.status === 'string' && payload.status === '0') {
			return null;
		}

		if (payload?.error) {
			return null;
		}

		return typeof payload?.result === 'string' ? payload.result : null;
	} catch {
		return null;
	}
}

function decodeAbiInteger(value: string | null): string | null {
	const normalized = normalizeHexResult(value);
	if (!normalized) {
		return null;
	}

	try {
		return BigInt(`0x${normalized}`).toString();
	} catch {
		return null;
	}
}

function decodeAbiString(value: string | null): string | null {
	const normalized = normalizeHexResult(value);
	if (!normalized) {
		return null;
	}

	// Standard ABI dynamic string response
	if (normalized.length >= 128) {
		const offset = parseHexNumber(normalized.slice(0, 64));
		if (offset !== null) {
			const lengthStart = offset * 2;
			const length = parseHexNumber(normalized.slice(lengthStart, lengthStart + 64));
			if (length !== null) {
				const valueStart = lengthStart + 64;
				const valueEnd = valueStart + length * 2;
				if (length > 0 && valueEnd <= normalized.length) {
					return decodeUtf8Hex(normalized.slice(valueStart, valueEnd));
				}
			}
		}
	}

	// Some contracts return bytes32 for symbol/name.
	return decodeUtf8Hex(normalized.slice(0, 64));
}

function parseHexNumber(value: string): number | null {
	if (value.length === 0) {
		return null;
	}

	const parsed = Number.parseInt(value, 16);
	if (!Number.isFinite(parsed) || parsed < 0) {
		return null;
	}

	return parsed;
}

function decodeUtf8Hex(value: string): string | null {
	if (value.length === 0 || value.length % 2 !== 0) {
		return null;
	}

	const bytes = new Uint8Array(value.length / 2);
	for (let i = 0; i < value.length; i += 2) {
		const parsed = Number.parseInt(value.slice(i, i + 2), 16);
		if (!Number.isFinite(parsed)) {
			return null;
		}

		bytes[i / 2] = parsed;
	}

	let end = bytes.length;
	while (end > 0 && bytes[end - 1] === 0) {
		end -= 1;
	}

	const decoded = new TextDecoder().decode(bytes.slice(0, end)).trim();
	return decoded.length > 0 ? decoded : null;
}

function normalizeHexResult(value: string | null): string | null {
	if (!value || !value.startsWith('0x')) {
		return null;
	}

	const normalized = value.slice(2);
	return normalized.length > 0 ? normalized : null;
}

function hasDeployedCode(value: string | null): boolean {
	if (!value || !value.startsWith('0x')) {
		return false;
	}

	return value.slice(2).replaceAll('0', '').length > 0;
}

function stripAddressHints(value: string): {
	candidate: string;
	hintedSubtype: 'account' | 'smart-contract' | 'erc20';
} {
	if (value.startsWith(ERC20_PREFIX)) {
		return {
			candidate: value.slice(ERC20_PREFIX.length),
			hintedSubtype: 'erc20',
		};
	}

	if (value.startsWith(CONTRACT_PREFIX)) {
		return {
			candidate: value.slice(CONTRACT_PREFIX.length),
			hintedSubtype: 'smart-contract',
		};
	}

	if (value.startsWith(ACCOUNT_PREFIX)) {
		return {
			candidate: value.slice(ACCOUNT_PREFIX.length),
			hintedSubtype: 'account',
		};
	}

	return {
		candidate: value,
		hintedSubtype: 'account',
	};
}

function normalizeScanChainIds(chainIds: number[] | undefined): number[] {
	const configured = chainIds ?? [...DEFAULT_ETHERSCAN_SCAN_CHAIN_IDS];
	const normalized = configured
		.map((chainId) => (Number.isInteger(chainId) && chainId > 0 ? chainId : null))
		.filter((chainId): chainId is number => chainId !== null);

	return normalized.length > 0
		? Array.from(new Set(normalized))
		: [...DEFAULT_ETHERSCAN_SCAN_CHAIN_IDS];
}

function parseChainIdValue(value: unknown): number | undefined {
	if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
		return value;
	}

	if (typeof value === 'string' && value.trim().length > 0) {
		const parsed = Number.parseInt(value, 10);
		if (Number.isInteger(parsed) && parsed > 0) {
			return parsed;
		}
	}

	return undefined;
}

function buildScanChainOrder(chainIds: number[], preferredChainId: number | undefined): number[] {
	if (!preferredChainId) {
		return chainIds;
	}

	if (chainIds.includes(preferredChainId)) {
		return [preferredChainId, ...chainIds.filter((chainId) => chainId !== preferredChainId)];
	}

	return [preferredChainId, ...chainIds];
}

function buildExplorerAddressUrl(input: { chainId: number; address: string }): string {
	const baseUrl =
		EXPLORER_BASE_URL_BY_CHAIN_ID[input.chainId] ??
		EXPLORER_BASE_URL_BY_CHAIN_ID[DEFAULT_CHAIN_ID] ??
		'https://etherscan.io';
	return `${baseUrl.replace(/\/$/, '')}/address/${input.address.toLowerCase()}`;
}

function normalizeString(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
