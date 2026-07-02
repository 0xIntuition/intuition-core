import { describe, expect, it } from 'bun:test';
import { createClassificationEngine } from '../../engine';
import { createTypeProfilesPlugin } from '../type-profiles';
import { createEtherscanPlugin } from './index';

const ADDRESS = '0x1111111111111111111111111111111111111111';

describe('etherscan plugin', () => {
	it('scans configured chains and resolves ERC20 contracts', async () => {
		const fetchCalls: string[] = [];
		const fetcher = (async (input: string) => {
			fetchCalls.push(input);
			const url = new URL(input);
			const chainId = url.searchParams.get('chainid');
			const action = url.searchParams.get('action');
			const data = url.searchParams.get('data');

			if (action === 'eth_getCode') {
				if (chainId === '1') {
					return createJsonResponse({ result: '0x' });
				}

				if (chainId === '8453') {
					return createJsonResponse({ result: '0x6001600055' });
				}
			}

			if (action === 'eth_call' && chainId === '8453') {
				if (data === '0x06fdde03') {
					return createJsonResponse({ result: encodeAbiString('Base USD') });
				}

				if (data === '0x95d89b41') {
					return createJsonResponse({ result: encodeAbiString('bUSD') });
				}

				if (data === '0x313ce567') {
					return createJsonResponse({ result: encodeAbiInteger(6) });
				}

				if (data === '0x18160ddd') {
					return createJsonResponse({ result: encodeAbiInteger(1_000_000_000) });
				}
			}

			return createJsonResponse({ status: '0', message: 'NOTOK', result: '0x' });
		}) as (input: string, init?: RequestInit) => Promise<Response>;

		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createTypeProfilesPlugin(),
				createEtherscanPlugin({
					apiKey: 'test-key',
					chainIds: [1, 8453],
					fetch: fetcher,
				}),
			],
		});
		const result = await engine.classify({
			input: ADDRESS,
			mode: 'progressive',
			classificationSessionId: 'etherscan-erc20',
		});

		expect(fetchCalls).toHaveLength(6);
		expect(result.resolved?.resolverId).toBe('etherscan-resolver');
		expect(result.resolved?.atoms[0]).toMatchObject({
			schemaType: 'EthereumERC20',
			category: 'product',
			canonicalId: 'eip155:8453:0x1111111111111111111111111111111111111111',
			data: {
				address: '0x1111111111111111111111111111111111111111',
				chainId: '8453',
				name: 'Base USD',
				symbol: 'bUSD',
				decimals: '6',
			},
			metadata: {
				pluginId: 'etherscan',
				provider: 'etherscan',
				sourceUrl: 'https://basescan.org/address/0x1111111111111111111111111111111111111111',
				resolvedChainId: '8453',
			},
		});
	});

	it('classifies deployed non-erc20 contracts as EthereumSmartContract', async () => {
		const fetcher = (async (input: string) => {
			const url = new URL(input);
			const action = url.searchParams.get('action');
			if (action === 'eth_getCode') {
				return createJsonResponse({ result: '0x60806040' });
			}

			return createJsonResponse({
				status: '0',
				message: 'NOTOK',
				result: 'execution reverted',
			});
		}) as (input: string, init?: RequestInit) => Promise<Response>;

		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createTypeProfilesPlugin(),
				createEtherscanPlugin({
					apiKey: 'test-key',
					chainIds: [1],
					fetch: fetcher,
				}),
			],
		});
		const result = await engine.classify({
			input: ADDRESS,
			mode: 'progressive',
			classificationSessionId: 'etherscan-contract',
		});

		expect(result.resolved?.atoms[0]).toMatchObject({
			schemaType: 'EthereumSmartContract',
			canonicalId: 'eip155:1:0x1111111111111111111111111111111111111111',
			data: {
				address: '0x1111111111111111111111111111111111111111',
				chainId: '1',
			},
			metadata: {
				pluginId: 'etherscan',
				provider: 'etherscan',
				sourceUrl: 'https://etherscan.io/address/0x1111111111111111111111111111111111111111',
			},
		});
	});

	it('falls back to deterministic hints when no api key is configured', async () => {
		let fetchCalls = 0;
		const fetcher = (async () => {
			fetchCalls += 1;
			return createJsonResponse({ status: '0', result: '0x' });
		}) as (input: string, init?: RequestInit) => Promise<Response>;

		const engine = createClassificationEngine({
			runtime: 'server',
			plugins: [
				createTypeProfilesPlugin(),
				createEtherscanPlugin({
					chainIds: [1, 8453],
					fetch: fetcher,
				}),
			],
		});
		const result = await engine.classify({
			input: `erc20:${ADDRESS}`,
			mode: 'progressive',
			classificationSessionId: 'etherscan-hint-fallback',
		});

		expect(fetchCalls).toBe(0);
		expect(result.resolved?.atoms[0]).toMatchObject({
			schemaType: 'EthereumERC20',
			canonicalId: 'eip155:1:0x1111111111111111111111111111111111111111',
			data: {
				address: '0x1111111111111111111111111111111111111111',
				chainId: '1',
			},
		});
	});
});

function createJsonResponse(payload: unknown): Response {
	return {
		ok: true,
		status: 200,
		json: async () => payload,
	} as Response;
}

function encodeAbiString(value: string): string {
	const encodedText = new TextEncoder().encode(value);
	const dataHex = Array.from(encodedText)
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
	const paddedDataHex = dataHex.padEnd(Math.ceil(dataHex.length / 64) * 64, '0');
	const offsetHex = '20'.padStart(64, '0');
	const lengthHex = encodedText.length.toString(16).padStart(64, '0');
	return `0x${offsetHex}${lengthHex}${paddedDataHex}`;
}

function encodeAbiInteger(value: number): string {
	return `0x${value.toString(16).padStart(64, '0')}`;
}
