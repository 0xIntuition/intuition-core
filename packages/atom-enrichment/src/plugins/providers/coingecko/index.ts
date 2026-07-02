import { defineEnrichmentPlugin, type EnrichmentPlugin } from '../../../plugins';
import type { EnrichmentRequest } from '../../../types';
import { type FetchLike, fetchJsonWithSchema } from '../__shared__/http';
import { getIdentifier, getRequestName, getRequestUrl } from '../__shared__/request';
import { coinGeckoResponseSchema } from './external';
import { tokenMetadataDataSchema } from './schema';

type CreateCoinGeckoPluginOptions = {
	fetch?: FetchLike;
	priority?: number;
	TTL?: number;
	apiKey?: string;
	platformId?: string;
};

type CoinGeckoResponse = {
	[key: string]: unknown;
	id?: string;
	symbol?: string;
	name?: string;
	image?: {
		thumb?: string;
		small?: string;
		large?: string;
	};
	links?: {
		homepage?: string[];
	};
	market_data?: {
		current_price?: { usd?: number | null };
		market_cap?: { usd?: number | null };
		total_supply?: number | null;
	};
	detail_platforms?: Record<
		string,
		{ decimal_place?: number | null; contract_address?: string | null } | null
	>;
};

type CoinGeckoTarget =
	| {
			kind: 'coin';
			coinId: string;
	  }
	| {
			kind: 'contract';
			address: string;
	  };

const addressPattern = /^0x[a-fA-F0-9]{40}$/;

export function createCoinGeckoPlugin(
	options: CreateCoinGeckoPluginOptions = {}
): EnrichmentPlugin {
	const fetcher = options.fetch ?? (globalThis.fetch as FetchLike);
	const platformId = options.platformId ?? 'ethereum';

	return defineEnrichmentPlugin({
		id: 'coingecko',
		version: '1.0.0',
		runtime: 'server',
		artifactTypes: ['token-metadata'],
		priority: options.priority ?? 58,
		TTL: options.TTL ?? 300,

		supports(request: EnrichmentRequest) {
			return !!resolveCoinGeckoTarget(request);
		},

		async enrich(request, ctx) {
			const target = resolveCoinGeckoTarget(request);
			if (!target) {
				return [];
			}

			const endpoint =
				target.kind === 'coin'
					? `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(target.coinId)}`
					: `https://api.coingecko.com/api/v3/coins/${encodeURIComponent(platformId)}/contract/${encodeURIComponent(target.address)}`;

			const headers = options.apiKey
				? {
						'x-cg-demo-api-key': options.apiKey,
					}
				: undefined;
			let payload: CoinGeckoResponse;
			try {
				payload = await fetchJsonWithSchema(fetcher, endpoint, coinGeckoResponseSchema, {
					signal: ctx.signal,
					headers,
				});
			} catch (error) {
				return [
					{
						artifact_type: 'token-metadata',
						data: tokenMetadataDataSchema.parse(
							buildFallbackTokenMetadata({
								request,
								target,
								endpoint,
								error,
								lookupStatus: isHttpNotFoundError(error) ? 'not_found' : 'error',
							})
						),
						meta: {
							pluginId: 'coingecko',
							provider: 'coingecko',
							fetchedAt: ctx.now(),
							sourceUrl: endpoint,
						},
					},
				];
			}

			const coinId = payload.id ?? (target.kind === 'coin' ? target.coinId : undefined);
			const platformDetails = payload.detail_platforms?.[platformId];
			const address =
				normalizeAddress(platformDetails?.contract_address ?? undefined) ??
				(target.kind === 'contract' ? normalizeAddress(target.address) : undefined) ??
				coinId;
			if (!address) {
				return [];
			}

			const symbol = payload.symbol ? payload.symbol.toUpperCase() : 'UNKNOWN';
			const name = payload.name ?? coinId ?? symbol;
			const decimals = platformDetails?.decimal_place ?? 18;
			const sourceUrl = coinId
				? `https://www.coingecko.com/en/coins/${coinId}`
				: `https://www.coingecko.com/en`;

			return [
				{
					artifact_type: 'token-metadata',
					data: tokenMetadataDataSchema.parse({
						address,
						name,
						symbol,
						decimals,
						totalSupply:
							typeof payload.market_data?.total_supply === 'number'
								? `${payload.market_data.total_supply}`
								: undefined,
						logoUrl: payload.image?.large ?? payload.image?.small ?? payload.image?.thumb,
						website: pickFirstUrl(payload.links?.homepage),
						coingeckoId: coinId,
						priceUsd:
							typeof payload.market_data?.current_price?.usd === 'number'
								? payload.market_data.current_price.usd
								: undefined,
						marketCapUsd:
							typeof payload.market_data?.market_cap?.usd === 'number'
								? payload.market_data.market_cap.usd
								: undefined,
						coingeckoApiPayload: asUnknownRecord(payload),
						lookupStatus: 'resolved',
					}),
					meta: {
						pluginId: 'coingecko',
						provider: 'coingecko',
						fetchedAt: ctx.now(),
						sourceUrl,
					},
				},
			];
		},
	});
}

function resolveCoinGeckoTarget(request: EnrichmentRequest): CoinGeckoTarget | undefined {
	const coinIdentifier = getIdentifier(request, 'coingecko', 'coingeckoId', 'coin');
	if (coinIdentifier) {
		return {
			kind: 'coin',
			coinId: coinIdentifier.trim().toLowerCase(),
		};
	}

	const addressIdentifier = getIdentifier(
		request,
		'contract',
		'address',
		'tokenAddress',
		'ethereum',
		'eth',
		'wallet'
	);
	const normalizedAddressIdentifier = addressIdentifier
		? normalizeAddress(addressIdentifier)
		: undefined;
	if (normalizedAddressIdentifier) {
		return {
			kind: 'contract',
			address: normalizedAddressIdentifier,
		};
	}

	const jsonLdAddress = resolveAddressFromJsonLd(request);
	if (jsonLdAddress) {
		return {
			kind: 'contract',
			address: jsonLdAddress,
		};
	}

	const url = getRequestUrl(request);
	if (url) {
		const fromUrl = parseCoinGeckoTargetFromUrl(url);
		if (fromUrl) {
			return fromUrl;
		}

		const fromExplorerUrl = parseAddressFromExplorerUrl(url);
		if (fromExplorerUrl) {
			return {
				kind: 'contract',
				address: fromExplorerUrl,
			};
		}
	}

	const name = getRequestName(request);
	if (name) {
		const fromName = parseAddressFromText(name);
		if (fromName) {
			return {
				kind: 'contract',
				address: fromName,
			};
		}
	}

	const textAddress = resolveAddressFromTextFields(request);
	if (textAddress) {
		return {
			kind: 'contract',
			address: textAddress,
		};
	}

	return undefined;
}

function parseCoinGeckoTargetFromUrl(url: string): CoinGeckoTarget | undefined {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes('coingecko.com')) {
			return undefined;
		}

		const coinMatch = parsed.pathname.match(/\/coins\/([a-z0-9-]+)/i);
		if (coinMatch?.[1]) {
			return {
				kind: 'coin',
				coinId: coinMatch[1].toLowerCase(),
			};
		}

		return undefined;
	} catch {
		return undefined;
	}
}

function parseAddressFromExplorerUrl(url: string): string | undefined {
	try {
		const parsed = new URL(url);
		if (!parsed.hostname.includes('etherscan.io')) {
			return undefined;
		}

		const match = parsed.pathname.match(/\/address\/(0x[a-fA-F0-9]{40})/);
		if (!match?.[1]) {
			return undefined;
		}

		return normalizeAddress(match[1]);
	} catch {
		return undefined;
	}
}

function parseAddressFromText(value: string): string | undefined {
	const match = value.match(/0x[a-fA-F0-9]{40}/);
	return match?.[0] ? normalizeAddress(match[0]) : undefined;
}

function normalizeAddress(value: string | undefined): string | undefined {
	if (!value) {
		return undefined;
	}

	const cleaned = value.trim();
	if (!addressPattern.test(cleaned)) {
		return undefined;
	}

	return cleaned;
}

function resolveAddressFromJsonLd(request: EnrichmentRequest): string | undefined {
	const jsonLd = asRecord(request.input.jsonLd);
	if (!jsonLd) {
		return undefined;
	}

	const directAddressKeys = ['contract', 'address', 'tokenAddress', 'ethereum', 'eth', 'wallet'];
	for (const key of directAddressKeys) {
		const candidate = normalizeAddress(asString(jsonLd[key]));
		if (candidate) {
			return candidate;
		}
	}

	const identifierAddress = normalizeAddress(asString(jsonLd.identifier));
	if (identifierAddress) {
		return identifierAddress;
	}

	const classificationMeta = asRecord(asRecord(jsonLd.classification)?.meta);
	const nestedAddress = normalizeAddress(asString(classificationMeta?.address));
	if (nestedAddress) {
		return nestedAddress;
	}

	return undefined;
}

function resolveAddressFromTextFields(request: EnrichmentRequest): string | undefined {
	const candidates = [
		request.input.hints?.description,
		request.input.hints?.url,
		asString(request.input.jsonLd.description),
		asString(request.input.jsonLd.url),
		asString(request.input.jsonLd.identifier),
	];

	for (const candidate of candidates) {
		const fromText = typeof candidate === 'string' ? parseAddressFromText(candidate) : undefined;
		if (fromText) {
			return fromText;
		}
	}

	return undefined;
}

function pickFirstUrl(urls: string[] | undefined): string | undefined {
	if (!urls) {
		return undefined;
	}

	for (const url of urls) {
		if (typeof url === 'string' && url.startsWith('http://')) {
			return `https://${url.slice('http://'.length)}`;
		}

		if (typeof url === 'string' && url.startsWith('https://')) {
			return url;
		}
	}

	return undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
	return typeof value === 'string' ? value : undefined;
}

function asUnknownRecord(value: unknown): Record<string, unknown> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return undefined;
	}

	return value as Record<string, unknown>;
}

function isHttpNotFoundError(value: unknown): boolean {
	return value instanceof Error && value.message.includes('HTTP 404');
}

function buildFallbackTokenMetadata(input: {
	request: EnrichmentRequest;
	target: CoinGeckoTarget;
	endpoint: string;
	error: unknown;
	lookupStatus: 'not_found' | 'error';
}): {
	address: string;
	name: string;
	symbol: string;
	decimals: number;
	website?: string;
	coingeckoId?: string;
	lookupStatus: 'not_found' | 'error';
	lookupMessage: string;
	coingeckoLookupEndpoint: string;
} {
	const requestName = getRequestName(input.request);
	const requestUrl = getRequestUrl(input.request);
	const fallbackAddress =
		input.target.kind === 'contract' ? input.target.address : input.target.coinId;
	const fallbackName =
		requestName ??
		(input.target.kind === 'coin'
			? `Coin ${input.target.coinId}`
			: `Token ${fallbackAddress.slice(0, 10)}…`);
	const fallbackSymbol =
		input.target.kind === 'coin' ? input.target.coinId.slice(0, 8).toUpperCase() : 'UNKNOWN';

	return {
		address: fallbackAddress,
		name: fallbackName,
		symbol: fallbackSymbol,
		decimals: 18,
		website: requestUrl,
		coingeckoId: input.target.kind === 'coin' ? input.target.coinId : undefined,
		lookupStatus: input.lookupStatus,
		lookupMessage: toErrorMessage(input.error),
		coingeckoLookupEndpoint: input.endpoint,
	};
}

function toErrorMessage(value: unknown): string {
	if (value instanceof Error && value.message) {
		return value.message;
	}

	return String(value);
}
