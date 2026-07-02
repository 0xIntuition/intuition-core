import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getIdentifier, getRequestName, getRequestUrl } from '../__shared__/request';
import {
	etherscanBalanceResponseSchema,
	etherscanContractResponseSchema,
	etherscanTxCountResponseSchema,
} from './external';
import { etherscanDataSchema } from './schema';

type CreateEtherscanPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	apiKey?: string;
	chainId?: string;
};

type EtherscanBalanceResponse = {
	status?: string;
	message?: string;
	result?: string;
};

type EtherscanTxCountResponse = {
	result?: string;
};

type EtherscanContractMetadata = {
	ContractName?: string;
	ABI?: string;
	TokenName?: string;
	TokenSymbol?: string;
};

type EtherscanContractResponse = {
	status?: string;
	message?: string;
	result?: EtherscanContractMetadata[];
};

const ethereumAddressPattern = /^0x[a-fA-F0-9]{40}$/;
const ETHERSCAN_V2_BASE_URL = 'https://api.etherscan.io/v2/api';

export function createEtherscanPlugin(
	options: CreateEtherscanPluginOptions = {}
): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);
	const chainId = options.chainId?.trim() || '1';

	return defineEnrichmentPlugin({
		id: 'etherscan',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['etherscan'],
		priority: options.priority ?? 57,
		TTL: options.TTL ?? 60,

		supports(request: EnrichmentRequest) {
			return !!resolveAddress(request);
		},

		async enrich(request, ctx) {
			const address = resolveAddress(request);
			if (!address) {
				return [];
			}

			const querySuffix = options.apiKey ? `&apikey=${encodeURIComponent(options.apiKey)}` : '';
			const balancePayload = await fetchJsonWithSchema(
				fetcher,
				buildEtherscanV2Url({
					chainId,
					module: 'account',
					action: 'balance',
					address,
					tag: 'latest',
					querySuffix,
				}),
				etherscanBalanceResponseSchema,
				{ signal: ctx.signal }
			);
			const balanceWei =
				typeof balancePayload.result === 'string' && balancePayload.result.length > 0
					? balancePayload.result
					: '0';

			let transactionCount: number | undefined;
			try {
				const txCountPayload = await fetchJsonWithSchema(
					fetcher,
					buildEtherscanV2Url({
						chainId,
						module: 'proxy',
						action: 'eth_getTransactionCount',
						address,
						tag: 'latest',
						querySuffix,
					}),
					etherscanTxCountResponseSchema,
					{ signal: ctx.signal }
				);
				transactionCount = parseTransactionCount(txCountPayload.result);
			} catch {
				transactionCount = undefined;
			}

			let contractMetadata: EtherscanContractMetadata | undefined;
			try {
				const contractPayload = await fetchJsonWithSchema(
					fetcher,
					buildEtherscanV2Url({
						chainId,
						module: 'contract',
						action: 'getsourcecode',
						address,
						querySuffix,
					}),
					etherscanContractResponseSchema,
					{ signal: ctx.signal }
				);
				contractMetadata = contractPayload.result?.[0];
			} catch {
				contractMetadata = undefined;
			}

			const contractName = normalizeString(contractMetadata?.ContractName);
			const tokenName = normalizeString(contractMetadata?.TokenName);
			const tokenSymbol = normalizeString(contractMetadata?.TokenSymbol);
			const isContract =
				!!contractName ||
				(typeof contractMetadata?.ABI === 'string' &&
					contractMetadata.ABI !== 'Contract source code not verified');

			return [
				{
					artifact_type: 'etherscan',
					data: etherscanDataSchema.parse({
						address,
						balance: balanceWei,
						balanceEth: weiToEth(balanceWei),
						transactionCount,
						isContract,
						contractName,
						tokenName,
						tokenSymbol,
					}),
					meta: {
						pluginId: 'etherscan',
						provider: 'etherscan',
						fetchedAt: ctx.now(),
						sourceUrl: `https://etherscan.io/address/${address}`,
					},
				},
			];
		},
	});
}

function buildEtherscanV2Url(input: {
	chainId: string;
	module: string;
	action: string;
	address: string;
	tag?: string;
	querySuffix?: string;
}): string {
	const params = new URLSearchParams({
		chainid: input.chainId,
		module: input.module,
		action: input.action,
		address: input.address,
	});

	if (input.tag) {
		params.set('tag', input.tag);
	}

	const suffix = input.querySuffix ?? '';
	return `${ETHERSCAN_V2_BASE_URL}?${params.toString()}${suffix}`;
}

function resolveAddress(request: EnrichmentRequest): string | undefined {
	const identifier = getIdentifier(request, 'address', 'ethereum', 'eth', 'wallet');
	if (identifier && ethereumAddressPattern.test(identifier)) {
		return identifier;
	}

	const url = getRequestUrl(request);
	if (url) {
		const fromUrl = parseAddressFromEtherscanUrl(url);
		if (fromUrl) {
			return fromUrl;
		}
	}

	const name = getRequestName(request);
	if (name && ethereumAddressPattern.test(name)) {
		return name;
	}

	return undefined;
}

function parseAddressFromEtherscanUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes('etherscan.io')) {
			return undefined;
		}

		const match = parsed.pathname.match(/\/address\/(0x[a-fA-F0-9]{40})/);
		if (!match?.[1]) {
			return undefined;
		}

		return match[1];
	} catch {
		return undefined;
	}
}

function parseTransactionCount(value: string | undefined): number | undefined {
	if (!value || value.length === 0) {
		return undefined;
	}

	if (value.startsWith('0x')) {
		const parsedHex = Number.parseInt(value.slice(2), 16);
		return Number.isFinite(parsedHex) ? parsedHex : undefined;
	}

	const parsedDecimal = Number.parseInt(value, 10);
	return Number.isFinite(parsedDecimal) ? parsedDecimal : undefined;
}

function weiToEth(balanceWei: string): string | undefined {
	try {
		const wei = BigInt(balanceWei);
		const unit = 10n ** 18n;
		const whole = wei / unit;
		const fractional = wei % unit;
		if (fractional === 0n) {
			return whole.toString();
		}

		const fractionalValue = fractional.toString().padStart(18, '0').replace(/0+$/, '');
		return `${whole.toString()}.${fractionalValue}`;
	} catch {
		return undefined;
	}
}

function normalizeString(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const trimmed = value.trim();
	return trimmed.length > 0 ? trimmed : undefined;
}
